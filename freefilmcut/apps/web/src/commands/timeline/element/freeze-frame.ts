import { videoCache } from "@/services/video-cache/service";
import { renderThumbnailDataUrl } from "@/media/thumbnail";
import type { MediaAsset } from "@/media/types";
import type { ParamValues } from "@/params";
import { buildElementFromMedia } from "@/timeline/element-utils";
import type { CreateImageElement, VideoElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import type { MediaTime } from "@/wasm";

const FREEZE_FRAME_STREAM_KEY = "freeze-frame";

export function freezeSampleKey({
	element,
}: {
	element: VideoElement;
}): string {
	return JSON.stringify({
		mediaId: element.mediaId,
		duration: element.duration,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		reversed: element.reversed === true,
		retime: element.retime ?? null,
	});
}

export async function captureFreezeFrameStill({
	mediaId,
	file,
	timeSeconds,
}: {
	mediaId: string;
	file: File;
	timeSeconds: number;
}): Promise<{
	file: File;
	width: number;
	height: number;
	thumbnailUrl: string;
} | null> {
	const frame = await videoCache.getFrameAt({
		mediaId,
		file,
		time: timeSeconds,
		streamKey: FREEZE_FRAME_STREAM_KEY,
	});
	if (!frame) return null;

	const snapshot = snapshotCanvas({ source: frame.canvas });
	if (!snapshot) return null;

	const blob = await canvasToPngBlob({ canvas: snapshot });
	if (!blob) return null;

	const still = new File([blob], `freeze-${generateUUID()}.png`, {
		type: "image/png",
	});
	const thumbnailUrl = renderThumbnailDataUrl({
		width: snapshot.width,
		height: snapshot.height,
		draw: ({ context, width, height }) => {
			context.drawImage(snapshot, 0, 0, width, height);
		},
	});

	return {
		file: still,
		width: snapshot.width,
		height: snapshot.height,
		thumbnailUrl,
	};
}

export function buildFreezeImageAsset({
	file,
	width,
	height,
	thumbnailUrl,
}: {
	file: File;
	width: number;
	height: number;
	thumbnailUrl?: string;
}): Omit<MediaAsset, "id"> {
	return {
		name: file.name,
		type: "image",
		file,
		url: URL.createObjectURL(file),
		width,
		height,
		thumbnailUrl,
	};
}

export function buildFreezeImageElement({
	mediaId,
	name,
	startTime,
	duration,
	sourceParams,
}: {
	mediaId: string;
	name: string;
	startTime: MediaTime;
	duration: MediaTime;
	sourceParams: ParamValues;
}): CreateImageElement {
	const element = buildElementFromMedia({
		mediaId,
		mediaType: "image",
		name,
		duration,
		startTime,
	});
	if (element.type !== "image") {
		throw new Error("Freeze frame expected an image element");
	}

	return {
		...element,
		params: {
			...element.params,
			...copyTransformParams({ params: sourceParams }),
		},
	};
}

function copyTransformParams({ params }: { params: ParamValues }): ParamValues {
	const copied: ParamValues = {};
	for (const [key, value] of Object.entries(params)) {
		if (key.startsWith("transform.")) {
			copied[key] = value;
		}
	}
	return copied;
}

function snapshotCanvas({
	source,
}: {
	source: HTMLCanvasElement | OffscreenCanvas;
}): HTMLCanvasElement | null {
	const width = source.width;
	const height = source.height;
	if (width <= 0 || height <= 0) return null;
	if (typeof document === "undefined") return null;

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(source, 0, 0, width, height);
	return canvas;
}

function canvasToPngBlob({
	canvas,
}: {
	canvas: HTMLCanvasElement;
}): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), "image/png");
	});
}
