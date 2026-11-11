import type { BeautyFaceDetection } from "./face-body-analysis";
import type { SkinSegmentation } from "./segment-skin";
import type { BeautyAnalysisFrame, FaceLandmarks } from "./types";

/** Last full-frame skin mask (optional faces from the same tick). */
export type PriorSkin = SkinSegmentation & { faces: FaceLandmarks[] };

export type BeautyWorkerRequest =
	/** `faces` preloads MediaPipe; `skin` preloads DLMV / selfie. */
	| { type: "warmup"; lane: "faces" | "skin" }
	/** Full exact analysis (export). */
	| {
			type: "analyze";
			id: number;
			clipId: string;
			mediaTimeTicks: number;
			bitmap: ImageBitmap;
	  }
	/** Preview: detect faces for warp; reuse `prior` skin until refreshed. */
	| {
			type: "faces";
			id: number;
			clipId: string;
			mediaTimeTicks: number;
			bitmap: ImageBitmap;
			prior: PriorSkin | null;
	  }
	/**
	 * Preview: full-frame skin segmentation, plus MediaPipe face detection
	 * when the fast lane found nobody.
	 */
	| { type: "skin"; id: number; bitmap: ImageBitmap; detectFaces: boolean };

export type BeautyWorkerResponse =
	| { type: "warmup"; ok: true }
	| { type: "warmup"; ok: false; error: string }
	| {
			type: "result";
			id: number;
			ok: true;
			frame: BeautyAnalysisFrame;
			/** Detection did not fail, so the frame may be cached. */
			cacheable: boolean;
	  }
	| {
			type: "skin";
			id: number;
			ok: true;
			seg: SkinSegmentation | null;
			detection: BeautyFaceDetection | null;
	  }
	| { type: "result" | "skin"; id: number; ok: false; error: string };
