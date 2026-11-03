import { unzipSync } from "fflate";
import type {
	LoadedVfxPack,
	VfxManifest,
	VfxSceneFile,
} from "@/vfxpack/types";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { resolveTextTemplatePayload } from "@/vfxpack/apply-text-template";
import { loadCustomDefinitions } from "@/vfxpack/postprocess";
import type { CustomEffectDefinition } from "@/vfxpack/postprocess";

function defaultScopeForType(type: string): string {
	if (
		type === "filter" ||
		type === "effect" ||
		type === "clip-anim"
	) {
		return "below";
	}
	return "stack";
}

function normalizeZipPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function stripPackPrefix(path: string): string {
	const normalized = normalizeZipPath(path);
	if (normalized === "pack" || normalized.startsWith("pack/")) {
		return normalized.slice("pack/".length);
	}
	return normalized;
}

function decodeText(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}

function findManifestPath(keys: string[]): string | null {
	const exact = keys.find(
		(k) => k === "manifest.json" || k.endsWith("/manifest.json"),
	);
	return exact ?? null;
}

/**
 * Load a `.vfxpack` (zip) File into memory.
 * Accepts either `pack/manifest.json` layout or flat `manifest.json`.
 */
export async function loadVfxPackFromFile({
	file,
}: {
	file: File;
}): Promise<LoadedVfxPack> {
	const buffer = new Uint8Array(await file.arrayBuffer());
	let unzipped: Record<string, Uint8Array>;
	try {
		unzipped = unzipSync(buffer);
	} catch (error) {
		throw new Error(
			`Failed to unzip vfxpack (is it a zip?): ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const files = new Map<string, Uint8Array>();
	for (const [rawPath, bytes] of Object.entries(unzipped)) {
		const rel = stripPackPrefix(rawPath);
		if (!rel || rel.endsWith("/")) continue;
		files.set(rel, bytes);
	}

	const manifestKey =
		findManifestPath([...files.keys()]) ??
		([...files.keys()].find((k) => k.endsWith("manifest.json")) ?? null);
	if (!manifestKey) {
		throw new Error("vfxpack missing manifest.json");
	}

	const manifest = JSON.parse(
		decodeText(files.get(manifestKey)!),
	) as VfxManifest;
	if (!manifest?.id) {
		throw new Error("vfxpack manifest missing id");
	}

	const sceneRel =
		manifest.entry?.scene ??
		manifest.assets?.scene ??
		(files.has("scene.json") ? "scene.json" : null);

	let scene: VfxSceneFile | null = null;
	if (sceneRel && files.has(sceneRel)) {
		scene = JSON.parse(decodeText(files.get(sceneRel)!)) as VfxSceneFile;
	}

	const objectUrls = new Map<string, string>();
	for (const [path, bytes] of files) {
		const lower = path.toLowerCase();
		const isImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower);
		const isVideo = /\.(mp4|webm|mov|ogv|ogg)$/i.test(lower);
		const isShader =
			/\.(glsl|vert|frag|vs|fs)$/i.test(lower) ||
			lower.includes(".vert.") ||
			lower.includes(".frag.");
		const isFont = /\.(ttf|otf|woff)$/i.test(lower);
		if (!isImage && !isVideo && !isShader && !isFont) continue;
		const copy = bytes.slice();
		const blob = new Blob([copy], {
			type: isImage
				? guessImageMime(path)
				: isVideo
					? "video/mp4"
					: isFont
						? "font/ttf"
						: "text/plain",
		});
		objectUrls.set(path, URL.createObjectURL(blob));
	}

	const type = normalizeVfxPackType(manifest.type);

	const pack: LoadedVfxPack = {
		id: manifest.id,
		displayName: manifest.displayName || manifest.id,
		type,
		scope: String(manifest.scope || defaultScopeForType(type)),
		manifest,
		scene,
		files,
		objectUrls,
		sourceFileName: file.name,
	};

	// text-template: hydrate manifest.textTemplate from text-template.json or scene.json
	// when the pack was exported by the generic VfxPackExporter (missing payload).
	if (type === "text-template") {
		resolveTextTemplatePayload(pack);
	}

	// Custom PP definitions (also re-registered in buildPackScene).
	const customs = (manifest as { customEffects?: CustomEffectDefinition[] })
		.customEffects;
	if (Array.isArray(customs) && customs.length > 0) {
		loadCustomDefinitions(customs);
	}

	return pack;
}

function guessImageMime(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
	return "application/octet-stream";
}

export function revokePackObjectUrls({ pack }: { pack: LoadedVfxPack }) {
	for (const url of pack.objectUrls.values()) {
		URL.revokeObjectURL(url);
	}
	pack.objectUrls.clear();
}