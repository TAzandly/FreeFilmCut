/** Pixel sources accepted by beauty analysis (browser-only). */
export type BeautyImageSource =
	| ImageBitmap
	| HTMLCanvasElement
	| HTMLVideoElement
	| HTMLImageElement;

export type PixelRect = { x: number; y: number; w: number; h: number };

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Any2dContext =
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D;

export function getImageSourceSize(image: BeautyImageSource): {
	width: number;
	height: number;
} {
	if (typeof HTMLVideoElement !== "undefined" && image instanceof HTMLVideoElement) {
		return { width: image.videoWidth, height: image.videoHeight };
	}
	if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
		return {
			width: image.naturalWidth || image.width,
			height: image.naturalHeight || image.height,
		};
	}
	const sized = image as { width: number; height: number };
	return { width: sized.width, height: sized.height };
}

export function isBrowserImagingAvailable(): boolean {
	return (
		typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined"
	);
}

function createCanvas(
	width: number,
	height: number,
	preferDom = false,
): AnyCanvas {
	const makeDom = () => {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	};
	if (preferDom && typeof document !== "undefined") return makeDom();
	if (typeof OffscreenCanvas !== "undefined") {
		return new OffscreenCanvas(width, height);
	}
	if (typeof document !== "undefined") return makeDom();
	throw new Error("Beauty analysis requires a browser canvas implementation");
}

function get2dContext(canvas: AnyCanvas): Any2dContext {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Failed to acquire 2D canvas context");
	return ctx as Any2dContext;
}

/**
 * Draw `source` (optionally cropped to `crop`, in source pixels) into a new
 * canvas of `outWidth x outHeight`.
 */
export function drawToCanvas({
	source,
	outWidth,
	outHeight,
	crop,
	fill,
	dest,
	preferDomCanvas,
}: {
	source: BeautyImageSource;
	outWidth: number;
	outHeight: number;
	crop?: PixelRect;
	/** Optional solid fill before drawing (letterbox padding). */
	fill?: string;
	/** Destination rect inside the output canvas (defaults to the whole canvas). */
	dest?: PixelRect;
	preferDomCanvas?: boolean;
}): { canvas: AnyCanvas; ctx: Any2dContext } {
	const canvas = createCanvas(outWidth, outHeight, preferDomCanvas);
	const ctx = get2dContext(canvas);
	if (fill) {
		ctx.fillStyle = fill;
		ctx.fillRect(0, 0, outWidth, outHeight);
	}
	const d = dest ?? { x: 0, y: 0, w: outWidth, h: outHeight };
	if (crop) {
		ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, d.x, d.y, d.w, d.h);
	} else {
		ctx.drawImage(source, d.x, d.y, d.w, d.h);
	}
	return { canvas, ctx };
}

/** Crop `rect` (source pixels) out of `source` into a DOM canvas at native crop size. */
export function cropToCanvas(
	source: BeautyImageSource,
	rect: PixelRect,
): HTMLCanvasElement {
	const w = Math.max(1, Math.round(rect.w));
	const h = Math.max(1, Math.round(rect.h));
	const { canvas } = drawToCanvas({
		source,
		outWidth: w,
		outHeight: h,
		crop: rect,
		preferDomCanvas: true,
	});
	return canvas as HTMLCanvasElement;
}
