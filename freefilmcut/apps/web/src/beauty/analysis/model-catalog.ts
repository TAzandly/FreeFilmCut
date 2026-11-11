/**
 * Beauty analysis model local paths + pinned upstream download URLs.
 * Keep in sync with `public/models/beauty/README.md`.
 */

export const BEAUTY_MODEL_CACHE_NAME = "beauty-models-v1";

export type BeautyModelId = "faceLandmarker" | "dlmv" | "selfie";

export type BeautyModelEntry = {
	id: BeautyModelId;
	/** Same-origin path served from `public/models/beauty/`. */
	localPath: string;
	/** Upstream URL used when the local file is missing. */
	remoteUrl: string;
	/** Approximate byte size for progress weighting. */
	approxBytes: number;
};

export const BEAUTY_MODEL_FACE_LANDMARKER: BeautyModelEntry = {
	id: "faceLandmarker",
	localPath: "/models/beauty/face_landmarker.task",
	remoteUrl:
		"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
	approxBytes: 3_750_000,
};

export const BEAUTY_MODEL_DLMV: BeautyModelEntry = {
	id: "dlmv",
	localPath: "/models/beauty/dlmv.onnx",
	remoteUrl:
		"https://github.com/samhaswon/skin_segmentation/releases/download/v0.0.2/dlmv.onnx",
	approxBytes: 44_000_000,
};

export const BEAUTY_MODEL_SELFIE: BeautyModelEntry = {
	id: "selfie",
	localPath: "/models/beauty/selfie_multiclass_256x256.onnx",
	remoteUrl:
		"https://huggingface.co/FreeHugsForRobots/ps-skin-seg/resolve/f3a72025451688fb893083991fdfd4562814a4dd/selfie_multiclass_256x256.onnx",
	approxBytes: 16_500_000,
};

/** Models that are always attempted (selfie is conditional). */
export const BEAUTY_MODEL_REQUIRED: readonly BeautyModelEntry[] = [
	BEAUTY_MODEL_FACE_LANDMARKER,
	BEAUTY_MODEL_DLMV,
];
