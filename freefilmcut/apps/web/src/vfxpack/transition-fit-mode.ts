/**
 * Transition pack canvas fit: crop (default, rewrite camera to project aspect)
 * vs stretch (keep pack design aspect while rendering into project pixels).
 */

export type TransitionFitMode = "crop" | "stretch";

export function normalizeTransitionFitMode(
	raw: unknown,
): TransitionFitMode {
	const value = String(raw ?? "")
		.trim()
		.toLowerCase();
	return value === "stretch" ? "stretch" : "crop";
}

/** Pack design aspect (width/height). Invalid → fallback. */
export function authoredAspectFromResolution(
	resolution?: { width?: number; height?: number } | null,
	fallback = 1,
): number {
	const w = Number(resolution?.width);
	const h = Number(resolution?.height);
	if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) {
		return fallback;
	}
	return w / h;
}
