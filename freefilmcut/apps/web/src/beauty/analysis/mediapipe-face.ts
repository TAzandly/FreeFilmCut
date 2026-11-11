import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import {
	type BeautyImageSource,
	getImageSourceSize,
} from "./image-source";
import type { FaceBox, FaceLandmarks } from "./types";

export const MEDIAPIPE_FACE_LANDMARK_COUNT = 478;
export const MEDIAPIPE_MAX_FACES = 4;

/** Keep in sync with `@mediapipe/tasks-vision` in package.json. */
export const MEDIAPIPE_TASKS_VISION_VERSION = "1.2.2";
export const MEDIAPIPE_WASM_CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;
export const MEDIAPIPE_FACE_MODEL_URL = "/models/beauty/face_landmarker.task";

export type MediapipeFaceConfig = {
	wasmBaseUrl?: string;
	modelUrl?: string;
};

let config: MediapipeFaceConfig = {};
let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/** Override wasm / model locations (call before first `detectFacesMediapipe`). */
export function configureMediapipeFace(next: MediapipeFaceConfig): void {
	config = { ...config, ...next };
	landmarkerPromise = null;
}

async function createLandmarker(): Promise<FaceLandmarker> {
	if (typeof window === "undefined" && typeof self === "undefined") {
		throw new Error("MediaPipe FaceLandmarker requires a browser runtime");
	}
	const { FaceLandmarker, FilesetResolver } = await import(
		"@mediapipe/tasks-vision"
	);
	const fileset = await FilesetResolver.forVisionTasks(
		config.wasmBaseUrl ?? MEDIAPIPE_WASM_CDN_BASE,
	);
	return FaceLandmarker.createFromOptions(fileset, {
		baseOptions: {
			modelAssetPath: config.modelUrl ?? MEDIAPIPE_FACE_MODEL_URL,
		},
		runningMode: "IMAGE",
		numFaces: MEDIAPIPE_MAX_FACES,
		outputFaceBlendshapes: false,
		outputFacialTransformationMatrixes: false,
	});
}

function getLandmarker(): Promise<FaceLandmarker> {
	if (!landmarkerPromise) {
		landmarkerPromise = createLandmarker().catch((error) => {
			landmarkerPromise = null;
			throw error;
		});
	}
	return landmarkerPromise;
}

export function boxFromPoints(points: Float32Array): FaceBox {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i + 1 < points.length; i += 2) {
		const x = points[i];
		const y = points[i + 1];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
	const x0 = Math.max(0, minX);
	const y0 = Math.max(0, minY);
	const x1 = Math.min(1, maxX);
	const y1 = Math.min(1, maxY);
	return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Convert MediaPipe `NormalizedLandmark[][]` into `FaceLandmarks[]`. */
export function landmarksToFaces(
	faceLandmarks: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
): FaceLandmarks[] {
	const faces: FaceLandmarks[] = [];
	for (const landmarks of faceLandmarks) {
		if (landmarks.length < MEDIAPIPE_FACE_LANDMARK_COUNT) continue;
		const points = new Float32Array(MEDIAPIPE_FACE_LANDMARK_COUNT * 2);
		for (let i = 0; i < MEDIAPIPE_FACE_LANDMARK_COUNT; i++) {
			points[i * 2] = landmarks[i].x;
			points[i * 2 + 1] = landmarks[i].y;
		}
		faces.push({ points, box: boxFromPoints(points) });
	}
	return faces;
}

/** Detect faces with MediaPipe FaceLandmarker (IMAGE mode, up to 4 faces). */
export async function detectFacesMediapipe(
	image: BeautyImageSource,
): Promise<FaceLandmarks[]> {
	const { width, height } = getImageSourceSize(image);
	if (width <= 0 || height <= 0) return [];
	const landmarker = await getLandmarker();
	const result = landmarker.detect(image);
	return landmarksToFaces(result.faceLandmarks ?? []);
}

export function disposeMediapipeFace(): void {
	const pending = landmarkerPromise;
	landmarkerPromise = null;
	void pending?.then((landmarker) => landmarker.close()).catch(() => {});
}
