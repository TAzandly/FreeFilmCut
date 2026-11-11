import type { ParamValues } from "@/params";
import {
	BEAUTY_PARAM_KEYS,
	DEFAULT_BEAUTY_PARAMS,
	type ClipBeautyParams,
} from "./types";

const BEAUTY_ACTIVE_EPSILON = 1e-4;

export function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

export function normalizeBeautyParams(
	partial: Partial<ClipBeautyParams>,
): ClipBeautyParams {
	return {
		smooth: clamp01(partial.smooth ?? DEFAULT_BEAUTY_PARAMS.smooth),
		whiten: clamp01(partial.whiten ?? DEFAULT_BEAUTY_PARAMS.whiten),
		eye: clamp01(partial.eye ?? DEFAULT_BEAUTY_PARAMS.eye),
		faceSlim: clamp01(partial.faceSlim ?? DEFAULT_BEAUTY_PARAMS.faceSlim),
		noseSlim: clamp01(partial.noseSlim ?? DEFAULT_BEAUTY_PARAMS.noseSlim),
	};
}

function readNumber({
	params,
	key,
	fallback,
}: {
	params: ParamValues;
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readBeautyFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ClipBeautyParams {
	const safe = params ?? {};
	return normalizeBeautyParams({
		smooth: readNumber({
			params: safe,
			key: BEAUTY_PARAM_KEYS.smooth,
			fallback: DEFAULT_BEAUTY_PARAMS.smooth,
		}),
		whiten: readNumber({
			params: safe,
			key: BEAUTY_PARAM_KEYS.whiten,
			fallback: DEFAULT_BEAUTY_PARAMS.whiten,
		}),
		eye: readNumber({
			params: safe,
			key: BEAUTY_PARAM_KEYS.eye,
			fallback: DEFAULT_BEAUTY_PARAMS.eye,
		}),
		faceSlim: readNumber({
			params: safe,
			key: BEAUTY_PARAM_KEYS.faceSlim,
			fallback: DEFAULT_BEAUTY_PARAMS.faceSlim,
		}),
		noseSlim: readNumber({
			params: safe,
			key: BEAUTY_PARAM_KEYS.noseSlim,
			fallback: DEFAULT_BEAUTY_PARAMS.noseSlim,
		}),
	});
}

export function isBeautyActive({
	params,
}: {
	params: ParamValues | undefined;
}): boolean {
	const beauty = readBeautyFromParams({ params });
	return (
		beauty.smooth > BEAUTY_ACTIVE_EPSILON ||
		beauty.whiten > BEAUTY_ACTIVE_EPSILON ||
		beauty.eye > BEAUTY_ACTIVE_EPSILON ||
		beauty.faceSlim > BEAUTY_ACTIVE_EPSILON ||
		beauty.noseSlim > BEAUTY_ACTIVE_EPSILON
	);
}

export function resolveBeautyFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ClipBeautyParams | null {
	if (!isBeautyActive({ params })) return null;
	return readBeautyFromParams({ params });
}

export { BEAUTY_PARAM_KEYS, DEFAULT_BEAUTY_PARAMS };
export type { ClipBeautyParams };
