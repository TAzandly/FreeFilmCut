import {
	type BeautyImageSource,
	drawToCanvas,
	getImageSourceSize,
	isBrowserImagingAvailable,
} from "./image-source";
import {
	createOrtSession,
	loadOrt,
	modelFileExists,
	type OrtSession,
} from "./ort-runtime";
import type { FaceBox } from "./types";

export const YOLO_FACE_MODEL_URL = "/models/beauty/yolo-face.onnx";
export const YOLO_FACE_INPUT_SIZE = 640;
export const YOLO_FACE_SCORE_THRESHOLD = 0.4;
export const YOLO_FACE_NMS_IOU_THRESHOLD = 0.45;
export const YOLO_FACE_MAX_DETECTIONS = 16;
const YOLO_LETTERBOX_FILL = "rgb(114,114,114)";

export type LetterboxTransform = {
	scale: number;
	padX: number;
	padY: number;
};

export function computeLetterbox(
	width: number,
	height: number,
	inputSize = YOLO_FACE_INPUT_SIZE,
): LetterboxTransform {
	const scale = Math.min(inputSize / width, inputSize / height);
	return {
		scale,
		padX: (inputSize - width * scale) / 2,
		padY: (inputSize - height * scale) / 2,
	};
}

type ScoredBox = FaceBox & { score: number };

function iou(a: FaceBox, b: FaceBox): number {
	const x0 = Math.max(a.x, b.x);
	const y0 = Math.max(a.y, b.y);
	const x1 = Math.min(a.x + a.w, b.x + b.w);
	const y1 = Math.min(a.y + a.h, b.y + b.h);
	const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
	const union = a.w * a.h + b.w * b.h - inter;
	return union <= 0 ? 0 : inter / union;
}

/** Greedy non-maximum suppression; input need not be sorted. */
export function nonMaxSuppression<T extends FaceBox & { score: number }>(
	boxes: T[],
	iouThreshold = YOLO_FACE_NMS_IOU_THRESHOLD,
	maxDetections = YOLO_FACE_MAX_DETECTIONS,
): T[] {
	const sorted = [...boxes].sort((a, b) => b.score - a.score);
	const kept: T[] = [];
	for (const candidate of sorted) {
		if (kept.every((k) => iou(k, candidate) < iouThreshold)) {
			kept.push(candidate);
			if (kept.length >= maxDetections) break;
		}
	}
	return kept;
}

/**
 * Decode a YOLOv8-/v11-face (`[1, 4+1(+kpts), N]`) or YOLOv5-face
 * (`[1, N, 5+…]`) output into normalized image-space boxes.
 * Layout is auto-detected: the smaller of the two trailing dims is the
 * channel axis. Channel 4 is the face score (class score or objectness).
 */
export function decodeYoloFaceOutput({
	data,
	dims,
	imageWidth,
	imageHeight,
	inputSize = YOLO_FACE_INPUT_SIZE,
	scoreThreshold = YOLO_FACE_SCORE_THRESHOLD,
	iouThreshold = YOLO_FACE_NMS_IOU_THRESHOLD,
}: {
	data: ArrayLike<number>;
	dims: readonly number[];
	imageWidth: number;
	imageHeight: number;
	inputSize?: number;
	scoreThreshold?: number;
	iouThreshold?: number;
}): FaceBox[] {
	if (dims.length !== 3 || imageWidth <= 0 || imageHeight <= 0) return [];
	const [, d1, d2] = dims;
	const channelsFirst = d1 < d2;
	const channels = channelsFirst ? d1 : d2;
	const count = channelsFirst ? d2 : d1;
	if (channels < 5) return [];
	const at = (channel: number, i: number) =>
		channelsFirst ? data[channel * count + i] : data[i * channels + channel];

	const { scale, padX, padY } = computeLetterbox(
		imageWidth,
		imageHeight,
		inputSize,
	);
	const candidates: ScoredBox[] = [];
	for (let i = 0; i < count; i++) {
		const score = at(4, i);
		if (!(score >= scoreThreshold)) continue;
		const cx = at(0, i);
		const cy = at(1, i);
		const w = at(2, i);
		const h = at(3, i);
		const x0 = Math.max(0, (cx - w / 2 - padX) / scale);
		const y0 = Math.max(0, (cy - h / 2 - padY) / scale);
		const x1 = Math.min(imageWidth, (cx + w / 2 - padX) / scale);
		const y1 = Math.min(imageHeight, (cy + h / 2 - padY) / scale);
		if (x1 <= x0 || y1 <= y0) continue;
		candidates.push({
			x: x0 / imageWidth,
			y: y0 / imageHeight,
			w: (x1 - x0) / imageWidth,
			h: (y1 - y0) / imageHeight,
			score,
		});
	}
	return nonMaxSuppression(candidates, iouThreshold).map(
		({ x, y, w, h }) => ({ x, y, w, h }),
	);
}

