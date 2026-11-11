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

export const SELFIE_SKIN_MODEL_URL =
	"/models/beauty/selfie_multiclass_256x256.onnx";
export const SELFIE_SKIN_SIZE = 256;

/**
 * MediaPipe Selfie Multiclass classes:
 * 0 background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 others.
 *
 * Beauty only uses **face-skin** (3). Including body-skin (2) paints the neck
 * and leaves a hard whitening/smoothing band under the chin.
 */
export const SELFIE_CLASS_COUNT = 6;
export const SELFIE_SKIN_CLASSES: readonly number[] = [3];

export type SkinSegmentation = {
	width: number;
	height: number;
	/** R8 mask, 255 = skin. */
	mask: Uint8Array;
};

let sessionPromise: Promise<OrtSession | null> | null = null;
let unavailableLogged = false;
let modelUrl = SELFIE_SKIN_MODEL_URL;

export function configureSelfieSkin(options: { modelUrl?: string }): void {
	if (options.modelUrl) modelUrl = options.modelUrl;
	sessionPromise = null;
	unavailableLogged = false;
}

function logUnavailableOnce(reason: string): void {
	if (unavailableLogged) return;
	unavailableLogged = true;
	console.warn(
		`[beauty] Selfie skin segmentation unavailable (${reason}); using landmark mask. ` +
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

/** Load the selfie session ahead of time; rejects when it is unavailable. */
export async function preloadSelfieSkin(): Promise<void> {
	if (!(await getSession())) {
		throw new Error("selfie skin model unavailable");
	}
}

/**
 * Argmax over class probabilities and mark skin classes.
 * Supports NHWC `[1,H,W,6]` and NCHW `[1,6,H,W]` outputs.
 */
export function skinMaskFromSegmentation(
	data: ArrayLike<number>,
	dims: readonly number[],
	skinClasses: readonly number[] = SELFIE_SKIN_CLASSES,
): SkinSegmentation | null {
	if (dims.length !== 4) return null;
	const nhwc = dims[3] === SELFIE_CLASS_COUNT;
	const nchw = dims[1] === SELFIE_CLASS_COUNT;
	if (!nhwc && !nchw) return null;
	const height = nhwc ? dims[1] : dims[2];
	const width = nhwc ? dims[2] : dims[3];
	const plane = width * height;
	const isSkin = new Set(skinClasses);
	const mask = new Uint8Array(plane);
	for (let i = 0; i < plane; i++) {
		let best = 0;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (let c = 0; c < SELFIE_CLASS_COUNT; c++) {
			const v = nhwc ? data[i * SELFIE_CLASS_COUNT + c] : data[c * plane + i];
			if (v > bestScore) {
				bestScore = v;
				best = c;
			}
		}
		mask[i] = isSkin.has(best) ? 255 : 0;
	}
	return { width, height, mask };
}

function inputIsNchw(session: OrtSession): boolean {
	const meta = (
		session as unknown as {
			inputMetadata?: Record<string, { shape?: ReadonlyArray<number | string> }>;
		}
	).inputMetadata?.[session.inputNames[0]];
	const shape = meta?.shape;
	return Array.isArray(shape) && shape.length === 4 && shape[1] === 3;
}

/**
 * Segment skin with MediaPipe Selfie Multiclass (ONNX).
 * Returns `null` when the model is missing or inference fails so callers can
 * fall back to landmark masks.
 */
export async function segmentSkinSelfie(
	image: BeautyImageSource,
): Promise<SkinSegmentation | null> {
	if (!isBrowserImagingAvailable()) return null;
	const session = await getSession();
	if (!session) return null;
	try {
		const ort = await loadOrt();
		const size = SELFIE_SKIN_SIZE;
		const { ctx } = drawToCanvas({
			source: image,
			outWidth: size,
			outHeight: size,
		});
		const { data } = ctx.getImageData(0, 0, size, size);
		const plane = size * size;
		const nchw = inputIsNchw(session);
		const tensor = new Float32Array(3 * plane);
		for (let i = 0; i < plane; i++) {
			const r = data[i * 4] / 255;
			const g = data[i * 4 + 1] / 255;
			const b = data[i * 4 + 2] / 255;
			if (nchw) {
				tensor[i] = r;
				tensor[plane + i] = g;
				tensor[2 * plane + i] = b;
			} else {
				tensor[i * 3] = r;
				tensor[i * 3 + 1] = g;
				tensor[i * 3 + 2] = b;
			}
		}
		const input = new ort.Tensor(
			"float32",
			tensor,
			nchw ? [1, 3, size, size] : [1, size, size, 3],
		);
		const outputs = await session.run({ [session.inputNames[0]]: input });
		const output = outputs[session.outputNames[0]];
		const result = skinMaskFromSegmentation(
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
