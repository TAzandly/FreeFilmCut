import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { resolveAssetUrl } from "./asset-url";
import {
	type BeautyImageSource,
	getImageSourceSize,
} from "./image-source";
import {
	withQuietNativeLogs,
	withQuietNativeLogsAsync,
} from "./native-log-quiet";
import type { FaceBox, FaceLandmarks } from "./types";

export const MEDIAPIPE_FACE_LANDMARK_COUNT = 478;
export const MEDIAPIPE_MAX_FACES = 4;

/** Keep in sync with `@mediapipe/tasks-vision` in package.json. */
export const MEDIAPIPE_TASKS_VISION_VERSION = "1.2.2";

/** Same-origin files populated by `scripts/sync-beauty-vendor.mjs`. */
export const MEDIAPIPE_ESM_URL =
	"/vendor/mediapipe-tasks-vision/vision_bundle.mjs";
export const MEDIAPIPE_WASM_BASE = "/vendor/mediapipe-tasks-vision/wasm";

/** jsDelivr fallback (prefer local vendor). */
export const MEDIAPIPE_WASM_CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;
export const MEDIAPIPE_ESM_CDN_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/vision_bundle.mjs`;
export const MEDIAPIPE_FACE_MODEL_URL = "/models/beauty/face_landmarker.task";

	export type MediapipeFaceConfig = {
		/** Absolute URL or path to `vision_bundle.mjs`. */
		esmUrl?: string;
		wasmBaseUrl?: string;
		modelUrl?: string;
		/**
		 * When true, Face Landmarker also returns facial transformation matrices
		 * (needed by face-fx `faceMatrix` bind). Recreates the landmarker.
		 */
		outputFacialTransformationMatrixes?: boolean;
	};
	
	let config: MediapipeFaceConfig = {};
	let landmarkerPromise: Promise<FaceLandmarker> | null = null;
	
	/** Override ESM / wasm / model locations (call before first `detectFacesMediapipe`). */
	export function configureMediapipeFace(next: MediapipeFaceConfig): void {
		config = { ...config, ...next };
		landmarkerPromise = null;
	}

	/** Enable / disable transformation matrices without touching asset URLs. */
	export function setMediapipeFacialTransformationMatrixes(
		enabled: boolean,
	): void {
		if (config.outputFacialTransformationMatrixes === enabled) return;
		configureMediapipeFace({ outputFacialTransformationMatrixes: enabled });
	}

async function createLandmarker(): Promise<FaceLandmarker> {
	if (typeof window === "undefined" && typeof self === "undefined") {
		throw new Error("MediaPipe FaceLandmarker requires a browser runtime");
	}
	return withQuietNativeLogsAsync(async () => {
		const esmUrl = resolveAssetUrl(config.esmUrl ?? MEDIAPIPE_ESM_URL);
		// Runtime URL import keeps tasks-vision out of the Turbopack graph.
		const { FaceLandmarker, FilesetResolver } = (await import(
			/* turbopackIgnore: true */ /* webpackIgnore: true */ esmUrl
		)) as typeof import("@mediapipe/tasks-vision");
		const create = async (useModuleLoader: boolean) => {
			const fileset = await FilesetResolver.forVisionTasks(
				resolveAssetUrl(config.wasmBaseUrl ?? MEDIAPIPE_WASM_BASE),
				useModuleLoader,
			);
			return FaceLandmarker.createFromOptions(fileset, {
				baseOptions: {
					modelAssetPath: resolveAssetUrl(
						config.modelUrl ?? MEDIAPIPE_FACE_MODEL_URL,
					),
				},
				runningMode: "IMAGE",
				numFaces: MEDIAPIPE_MAX_FACES,
				// Defaults (0.5) miss many side / three-quarter faces; 0.35 is the
				// usual profile floor without opening the floodgates to false hits.
				minFaceDetectionConfidence: 0.35,
				minFacePresenceConfidence: 0.35,
				minTrackingConfidence: 0.35,
					outputFaceBlendshapes: false,
					outputFacialTransformationMatrixes:
						config.outputFacialTransformationMatrixes === true,
				});
			};
		// Pages and classic workers load the classic wasm loader; module workers
		// (no working `importScripts`) need the ESM variant.
		if (typeof document !== "undefined") return create(false);
		try {
			return await create(false);
		} catch {
			return create(true);
		}
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

/** Load the landmarker ahead of the first detection; rejects if it cannot load. */
export async function preloadMediapipeFace(): Promise<void> {
	await getLandmarker();
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
		facialTransformationMatrixes?: ReadonlyArray<{
			data?: ArrayLike<number> | null;
		} | null> | null,
	): FaceLandmarks[] {
		const faces: FaceLandmarks[] = [];
		for (let fi = 0; fi < faceLandmarks.length; fi++) {
			const landmarks = faceLandmarks[fi];
			if (landmarks.length < MEDIAPIPE_FACE_LANDMARK_COUNT) continue;
			const points = new Float32Array(MEDIAPIPE_FACE_LANDMARK_COUNT * 2);
			for (let i = 0; i < MEDIAPIPE_FACE_LANDMARK_COUNT; i++) {
				points[i * 2] = landmarks[i].x;
				points[i * 2 + 1] = landmarks[i].y;
			}
			const face: FaceLandmarks = { points, box: boxFromPoints(points) };
			const mat = facialTransformationMatrixes?.[fi];
			const data = mat && "data" in mat ? mat.data : null;
			if (data && data.length >= 16) {
				face.transformationMatrix = Float32Array.from(data);
			}
			faces.push(face);
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
		const result = withQuietNativeLogs(() => landmarker.detect(image));
		return landmarksToFaces(
			result.faceLandmarks ?? [],
			result.facialTransformationMatrixes,
		);
	}

export function disposeMediapipeFace(): void {
	const pending = landmarkerPromise;
	landmarkerPromise = null;
	void pending?.then((landmarker) => landmarker.close()).catch(() => {});
}
