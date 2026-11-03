/** Preview-only render scale. Export always uses full project canvas size. */

export const PLAYBACK_QUALITY_OPTIONS = [
	{ id: "original", label: "Full Quality", scale: 1 },
	{ id: "clear", label: "High Quality", scale: 0.75 },
	{ id: "smooth", label: "Medium Quality", scale: 0.5 },
	{ id: "low", label: "Low Quality", scale: 0.35 },
] as const;

export type PlaybackQualityId = (typeof PLAYBACK_QUALITY_OPTIONS)[number]["id"];

export const DEFAULT_PLAYBACK_QUALITY: PlaybackQualityId = "original";

export function playbackQualityScale(id: PlaybackQualityId | string): number {
	const match = PLAYBACK_QUALITY_OPTIONS.find((option) => option.id === id);
	return match?.scale ?? 1;
}

export function isPlaybackQualityId(value: unknown): value is PlaybackQualityId {
	return (
		typeof value === "string" &&
		PLAYBACK_QUALITY_OPTIONS.some((option) => option.id === value)
	);
}

/** Even pixel size so GPU/YUV paths stay happier; never below 2. */
export function scaleCanvasSize({
	width,
	height,
	scale,
}: {
	width: number;
	height: number;
	scale: number;
}): { width: number; height: number } {
	const s = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
	const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
	return {
		width: even(Math.max(1, width)),
		height: even(Math.max(1, height)),
	};
}
