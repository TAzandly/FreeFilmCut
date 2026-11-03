import type { TCanvasSize } from "@/project/types";

/** CapCut-style labels; value is the short-side pixel target. */
export const EXPORT_RESOLUTION_VALUES = [
	"480p",
	"720p",
	"1080p",
	"2k",
	"4k",
] as const;

export type ExportResolution = (typeof EXPORT_RESOLUTION_VALUES)[number];

export const EXPORT_RESOLUTION_SHORT_SIDE: Record<ExportResolution, number> = {
	"480p": 480,
	"720p": 720,
	"1080p": 1080,
	"2k": 1440,
	"4k": 2160,
};

export const EXPORT_RESOLUTION_LABELS: Record<ExportResolution, string> = {
	"480p": "480P",
	"720p": "720P",
	"1080p": "1080P",
	"2k": "2K",
	"4k": "4K",
};

function even({ value }: { value: number }): number {
	const rounded = Math.max(2, Math.round(value));
	return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Keep project aspect ratio; map the resolution preset to the short side
 * (landscape → height, portrait/square → width), CapCut-style.
 */
export function resolveExportSize({
	canvasSize,
	resolution,
}: {
	canvasSize: TCanvasSize;
	resolution: ExportResolution;
}): TCanvasSize {
	const srcW = Math.max(1, canvasSize.width);
	const srcH = Math.max(1, canvasSize.height);
	const shortSide = EXPORT_RESOLUTION_SHORT_SIDE[resolution];

	if (srcW <= srcH) {
		const width = even({ value: shortSide });
		const height = even({ value: (shortSide * srcH) / srcW });
		return { width, height };
	}

	const height = even({ value: shortSide });
	const width = even({ value: (shortSide * srcW) / srcH });
	return { width, height };
}
