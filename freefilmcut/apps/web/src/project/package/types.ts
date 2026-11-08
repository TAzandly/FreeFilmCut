import type { MediaAssetData, SerializedProject } from "@/services/storage/types";

export const PROJECT_PACKAGE_FORMAT = "freefilmcut-project" as const;
export const PROJECT_PACKAGE_FORMAT_VERSION = 1;
export const PROJECT_PACKAGE_EXTENSION = ".ffcdraft.zip";

export interface ProjectPackageMeta {
	format: typeof PROJECT_PACKAGE_FORMAT;
	formatVersion: number;
	exportedAt: string;
	name: string;
	originalProjectId: string;
}

export interface ProjectPackageManifestAsset extends MediaAssetData {
	/** Relative path under the package root, e.g. media/files/<id> */
	filePath: string;
	mimeType?: string;
}

export interface ProjectPackageManifest {
	assets: ProjectPackageManifestAsset[];
}

export interface BuiltProjectPackage {
	filename: string;
	blob: Blob;
}

export interface ParsedProjectPackage {
	meta: ProjectPackageMeta;
	project: SerializedProject;
	assets: Array<{
		metadata: MediaAssetData;
		file: File;
	}>;
}
