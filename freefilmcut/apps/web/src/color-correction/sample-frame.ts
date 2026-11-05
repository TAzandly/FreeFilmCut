import { videoCache } from "@/services/video-cache/service";
import { mediaTimeToSeconds, type MediaTime } from "@/wasm";

const COLOR_CORRECTION_STREAM_KEY = "color-correction";

/** Longest edge of the bitmap passed to the analyzer. */
const MAX_ANALYSIS_EDGE = 512;

export type ColorCorrectionSampleArgs = {
	mediaId: string;
	file: File;
	elementType: "video" | "image";
	/** `VideoElement.trimStart` — integer media ticks. */
	trimStart: MediaTime;
	/** `VideoElement.trimEnd` — integer media ticks. */
	trimEnd: MediaTime;
	/** `VideoElement.duration` — visible timeline length in media ticks. */
	duration: MediaTime;
};

/**
 * Representative frame for color-correction analysis.
 *
 * Video samples the forward midpoint of the trimmed source window (reverse
 * and retime are ignored). Images draw the file itself. Either path is
 * downscaled so `max(width, height) <= 512` before `getImageData`.
 */
export async function sampleColorCorrectionFrame({
	mediaId,
	file,
	elementType,
	trimStart,
	trimEnd,
	duration,
}: ColorCorrectionSampleArgs): Promise<ImageData | null> {
	if (elementType === "image") {
		return sampleImageFile({ file });
	}
	return sampleVideoFrame({ mediaId, file, trimStart, trimEnd, duration });
}

/**
 * Seconds into the source file.
 *
 * At rate 1 the invariant is `trimStart + duration + trimEnd == sourceDuration`,
 * so the playable window is `[trimStart, sourceDuration - trimEnd)` and its
 * length is `duration`. The sample is the midpoint of that window.
 */
export function colorCorrectionSampleTimeSeconds({
	trimStart,
	trimEnd,
	duration,
}: {
	trimStart: MediaTime;
	trimEnd: MediaTime;
	duration: MediaTime;
}): number {
	const trimStartSec = mediaTimeToSeconds({ time: trimStart });
	const trimEndSec = Math.max(0, mediaTimeToSeconds({ time: trimEnd }));
	const durationSec = Math.max(0, mediaTimeToSeconds({ time: duration }));
	const sourceDurationSec = trimStartSec + durationSec + trimEndSec;
	const windowStart = Math.max(0, trimStartSec);
	const windowEnd = Math.max(windowStart, sourceDurationSec - trimEndSec);
	const usableSpan = windowEnd - windowStart;
	return windowStart + usableSpan / 2;
}

async function sampleVideoFrame({
	mediaId,
	file,
	trimStart,
	trimEnd,
	duration,
}: {
	mediaId: string;
	file: File;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	duration: MediaTime;
}): Promise<ImageData | null> {
	const mid = colorCorrectionSampleTimeSeconds({
		trimStart,
		trimEnd,
		duration,
	});
	const inPoint = Math.max(0, mediaTimeToSeconds({ time: trimStart }));
	const times = [mid];
	if (Math.abs(inPoint - mid) > 1e-3) times.push(inPoint);
	if (inPoint > 1e-3 && mid > 1e-3) times.push(0);

	for (const time of times) {
		const frame = await videoCache.getFrameAt({
			mediaId,
			file,
			time,
			streamKey: COLOR_CORRECTION_STREAM_KEY,
		});
		if (!frame) continue;
		const imageData = imageDataFromSource({ source: frame.canvas });
		if (imageData) return imageData;
	}
	return null;
}

async function sampleImageFile({
	file,
}: {
	file: File;
}): Promise<ImageData | null> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file, {
				premultiplyAlpha: "none",
				colorSpaceConversion: "none",
			});
			try {
				return imageDataFromSource({ source: bitmap });
			} finally {
				bitmap.close();
			}
		} catch {
			// Some decoders reject the bitmap options; try a plain image element.
		}
	}
	return sampleHtmlImage({ file });
}

function sampleHtmlImage({ file }: { file: File }): Promise<ImageData | null> {
	if (typeof Image === "undefined" || typeof URL === "undefined") {
		return Promise.resolve(null);
	}

	const url = URL.createObjectURL(file);
	const image = new Image();
	return new Promise((resolve) => {
		const finish = ({ data }: { data: ImageData | null }) => {
			URL.revokeObjectURL(url);
			resolve(data);
		};
		image.onload = () => {
			finish({ data: imageDataFromSource({ source: image }) });
		};
		image.onerror = () => {
			finish({ data: null });
		};
		image.src = url;
	});
}

function imageDataFromSource({
	source,
}: {
	source: CanvasImageSource;
}): ImageData | null {
	const { width: sourceWidth, height: sourceHeight } = sourcePixelSize({
		source,
	});
	const size = fitAnalysisSize({ width: sourceWidth, height: sourceHeight });
	if (!size) return null;

	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(size.width, size.height);
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.drawImage(source, 0, 0, size.width, size.height);
		return context.getImageData(0, 0, size.width, size.height);
	}

	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	canvas.width = size.width;
	canvas.height = size.height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(source, 0, 0, size.width, size.height);
	return context.getImageData(0, 0, size.width, size.height);
}

function sourcePixelSize({
	source,
}: {
	source: CanvasImageSource;
}): { width: number; height: number } {
	if (
		typeof HTMLImageElement !== "undefined" &&
		source instanceof HTMLImageElement
	) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}
	if (
		typeof HTMLVideoElement !== "undefined" &&
		source instanceof HTMLVideoElement
	) {
		return { width: source.videoWidth, height: source.videoHeight };
	}
	if (
		"width" in source &&
		"height" in source &&
		typeof source.width === "number" &&
		typeof source.height === "number"
	) {
		return { width: source.width, height: source.height };
	}
	return { width: 0, height: 0 };
}

function fitAnalysisSize({
	width,
	height,
}: {
	width: number;
	height: number;
}): { width: number; height: number } | null {
	if (width <= 0 || height <= 0) return null;
	const maxEdge = Math.max(width, height);
	if (maxEdge <= MAX_ANALYSIS_EDGE) {
		return { width: Math.round(width), height: Math.round(height) };
	}
	const scale = MAX_ANALYSIS_EDGE / maxEdge;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}