let sessionPromise: Promise<OrtSession | null> | null = null;
let missingLogged = false;
let modelUrl = YOLO_FACE_MODEL_URL;

export function configureYoloFace(options: { modelUrl?: string }): void {
	if (options.modelUrl) modelUrl = options.modelUrl;
	sessionPromise = null;
	missingLogged = false;
}

function logMissingOnce(reason: string): void {
	if (missingLogged) return;
	missingLogged = true;
	console.warn(
		`[beauty] YOLO-Face unavailable (${reason}); skipping detector fallback. ` +
			`Place the model at ${modelUrl} (see public/models/beauty/README.md).`,
	);
}

function getSession(): Promise<OrtSession | null> {
	if (!sessionPromise) {
		sessionPromise = (async () => {
			if (!(await modelFileExists(modelUrl))) {
				logMissingOnce("model file not found");
				return null;
			}
			try {
				return await createOrtSession(modelUrl);
			} catch (error) {
				logMissingOnce(
					error instanceof Error ? error.message : "session creation failed",
				);
				return null;
			}
		})();
	}
	return sessionPromise;
}

function preprocess(
	image: BeautyImageSource,
	width: number,
	height: number,
): Float32Array {
	const size = YOLO_FACE_INPUT_SIZE;
	const { scale, padX, padY } = computeLetterbox(width, height, size);
	const { ctx } = drawToCanvas({
		source: image,
		outWidth: size,
		outHeight: size,
		fill: YOLO_LETTERBOX_FILL,
		dest: {
			x: padX,
			y: padY,
			w: Math.round(width * scale),
			h: Math.round(height * scale),
		},
	});
	const { data } = ctx.getImageData(0, 0, size, size);
	const plane = size * size;
	const tensor = new Float32Array(3 * plane);
	for (let i = 0; i < plane; i++) {
		tensor[i] = data[i * 4] / 255;
		tensor[plane + i] = data[i * 4 + 1] / 255;
		tensor[2 * plane + i] = data[i * 4 + 2] / 255;
	}
	return tensor;
}

/**
 * Detect faces with YOLO-Face. Returns normalized boxes (0..1).
 * Returns `[]` (and logs once) when the model file is missing or ORT fails.
 */
export async function detectFacesYolo(
	image: BeautyImageSource,
): Promise<FaceBox[]> {
	if (!isBrowserImagingAvailable()) return [];
	const { width, height } = getImageSourceSize(image);
	if (width <= 0 || height <= 0) return [];
	const session = await getSession();
	if (!session) return [];
	try {
		const ort = await loadOrt();
		const size = YOLO_FACE_INPUT_SIZE;
		const input = new ort.Tensor("float32", preprocess(image, width, height), [
			1,
			3,
			size,
			size,
		]);
		const outputs = await session.run({ [session.inputNames[0]]: input });
		const output = outputs[session.outputNames[0]];
		return decodeYoloFaceOutput({
			data: output.data as Float32Array,
			dims: output.dims,
			imageWidth: width,
			imageHeight: height,
		});
	} catch (error) {
		logMissingOnce(
			error instanceof Error ? error.message : "inference failed",
		);
		return [];
	}
}
