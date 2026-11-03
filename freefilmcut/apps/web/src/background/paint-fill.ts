import { buildGaussianBlurPasses } from "@/effects/definitions/blur";
import { drawCssBackground } from "@/gradients";
import {
	gpuRenderer,
	isGpuAvailable,
} from "@/services/renderer/gpu-renderer";
import type { BackgroundFillSettings } from "./fill";
import { isBackgroundFillActive } from "./fill";

/** Blur fill runs at 1/4 res then bilinear-upscales — ~16× fewer blur texels. */
const BACKGROUND_BLUR_DOWNSAMPLE = 4;

/**
 * Old full-res path used `intensity * 0.2` (100 → 20px). Target ≥10× that at 100
 * → ~200px effective. At 1/4 res, sigma_low * 4 ≈ effective, so sigma_low =
 * intensity * 0.5 (100 → 50px low / ~200px full).
 */
const BACKGROUND_BLUR_LOW_RES_SIGMA_PER_INTENSITY = 0.5;

/**
 * ColorPicker emits bare hex (`ff0000` / `ff0000aa`); canvas fillStyle needs CSS
 * (`#ff0000`). Also tolerate already-prefixed / rgb() / gradient values.
 */
export function toCssPaintColor(color: string): string {
	const trimmed = color.trim();
	if (!trimmed) return "#000000";
	if (
		trimmed.startsWith("#") ||
		/^(rgb|hsl)a?\(/i.test(trimmed) ||
		/gradient\(/i.test(trimmed)
	) {
		return trimmed;
	}
	if (/^[0-9a-fA-F]{3,8}$/.test(trimmed)) {
		return `#${trimmed}`;
	}
	return trimmed;
}

export function drawCoverScaled({
	ctx,
	width,
	height,
	source,
	sourceWidth,
	sourceHeight,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
}) {
	const coverScale = Math.max(width / sourceWidth, height / sourceHeight);
	const scaledWidth = sourceWidth * coverScale;
	const scaledHeight = sourceHeight * coverScale;
	const offsetX = (width - scaledWidth) / 2;
	const offsetY = (height - scaledHeight) / 2;
	ctx.drawImage(source, offsetX, offsetY, scaledWidth, scaledHeight);
}

/** Low-res blurred result per static source (image), reused across frames. */
const staticBlurCache = new WeakMap<
	object,
	{ key: string; canvas: OffscreenCanvas }
>();

/**
 * CapCut-style canvas blur fill: cover → 4× downsample → Gaussian → upsample.
 *
 * `sourceIsStatic`: pixels never change for this source object (images), so
 * the blurred low-res result is cached on it.
 * `preferCanvasFilter`: blur with the 2D context's own filter. Reading the
 * GPU effect canvas back into 2D stalls on the GPU every call, which matters
 * on per-frame paths (cut transitions).
 */
export function drawBlurredCoverBackdrop({
	ctx,
	width,
	height,
	source,
	sourceWidth,
	sourceHeight,
	blurIntensity,
	sourceIsStatic = false,
	preferCanvasFilter = false,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	blurIntensity: number;
	sourceIsStatic?: boolean;
	preferCanvasFilter?: boolean;
}) {
	const smallW = Math.max(1, Math.round(width / BACKGROUND_BLUR_DOWNSAMPLE));
	const smallH = Math.max(1, Math.round(height / BACKGROUND_BLUR_DOWNSAMPLE));
	const lowSigma =
		Math.max(0, blurIntensity) * BACKGROUND_BLUR_LOW_RES_SIGMA_PER_INTENSITY;

	const cacheKey = `${smallW}x${smallH}:${sourceWidth}x${sourceHeight}:${lowSigma}`;
	if (sourceIsStatic) {
		const hit = staticBlurCache.get(source as object);
		if (hit && hit.key === cacheKey) {
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(hit.canvas, 0, 0, width, height);
			return;
		}
	}

	const small = new OffscreenCanvas(smallW, smallH);
	const smallCtx = small.getContext("2d");
	if (!smallCtx) {
		drawCoverScaled({
			ctx,
			width,
			height,
			source,
			sourceWidth,
			sourceHeight,
		});
		return;
	}

	drawCoverScaled({
		ctx: smallCtx,
		width: smallW,
		height: smallH,
		source,
		sourceWidth,
		sourceHeight,
	});

	let blurred: OffscreenCanvas = small;
	if (lowSigma > 0.05) {
		if (isGpuAvailable() && !preferCanvasFilter) {
			const passes = buildGaussianBlurPasses({
				sigmaX: lowSigma,
				sigmaY: lowSigma,
			});
			if (passes.length > 0) {
				blurred = gpuRenderer.applyEffect({
					source: small,
					width: smallW,
					height: smallH,
					passes,
				});
			}
		} else {
			const filtered = new OffscreenCanvas(smallW, smallH);
			const filteredCtx = filtered.getContext("2d");
			if (filteredCtx) {
				filteredCtx.filter = `blur(${lowSigma}px)`;
				filteredCtx.drawImage(small, 0, 0);
				filteredCtx.filter = "none";
				blurred = filtered;
			}
		}
	}

	if (sourceIsStatic) {
		// Own copy: the GPU effect output canvas is reused by later calls.
		const copy =
			blurred === small ? small : new OffscreenCanvas(smallW, smallH);
		if (copy !== small) copy.getContext("2d")?.drawImage(blurred, 0, 0);
		staticBlurCache.set(source as object, { key: cacheKey, canvas: copy });
	}

	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(blurred, 0, 0, width, height);
}

export type StyleFillSource = {
	source: CanvasImageSource;
	width: number;
	height: number;
};

/**
 * Paint clip background fill full-bleed behind contain-placed media.
 * Fill opacity is always 1 (sibling layer in the scene graph).
 */
export function paintClipBackgroundFill({
	ctx,
	width,
	height,
	fill,
	mediaSource,
	mediaWidth,
	mediaHeight,
	styleSource,
	mediaIsStatic = false,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	fill: BackgroundFillSettings;
	/** Decoded media frame — used for blur cover. */
	mediaSource: CanvasImageSource;
	mediaWidth: number;
	mediaHeight: number;
	/** Preloaded style image when mode is style. */
	styleSource?: StyleFillSource | null;
	/** Media pixels never change for this source object (images). */
	mediaIsStatic?: boolean;
}) {
	if (!isBackgroundFillActive({ fill })) return;

	if (fill.mode === "color") {
		const cssColor = toCssPaintColor(fill.color);
		if (/gradient\(/i.test(cssColor)) {
			drawCssBackground({ ctx, width, height, css: cssColor });
		} else {
			ctx.fillStyle = cssColor;
			ctx.fillRect(0, 0, width, height);
		}
		return;
	}

	if (fill.mode === "blur") {
		drawBlurredCoverBackdrop({
			ctx,
			width,
			height,
			source: mediaSource,
			sourceWidth: mediaWidth,
			sourceHeight: mediaHeight,
			blurIntensity: fill.blurIntensity,
			// Static: blurred once with the GPU path, then cached.
			// Changing pixels (video): blur in-context to avoid a GPU readback stall.
			sourceIsStatic: mediaIsStatic,
			preferCanvasFilter: !mediaIsStatic,
		});
		return;
	}

	if (fill.mode === "style" && styleSource) {
		drawCoverScaled({
			ctx,
			width,
			height,
			source: styleSource.source,
			sourceWidth: styleSource.width,
			sourceHeight: styleSource.height,
		});
	}
}
