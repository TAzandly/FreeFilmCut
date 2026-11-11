/**
 * Beauty analysis model local paths + download URLs.
 * Keep in sync with `public/models/beauty/README.md`.
 *
 * Browser downloads use same-origin `/api/beauty-models/*` (Next.js Edge proxy)
 * because GitHub release assets block CORS from free-film-cut.vercel.app.
 */

export const BEAUTY_MODEL_CACHE_NAME = "beauty-models-v1";

export type BeautyModelId = "faceLandmarker" | "dlmv" | "selfie";

export type BeautyModelEntry = {
	id: BeautyModelId;
	/** Same-origin path served from `public/models/beauty/`. */
	localPath: string;
	/**
	 * Same-origin proxy used when the local file is missing.
	 * Avoids CORS on GitHub / some CDNs.
	 */
	remoteUrl: string;
	/** Real upstream URL fetched by the proxy (server-side). */
	upstreamUrl: string;
	/** Approximate byte size for progress weighting. */
	approxBytes: number;
};

export const BEAUTY_MODEL_FACE_LANDMARKER: BeautyModelEntry = {
	id: "faceLandmarker",
	localPath: "/models/beauty/face_landmarker.task",
	remoteUrl: "/api/beauty-models/faceLandmarker",
	upstreamUrl:
		"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
	approxBytes: 3_750_000,
};

export const BEAUTY_MODEL_DLMV: BeautyModelEntry = {
	id: "dlmv",
	localPath: "/models/beauty/dlmv.onnx",
	remoteUrl: "/api/beauty-models/dlmv",
	upstreamUrl:
		"https://github.com/samhaswon/skin_segmentation/releases/download/v0.0.2/dlmv.onnx",
	approxBytes: 44_000_000,
};

export const BEAUTY_MODEL_SELFIE: BeautyModelEntry = {
	id: "selfie",
	localPath: "/models/beauty/selfie_multiclass_256x256.onnx",
	remoteUrl: "/api/beauty-models/selfie",
	upstreamUrl:
		"https://huggingface.co/FreeHugsForRobots/ps-skin-seg/resolve/f3a72025451688fb893083991fdfd4562814a4dd/selfie_multiclass_256x256.onnx",
	approxBytes: 16_500_000,
};

export const BEAUTY_MODELS_BY_ID: Record<BeautyModelId, BeautyModelEntry> = {
	faceLandmarker: BEAUTY_MODEL_FACE_LANDMARKER,
	dlmv: BEAUTY_MODEL_DLMV,
	selfie: BEAUTY_MODEL_SELFIE,
};

/** Models that are always attempted (selfie is conditional). */
export const BEAUTY_MODEL_REQUIRED: readonly BeautyModelEntry[] = [
	BEAUTY_MODEL_FACE_LANDMARKER,
	BEAUTY_MODEL_DLMV,
];

export function isBeautyModelId(value: string): value is BeautyModelId {
	return value in BEAUTY_MODELS_BY_ID;
}
