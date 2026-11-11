import { BeautyAnalysisCache } from "./cache";
import {
	type BeautyImageSource,
	getImageSourceSize,
	type PixelRect,
} from "./image-source";
import {
	buildBoxFallbackMask,
	buildLandmarkFallbackMask,
	clipMaskToFaceOvals,
} from "./landmark-fallback-mask";
import { blurSkinMask } from "./mask-blur";
import { boxFromPoints, detectFacesMediapipe } from "./mediapipe-face";
import { DLMV_SKIN_SIZE } from "./dlmv-skin";
import {
	type SkinSegmentation,
	segmentSkin,
} from "./segment-skin";
import type { BeautyAnalysisFrame, FaceBox, FaceLandmarks } from "./types";

/** Default pad when expanding a normalized box to pixel crop (tests / helpers). */
export const YOLO_CROP_PAD = 1.5;
/** Face boxes are grown by this factor when clipping a legacy face-bound mask. */
export const SKIN_FACE_BOX_EXPAND = 1.55;
/**
 * If the face-oval clip keeps less than this fraction of the box-clipped mask,
 * the oval is treated as collapsed (typical of side faces) and we keep the box.
 */
export const SKIN_OVAL_MIN_KEEP = 0.4;

export type AnalyzeBeautyFrameParams = {
	clipId: string;
	mediaTimeTicks: number;
	image: BeautyImageSource;
};

export type FaceBodyAnalysisDeps = {
	cache: Pick<BeautyAnalysisCache, "get" | "set">;
	detectFaces: (image: BeautyImageSource) => Promise<FaceLandmarks[]>;
	segmentSkin: (image: BeautyImageSource) => Promise<SkinSegmentation | null>;
	getImageSize: (image: BeautyImageSource) => { width: number; height: number };
};

export const beautyAnalysisCache = new BeautyAnalysisCache();

const defaultDeps: FaceBodyAnalysisDeps = {
	cache: beautyAnalysisCache,
	detectFaces: detectFacesMediapipe,
	segmentSkin: segmentSkin,
	getImageSize: getImageSourceSize,
};

let mediapipeErrorLogged = false;

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

function maskCoverage(mask: Uint8Array): number {
	let n = 0;
	for (let i = 0; i < mask.length; i++) if (mask[i] > 0) n++;
	return n;
}

/**
 * Clip selfie skin to the faces. Prefer the face oval (drops neck), but fall
 * back to the expanded AABB when the oval collapses — common on side faces
 * where MediaPipe's mesh folds in on itself.
 */
export function clipSkinMaskToFaces(
	mask: Uint8Array,
	width: number,
	height: number,
	faces: readonly FaceLandmarks[],
	boxes: readonly FaceBox[] = [],
): Uint8Array {
	const boxSources =
		faces.length > 0 ? faces : boxes.map((box) => ({ box }));
	if (boxSources.length === 0) return mask;
	const byBox = clipMaskToFaceBoxes(mask, width, height, boxSources);
	if (faces.length === 0) return byBox;
	const byOval = clipMaskToFaceOvals(byBox, width, height, faces);
	const boxCount = maskCoverage(byBox);
	if (boxCount > 0 && maskCoverage(byOval) < boxCount * SKIN_OVAL_MIN_KEEP) {
		return byBox;
	}
	return byOval;
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

export type BeautyFaceDetection = {
	faces: FaceLandmarks[];
	/** Landmark boxes (for optional legacy mask helpers / skinBoxes). */
	boxes: FaceBox[];
	source: "mediapipe";
	/** The detector threw (vs. simply found no face); results must not be cached. */
	failed: boolean;
};

/** MediaPipe Face Landmarker only — no YOLO fallback. */
export async function detectBeautyFaces(
	image: BeautyImageSource,
	overrides: Partial<FaceBodyAnalysisDeps> = {},
): Promise<BeautyFaceDetection> {
	const deps = { ...defaultDeps, ...overrides };
	try {
		const faces = await deps.detectFaces(image);
		return {
			faces,
			boxes: faces.map((f) => f.box),
			source: "mediapipe",
			failed: false,
		};
	} catch (error) {
		if (!mediapipeErrorLogged) {
			mediapipeErrorLogged = true;
			console.warn("[beauty] Face landmark detection failed:", error);
		}
		return { faces: [], boxes: [], source: "mediapipe", failed: true };
	}
}

export type ComposedSkinMask = {
	skinWidth: number;
	skinHeight: number;
	skinMask: Uint8Array;
	/** False when the landmark polygon stood in for segmentation. */
	segmented: boolean;
};

/**
 * Final skin mask for smooth / whiten.
 *
 * When a skin segmenter ran, its full mask is used as-is (face + body skin) —
 * not clipped to face landmarks. Landmark / box fallbacks only apply when
 * segmentation is unavailable.
 */
export function composeSkinMask(
	faces: readonly FaceLandmarks[],
	seg: SkinSegmentation | null,
	boxes: readonly FaceBox[] = [],
): ComposedSkinMask {
	let skinWidth: number;
	let skinHeight: number;
	let skinMask: Uint8Array;
	if (seg) {
		skinWidth = seg.width;
		skinHeight = seg.height;
		skinMask = seg.mask;
	} else {
		skinWidth = DLMV_SKIN_SIZE;
		skinHeight = DLMV_SKIN_SIZE;
		skinMask =
			faces.length > 0
				? buildLandmarkFallbackMask(faces, skinWidth, skinHeight)
				: buildBoxFallbackMask(boxes, skinWidth, skinHeight);
	}
	// Soften hard class / polygon edges before smooth+whiten sample the mask.
	skinMask = blurSkinMask(skinMask, skinWidth, skinHeight);
	return { skinWidth, skinHeight, skinMask, segmented: seg !== null };
}

export function beautyFrameFrom(
	clipId: string,
	mediaTimeTicks: number,
	detection: Pick<BeautyFaceDetection, "faces" | "boxes" | "source">,
	mask: ComposedSkinMask,
): BeautyAnalysisFrame {
	return {
		clipId,
		mediaTimeTicks,
		faces: detection.faces,
		skinBoxes:
			detection.faces.length === 0 && detection.boxes.length > 0
				? detection.boxes
				: undefined,
		skinWidth: mask.skinWidth,
		skinHeight: mask.skinHeight,
		skinMask: mask.skinMask,
		source:
			!mask.segmented && detection.faces.length > 0
				? "landmarks-only-mask"
				: detection.source,
	};
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

	const detection = await detectBeautyFaces(image, deps);

	let seg: SkinSegmentation | null = null;
	try {
		seg = await deps.segmentSkin(image);
	} catch {
		seg = null;
	}

	const frame = beautyFrameFrom(
		clipId,
		mediaTimeTicks,
		detection,
		composeSkinMask(detection.faces, seg, detection.boxes),
	);
	// Do not pin transient detector failures in the cache.
	if (!detection.failed) deps.cache.set(clipId, mediaTimeTicks, frame);
	return frame;
}
