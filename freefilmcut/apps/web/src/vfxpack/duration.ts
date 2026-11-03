import { mediaTimeFromSeconds, type MediaTime } from "@/wasm";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import type { LoadedVfxPack, VfxManifest } from "@/vfxpack/types";

/**
 * Prefer pack clip length from FreeFilmCut Timeline(s):
 * 1) manifest.duration (exporter writes max Timeline duration when timelines exist)
 * 2) else max of manifest.timelines[].duration
 * 3) else DEFAULT_NEW_ELEMENT_DURATION (5s)
 */
export function resolveVfxPackDurationSeconds({
	manifest,
}: {
	manifest: VfxManifest | null | undefined;
}): number | null {
	if (!manifest) return null;
	const top = Number(manifest.duration);
	if (Number.isFinite(top) && top > 0) return top;

	let max = 0;
	for (const tl of manifest.timelines || []) {
		const d = Number(tl?.duration);
		if (Number.isFinite(d) && d > max) max = d;
	}
	return max > 0 ? max : null;
}

export function getVfxPackElementDuration({
	pack,
}: {
	pack: LoadedVfxPack;
}): MediaTime {
	const seconds = resolveVfxPackDurationSeconds({ manifest: pack.manifest });
	if (seconds != null) {
		return mediaTimeFromSeconds({ seconds });
	}
	return DEFAULT_NEW_ELEMENT_DURATION;
}
