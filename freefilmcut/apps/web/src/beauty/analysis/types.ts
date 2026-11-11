export type FaceBox = { x: number; y: number; w: number; h: number };

/**
 * MediaPipe Face Landmarker topology (478 landmarks).
 * `points` layout: length `478 * 2`, interleaved normalized image coordinates
 * `[x0, y0, x1, y1, …]` in roughly 0..1 (may extend slightly outside the image).
 */
export type FaceLandmarks = {
	points: Float32Array;
	box: FaceBox;
};

export type BeautyAnalysisFrame = {
	clipId: string;
	mediaTimeTicks: number;
	faces: FaceLandmarks[];
	/** Present when landmarks are missing but a head box is still known. */
	skinBoxes?: FaceBox[];
	skinWidth: number;
	skinHeight: number;
	skinMask: Uint8Array;
	source: "mediapipe" | "landmarks-only-mask";
};
