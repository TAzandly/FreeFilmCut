import { strFromU8, strToU8, unzip, zip } from "fflate";
import type { MediaAssetData, SerializedProject } from "@/services/storage/types";
import { sanitizePackageFolderName } from "./serialize";
import {
	PROJECT_PACKAGE_EXTENSION,
	PROJECT_PACKAGE_FORMAT,
	PROJECT_PACKAGE_FORMAT_VERSION,
	type BuiltProjectPackage,
	type ParsedProjectPackage,
	type ProjectPackageManifest,
	type ProjectPackageManifestAsset,
	type ProjectPackageMeta,
} from "./types";

function zipAsync({
	files,
}: {
	files: Record<string, Uint8Array | [Uint8Array, { level: number }]>;
}): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		zip(files, { level: 1 }, (error, data) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(data);
		});
	});
}

function unzipAsync({
	bytes,
}: {
	bytes: Uint8Array;
}): Promise<Record<string, Uint8Array>> {
	return new Promise((resolve, reject) => {
		unzip(bytes, (error, data) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(data);
		});
	});
}

function guessMimeType({
	name,
	fileType,
}: {
	name: string;
	fileType: string;
}): string {
	if (fileType) return fileType;
	const lower = name.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".mp4")) return "video/mp4";
	if (lower.endsWith(".webm")) return "video/webm";
	if (lower.endsWith(".mov")) return "video/quicktime";
	if (lower.endsWith(".mp3")) return "audio/mpeg";
	if (lower.endsWith(".wav")) return "audio/wav";
	if (lower.endsWith(".m4a")) return "audio/mp4";
	return "application/octet-stream";
}

export async function buildProjectPackageZip({
	project,
	assets,
}: {
	project: SerializedProject;
	assets: Array<{ metadata: MediaAssetData; file: File }>;
}): Promise<BuiltProjectPackage> {
	const folderName = sanitizePackageFolderName({
		name: project.metadata.name,
	});
	const root = `${folderName}/`;

	const meta: ProjectPackageMeta = {
		format: PROJECT_PACKAGE_FORMAT,
		formatVersion: PROJECT_PACKAGE_FORMAT_VERSION,
		exportedAt: new Date().toISOString(),
		name: project.metadata.name,
		originalProjectId: project.metadata.id,
	};

	const manifestAssets: ProjectPackageManifestAsset[] = [];
	const files: Record<string, Uint8Array | [Uint8Array, { level: number }]> =
		{};

	files[`${root}meta.json`] = strToU8(JSON.stringify(meta, null, 2));
	files[`${root}project.json`] = strToU8(JSON.stringify(project, null, 2));

	for (const asset of assets) {
		if (asset.metadata.ephemeral) continue;

		const filePath = `media/files/${asset.metadata.id}`;
		const bytes = new Uint8Array(await asset.file.arrayBuffer());
		files[`${root}${filePath}`] = [bytes, { level: 0 }];

		manifestAssets.push({
			...asset.metadata,
			filePath,
			mimeType: asset.file.type || undefined,
		});
	}

	const manifest: ProjectPackageManifest = { assets: manifestAssets };
	files[`${root}media/manifest.json`] = strToU8(
		JSON.stringify(manifest, null, 2),
	);

	const zipped = await zipAsync({ files });
	const filename = `${folderName}${PROJECT_PACKAGE_EXTENSION}`;

	return {
		filename,
		blob: new Blob([zipped], { type: "application/zip" }),
	};
}

function resolvePackageRoot({
	paths,
}: {
	paths: string[];
}): string {
	const metaPath = paths.find(
		(path) => path === "meta.json" || path.endsWith("/meta.json"),
	);
	if (!metaPath) {
		throw new Error("Invalid project package: missing meta.json");
	}
	if (metaPath === "meta.json") return "";
	return metaPath.slice(0, -"meta.json".length);
}

function readJsonFile<T>({
	files,
	path,
}: {
	files: Record<string, Uint8Array>;
	path: string;
}): T {
	const bytes = files[path];
	if (!bytes) {
		throw new Error(`Invalid project package: missing ${path}`);
	}
	return JSON.parse(strFromU8(bytes)) as T;
}

export async function parseProjectPackageZip({
	bytes,
}: {
	bytes: Uint8Array;
}): Promise<ParsedProjectPackage> {
	const files = await unzipAsync({ bytes });
	const paths = Object.keys(files);
	const root = resolvePackageRoot({ paths });

	const meta = readJsonFile<ProjectPackageMeta>({
		files,
		path: `${root}meta.json`,
	});
	if (meta.format !== PROJECT_PACKAGE_FORMAT) {
		throw new Error("Invalid project package: unrecognized format");
	}
	if (
		typeof meta.formatVersion !== "number" ||
		meta.formatVersion > PROJECT_PACKAGE_FORMAT_VERSION
	) {
		throw new Error(
			`Unsupported project package version: ${String(meta.formatVersion)}`,
		);
	}

	const project = readJsonFile<SerializedProject>({
		files,
		path: `${root}project.json`,
	});
	if (
		!project?.metadata ||
		typeof project.metadata.name !== "string" ||
		!Array.isArray(project.scenes)
	) {
		throw new Error("Invalid project package: malformed project.json");
	}

	const manifest = readJsonFile<ProjectPackageManifest>({
		files,
		path: `${root}media/manifest.json`,
	});
	if (!Array.isArray(manifest.assets)) {
		throw new Error("Invalid project package: malformed media/manifest.json");
	}

	const assets: ParsedProjectPackage["assets"] = [];
	for (const entry of manifest.assets) {
		if (!entry?.id || !entry.filePath) continue;
		const fileBytes = files[`${root}${entry.filePath}`];
		if (!fileBytes) {
			console.warn(
				`[project-package] Missing media file for asset ${entry.id}: ${entry.filePath}`,
			);
			continue;
		}

		const { filePath: _filePath, mimeType, ...metadata } = entry;
		const type = guessMimeType({
			name: metadata.name || entry.id,
			fileType: mimeType || "",
		});
		const copy = new Uint8Array(fileBytes);
		const file = new File([copy], metadata.name || entry.id, {
			type,
			lastModified: metadata.lastModified || Date.now(),
		});

		assets.push({
			metadata: {
				...metadata,
				size: metadata.size || file.size,
				lastModified: metadata.lastModified || file.lastModified,
			},
			file,
		});
	}

	return { meta, project, assets };
}
