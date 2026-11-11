/** Closed face oval contour (MediaPipe `FACE_LANDMARKS_FACE_OVAL`). */
export const FACE_OVAL_INDICES = [
	10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
	400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
	54, 103, 67, 109,
] as const;

/** Left eye contour vertices in polygon order. */
export const LEFT_EYE_INDICES = [
	263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466,
] as const;

/** Right eye contour vertices in polygon order. */
export const RIGHT_EYE_INDICES = [
	33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
] as const;

/** Outer lip contour (MediaPipe `FACE_LANDMARKS_LIPS` outer loop). */
export const LIPS_OUTER_INDICES = [
	61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39,
	40, 185,
] as const;

/** Inner lip contour (MediaPipe `FACE_LANDMARKS_LIPS` inner loop). */
export const LIPS_INNER_INDICES = [
	78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81,
	80, 191,
] as const;

/*
 * Warp control points (MediaPipe 478-landmark topology). Image-left / image-right
 * mean the viewer's left / right (the subject's right / left).
 */

/** Eye corners used to size the enlarge radius. */
export const EYE_CORNER_INDICES = {
	/** [outer, inner] — image-left eye (subject's right). */
	imageLeft: [33, 133],
	/** [outer, inner] — image-right eye (subject's left). */
	imageRight: [263, 362],
} as const;

/** Temple-to-temple width reference for face-slim radius. */
export const FACE_WIDTH_INDICES = [234, 454] as const;

/** Nose bridge and chin: define the facial axis that slimming pulls toward. */
export const FACE_AXIS_INDICES = [168, 152] as const;

	/**
	 * Cheek → lower-jaw points that move toward the axis (face slim).
	 * Ordered cheek → chin along the face oval so the Gu blend yields a smooth
	 * contour instead of three discrete pulls.
	 * Oval (image-left): 93 → 132 → 58 → 172 → 136 → …
	 */
	export const FACE_SLIM_INDICES = {
		imageLeft: [93, 132, 58, 172, 136],
		imageRight: [323, 361, 288, 397, 365],
	} as const;

	/**
	 * Near-chin points for V-face taper. Kept below the slim set so the two
	 * sliders do not double-drag the same landmarks.
	 * Oval (image-left): … → 150 → 149 → 176 → 148 → 152(chin).
	 */
	export const FACE_V_INDICES = {
		imageLeft: [150, 149, 176],
		imageRight: [379, 378, 400],
	} as const;

/** Outer nostril wings that move toward the axis (nose slim). */
export const NOSE_WING_INDICES = {
	imageLeft: 129,
	imageRight: 358,
} as const;
