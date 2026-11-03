import type { LoadedVfxPack, VfxManifest } from "@/vfxpack/types";

export function resolvePackPreviewUrls({
	manifest,
	objectUrls,
}: {
	manifest: VfxManifest;
	objectUrls: Map<string, string>;
}): { poster: string | null; hover: string | null } {
	const posterPath = manifest.preview?.poster;
	const hoverPath = manifest.preview?.hover;
	return {
		poster: posterPath ? (objectUrls.get(posterPath) ?? null) : null,
		hover: hoverPath ? (objectUrls.get(hoverPath) ?? null) : null,
	};
}

/**
 * Library-card preview: use exported poster PNG when present.
 * Hover GIF is optional — cards keep the poster when hover is missing.
 * No poster → null so UI can show the default/missing icon (do not invent
 * a thumb from other pack assets).
 */
export function packLibraryThumb({
	pack,
}: {
	pack: LoadedVfxPack;
}): { poster: string | null; hover: string | null } {
	return resolvePackPreviewUrls({
		manifest: pack.manifest,
		objectUrls: pack.objectUrls,
	});
}
