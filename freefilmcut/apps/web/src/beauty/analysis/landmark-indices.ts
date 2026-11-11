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
