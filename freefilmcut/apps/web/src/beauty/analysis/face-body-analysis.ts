import { BeautyAnalysisCache } from "./cache";
import {
	type BeautyImageSource,
	cropToCanvas,
	getImageSourceSize,
	type PixelRect,
} from "./image-source";
import { buildLandmarkFallbackMask } from "./landmark-fallback-mask";
import {
	boxFromPoints,
	detectFacesMediapipe,
	MEDIAPIPE_MAX_FACES,
} from "./mediapipe-face";
import {
	SELFIE_SKIN_SIZE,
	type SkinSegmentation,
	segmentSkinSelfie,
} from "./selfie-skin";
import type { BeautyAnalysisFrame, FaceBox, FaceLandmarks } from "./types";
import { detectFacesYolo } from "./yolo-face";

/** YOLO box is grown by this factor (around its center) before the crop pass. */
export const YOLO_CROP_PAD = 1.3;
/** Face boxes are grown by this factor when clipping the selfie skin mask. */
export const SKIN_FACE_BOX_EXPAND = 1.5;
/** Faces from different passes overlapping above this IoU are duplicates. */
export const FACE_DEDUPE_IOU = 0.5;
/** Minimum crop edge (px) worth sending to MediaPipe. */
const MIN_CROP_PX = 16;

export type AnalyzeBeautyFrameParams = {
	clipId: string;
	mediaTimeTicks: number;
	image: BeautyImageSource;
};

export type FaceBodyAnalysisDeps = {
	cache: BeautyAnalysisCache;
	detectFaces: (image: BeautyImageSource) => Promise<FaceLandmarks[]>;
	detectYoloBoxes: (image: BeautyImageSource) => Promise<FaceBox[]>;
	segmentSkin: (image: BeautyImageSource) => Promise<SkinSegmentation | null>;
	cropImage: (image: BeautyImageSource, rect: PixelRect) => BeautyImageSource;
	getImageSize: (image: BeautyImageSource) => { width: number; height: number };
};

export const beautyAnalysisCache = new BeautyAnalysisCache();

const defaultDeps: FaceBodyAnalysisDeps = {
	cache: beautyAnalysisCache,
	detectFaces: detectFacesMediapipe,
	detectYoloBoxes: detectFacesYolo,
	segmentSkin: segmentSkinSelfie,
	cropImage: cropToCanvas,
	getImageSize: getImageSourceSize,
};

let mediapipeErrorLogged = false;

function boxIou(a: FaceBox, b: FaceBox): number {
	const x0 = Math.max(a.x, b.x);
	const y0 = Math.max(a.y, b.y);
	const x1 = Math.min(a.x + a.w, b.x + b.w);
	const y1 = Math.min(a.y + a.h, b.y + b.h);
	const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
	const union = a.w * a.h + b.w * b.h - inter;
	return union <= 0 ? 0 : inter / union;
}

