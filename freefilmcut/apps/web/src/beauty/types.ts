export type ClipBeautyParams = {
	smooth: number;
	whiten: number;
	eye: number;
	faceSlim: number;
	noseSlim: number;
};

export const DEFAULT_BEAUTY_PARAMS: ClipBeautyParams = {
	smooth: 0,
	whiten: 0,
	eye: 0,
	faceSlim: 0,
	noseSlim: 0,
};

export const BEAUTY_PARAM_KEYS = {
	smooth: "beauty.smooth",
	whiten: "beauty.whiten",
	eye: "beauty.eye",
	faceSlim: "beauty.faceSlim",
	noseSlim: "beauty.noseSlim",
} as const;
