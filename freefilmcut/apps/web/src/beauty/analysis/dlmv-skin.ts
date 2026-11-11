import {
	type BeautyImageSource,
	drawToCanvas,
	isBrowserImagingAvailable,
} from "./image-source";
import {
	createOrtSession,
	loadOrt,
	modelFileExists,
	type OrtSession,
} from "./ort-runtime";
import type { SkinSegmentation } from "./selfie-skin";

/**
 * DeepLabV3 + MobileNetV3 skin segmentation (samhaswon/skin_segmentation).
 * GPL-3.0 weights — confirm license before shipping in a closed product.
 */
export const DLMV_SKIN_MODEL_URL = "/models/beauty/dlmv.onnx";
export const DLMV_SKIN_SIZE = 256;
/** Drop soft tails below this after min-max normalize (0..1). */
export const DLMV_SKIN_FLOOR = 0.15;

let sessionPromise: Promise<OrtSession | null> | null = null;
let unavailableLogged = false;
let modelUrl = DLMV_SKIN_MODEL_URL;

export function configureDlmvSkin(options: { modelUrl?: string }): void {
	if (options.modelUrl) modelUrl = options.modelUrl;
	sessionPromise = null;
	unavailableLogged = false;
}

function logUnavailableOnce(reason: string): void {
	if (unavailableLogged) return;
	unavailableLogged = true;
	console.warn(
		`[beauty] DLMV skin segmentation unavailable (${reason}); trying fallback. ` +
			`Place the model at ${modelUrl} (see public/models/beauty/README.md).`,
	);
}

function getSession(): Promise<OrtSession | null> {
	if (!sessionPromise) {
		sessionPromise = (async () => {
			if (!(await modelFileExists(modelUrl))) {
				logUnavailableOnce("model file not found");
				return null;
			}
			try {
				return await createOrtSession(modelUrl);
			} catch (error) {
				logUnavailableOnce(
					error instanceof Error ? error.message : "session creation failed",
				);
				return null;
			}
		})();
	}
	return sessionPromise;
}

/** Load the DLMV session ahead of time; rejects when it is unavailable. */
export async function preloadDlmvSkin(): Promise<void> {
	if (!(await getSession())) {
		throw new Error("dlmv skin model unavailable");
	}
}

/**
 * Decode DLMV output `[1,1,H,W]` / `[1,H,W]` / `[H,W]` into an R8 soft mask.
 * Matches the upstream ONNX session: min-max normalize, then scale to 0..255.
 */
export function skinMaskFromDlmvOutput(
	data: ArrayLike<number>,
	dims: readonly number[],
	floor = DLMV_SKIN_FLOOR,
): SkinSegmentation | null {
	let width: number;
	let height: number;
	if (dims.length === 4 && dims[0] === 1 && dims[1] === 1) {
		// [1,1,H,W]
		height = dims[2];
		width = dims[3];
	} else if (dims.length === 3 && dims[0] === 1) {
		height = dims[1];
		width = dims[2];
	} else if (dims.length === 2) {
		height = dims[0];
		width = dims[1];
	} else {
		return null;
	}
	if (!(width > 0 && height > 0)) return null;
	const plane = width * height;
	if (data.length < plane) return null;

	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < plane; i++) {
		const v = data[i];
		if (v < min) min = v;
		if (v > max) max = v;
	}
	const span = max - min;
	const mask = new Uint8Array(plane);
	if (!(span > 1e-8)) return { width, height, mask };
	const inv = 1 / span;
	const floorV = floor;
	for (let i = 0; i < plane; i++) {
		const n = (data[i] - min) * inv;
		mask[i] = n < floorV ? 0 : Math.round(n * 255);
	}
	return { width, height, mask };
}

/**
 * Segment all skin (face + body) with DLMV. Returns `null` when the model is
 * missing or inference fails so callers can fall back.
 */
export async function segmentSkinDlmv(
	image: BeautyImageSource,
): Promise<SkinSegmentation | null> {
	if (!isBrowserImagingAvailable()) return null;
	const session = await getSession();
	if (!session) return null;
	try {
		const ort = await loadOrt();
		const size = DLMV_SKIN_SIZE;
		const { ctx } = drawToCanvas({
			source: image,
			outWidth: size,
			outHeight: size,
		});
		const { data } = ctx.getImageData(0, 0, size, size);
		const plane = size * size;
		// Upstream session: RGB / 255, NCHW — no ImageNet mean/std.
		const tensor = new Float32Array(3 * plane);
		for (let i = 0; i < plane; i++) {
			tensor[i] = data[i * 4] / 255;
			tensor[plane + i] = data[i * 4 + 1] / 255;
			tensor[2 * plane + i] = data[i * 4 + 2] / 255;
		}
		const input = new ort.Tensor("float32", tensor, [1, 3, size, size]);
		const outputs = await session.run({ [session.inputNames[0]]: input });
		const output = outputs[session.outputNames[0]];
		const result = skinMaskFromDlmvOutput(
			output.data as Float32Array,
			output.dims,
		);
		if (!result) {
			logUnavailableOnce(`unexpected output shape [${output.dims.join(",")}]`);
			return null;
		}
		return result;
	} catch (error) {
		logUnavailableOnce(error instanceof Error ? error.message : "inference failed");
		return null;
	}
}