/** Normalized box -> padded, integer, image-clamped pixel rect. */
export function padBoxToPixelRect(
	box: FaceBox,
	imageWidth: number,
	imageHeight: number,
	pad = YOLO_CROP_PAD,
): PixelRect {
	const cx = (box.x + box.w / 2) * imageWidth;
	const cy = (box.y + box.h / 2) * imageHeight;
	const w = box.w * imageWidth * pad;
	const h = box.h * imageHeight * pad;
	const x0 = Math.max(0, Math.floor(cx - w / 2));
	const y0 = Math.max(0, Math.floor(cy - h / 2));
	const x1 = Math.min(imageWidth, Math.ceil(cx + w / 2));
	const y1 = Math.min(imageHeight, Math.ceil(cy + h / 2));
	return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Map crop-normalized landmarks back to full-image normalized coordinates. */
export function mapCropFaceToFullImage(
	face: FaceLandmarks,
	crop: PixelRect,
	imageWidth: number,
	imageHeight: number,
): FaceLandmarks {
	const points = new Float32Array(face.points.length);
	for (let i = 0; i + 1 < points.length; i += 2) {
		points[i] = (crop.x + face.points[i] * crop.w) / imageWidth;
		points[i + 1] = (crop.y + face.points[i + 1] * crop.h) / imageHeight;
	}
	return { points, box: boxFromPoints(points) };
}

function mergeFaces(
	into: FaceLandmarks[],
	incoming: FaceLandmarks[],
	max = MEDIAPIPE_MAX_FACES,
): void {
	for (const face of incoming) {
		if (into.length >= max) return;
		if (into.every((f) => boxIou(f.box, face.box) < FACE_DEDUPE_IOU)) {
			into.push(face);
		}
	}
}

async function detectFacesViaYolo(
	image: BeautyImageSource,
	width: number,
	height: number,
	deps: FaceBodyAnalysisDeps,
): Promise<FaceLandmarks[]> {
	const boxes = await deps.detectYoloBoxes(image);
	const faces: FaceLandmarks[] = [];
	for (const box of boxes) {
		if (faces.length >= MEDIAPIPE_MAX_FACES) break;
		const rect = padBoxToPixelRect(box, width, height);
		if (rect.w < MIN_CROP_PX || rect.h < MIN_CROP_PX) continue;
		const crop = deps.cropImage(image, rect);
		const cropFaces = await deps.detectFaces(crop);
		mergeFaces(
			faces,
			cropFaces.map((f) => mapCropFaceToFullImage(f, rect, width, height)),
		);
	}
	return faces;
}

/** Zero skin pixels outside the union of expanded face boxes. */
export function clipMaskToFaceBoxes(
	mask: Uint8Array,
	width: number,
	height: number,
	faces: readonly Pick<FaceLandmarks, "box">[],
	expand = SKIN_FACE_BOX_EXPAND,
): Uint8Array {
	const allowed = new Uint8Array(width * height);
	for (const { box } of faces) {
		const cx = box.x + box.w / 2;
		const cy = box.y + box.h / 2;
		const hw = (box.w * expand) / 2;
		const hh = (box.h * expand) / 2;
		const x0 = Math.max(0, Math.floor((cx - hw) * width));
		const x1 = Math.min(width, Math.ceil((cx + hw) * width));
		const y0 = Math.max(0, Math.floor((cy - hh) * height));
		const y1 = Math.min(height, Math.ceil((cy + hh) * height));
		for (let y = y0; y < y1; y++) allowed.fill(1, y * width + x0, y * width + x1);
	}
	const out = new Uint8Array(mask.length);
	for (let i = 0; i < mask.length; i++) out[i] = allowed[i] ? mask[i] : 0;
	return out;
}

/**
 * Detect faces + skin mask for one video frame.
 * Cached per `(clipId, quantized mediaTimeTicks)`.
 */
export async function analyzeBeautyFrame(
	{ clipId, mediaTimeTicks, image }: AnalyzeBeautyFrameParams,
	overrides: Partial<FaceBodyAnalysisDeps> = {},
): Promise<BeautyAnalysisFrame> {
	const deps = { ...defaultDeps, ...overrides };

	const cached = deps.cache.get(clipId, mediaTimeTicks);
	if (cached) return cached;

	const { width, height } = deps.getImageSize(image);

	let faces: FaceLandmarks[] = [];
	let source: BeautyAnalysisFrame["source"] = "mediapipe";
	let detectionFailed = false;

	try {
		faces = await deps.detectFaces(image);
		if (faces.length === 0 && width > 0 && height > 0) {
			const viaYolo = await detectFacesViaYolo(image, width, height, deps);
			if (viaYolo.length > 0) {
				faces = viaYolo;
				source = "yolo+mediapipe";
			}
		}
	} catch (error) {
		detectionFailed = true;
		faces = [];
		if (!mediapipeErrorLogged) {
			mediapipeErrorLogged = true;
			console.warn("[beauty] Face landmark detection failed:", error);
		}
	}

	let seg: SkinSegmentation | null = null;
	try {
		seg = await deps.segmentSkin(image);
	} catch {
		seg = null;
	}

	let skinWidth: number;
	let skinHeight: number;
	let skinMask: Uint8Array;
	if (seg) {
		skinWidth = seg.width;
		skinHeight = seg.height;
		skinMask =
			faces.length > 0
				? clipMaskToFaceBoxes(seg.mask, skinWidth, skinHeight, faces)
				: seg.mask;
	} else {
		skinWidth = SELFIE_SKIN_SIZE;
		skinHeight = SELFIE_SKIN_SIZE;
		skinMask = buildLandmarkFallbackMask(faces, skinWidth, skinHeight);
		if (faces.length > 0) source = "landmarks-only-mask";
	}

	const frame: BeautyAnalysisFrame = {
		clipId,
		mediaTimeTicks,
		faces,
		skinWidth,
		skinHeight,
		skinMask,
		source,
	};
	// Do not pin transient detector failures in the cache.
	if (!detectionFailed) deps.cache.set(clipId, mediaTimeTicks, frame);
	return frame;
}
