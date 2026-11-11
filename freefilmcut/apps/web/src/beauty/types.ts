export type ClipBeautyParams = {
	/** Master switch; default off — sliders ignored while false. */
	enabled: boolean;
	smooth: number;
	whiten: number;
	eye: number;
	faceSlim: number;
	/** Lower-jaw taper toward a V chin (separate from cheek slim). */
	vFace: number;
	noseSlim: number;
};

export const DEFAULT_BEAUTY_PARAMS: ClipBeautyParams = {
	enabled: false,
	smooth: 0,
	whiten: 0,
	eye: 0,
	faceSlim: 0,
	vFace: 0,
	noseSlim: 0,
};

export const BEAUTY_PARAM_KEYS = {
	enabled: "beauty.enabled",
	smooth: "beauty.smooth",
	whiten: "beauty.whiten",
	eye: "beauty.eye",
	faceSlim: "beauty.faceSlim",
	vFace: "beauty.vFace",
	noseSlim: "beauty.noseSlim",
} as const;

/** Slider keys only (enabled is a section Switch, not a param field). */
export const BEAUTY_SLIDER_PARAM_KEYS = [
	BEAUTY_PARAM_KEYS.smooth,
	BEAUTY_PARAM_KEYS.whiten,
	BEAUTY_PARAM_KEYS.eye,
	BEAUTY_PARAM_KEYS.faceSlim,
	BEAUTY_PARAM_KEYS.vFace,
	BEAUTY_PARAM_KEYS.noseSlim,
] as const;
