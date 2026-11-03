import { createCanvasSurface } from "./canvas-utils";
import { gpuRenderer, isGpuAvailable } from "./gpu-renderer";

/**
 * Soften a hard (white-on-transparent) mask.
 * Prefers the wasm JFA path when GPU is up; otherwise a canvas blur fallback
 * so Three.js preview/export still responds to the Feather slider.
 */
export function applyMaskFeather({
	maskCanvas,
	width,
	height,
	feather,
}: {
	maskCanvas: OffscreenCanvas;
	width: number;
	height: number;
	feather: number;
}): OffscreenCanvas {
	if (!(feather > 0) || width < 1 || height < 1) {
		return maskCanvas;
	}

	if (isGpuAvailable()) {
		return gpuRenderer.applyMaskFeather({
			maskCanvas,
			width,
			height,
			feather,
		});
	}

	return applyMaskFeatherCanvasBlur({
		maskCanvas,
		width,
		height,
		feather,
	});
}

/** Approximate JFA softness when WebGPU/wasm feather is unavailable. */
function applyMaskFeatherCanvasBlur({
	maskCanvas,
	width,
	height,
	feather,
}: {
	maskCanvas: OffscreenCanvas;
	width: number;
	height: number;
	feather: number;
}): OffscreenCanvas {
	// UI feather is ~0..1000; map to a visible blur radius in canvas pixels.
	const blurPx = Math.min(80, Math.max(0.5, feather * 0.08));
	const { canvas, context } = createCanvasSurface({ width, height });
	context.clearRect(0, 0, width, height);
	context.filter = `blur(${blurPx}px)`;
	context.drawImage(maskCanvas, 0, 0);
	context.filter = "none";

	// Normalize to opaque grayscale (matches JFA `vec4(a,a,a,a)`). Blur can
	// leave premultiplied / low-alpha fringes that break invert + alphaMap.
	const imageData = context.getImageData(0, 0, width, height);
	const data = imageData.data;
	for (let i = 0; i < data.length; i += 4) {
		const coverage =
			Math.max(data[i], data[i + 1], data[i + 2], data[i + 3]) / 255;
		const value = Math.round(coverage * 255);
		data[i] = value;
		data[i + 1] = value;
		data[i + 2] = value;
		data[i + 3] = 255;
	}
	context.putImageData(imageData, 0, 0);
	return canvas;
}
