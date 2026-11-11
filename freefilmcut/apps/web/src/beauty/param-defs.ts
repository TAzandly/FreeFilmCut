import type { ElementParamDefinition } from "@/params/registry";
import { BEAUTY_PARAM_KEYS, DEFAULT_BEAUTY_PARAMS } from "./types";

export function buildBeautyParamDefs(): ElementParamDefinition[] {
	return [
		{
			key: BEAUTY_PARAM_KEYS.smooth,
			label: "磨皮",
			type: "number",
			control: "slider",
			default: DEFAULT_BEAUTY_PARAMS.smooth,
			min: 0,
			max: 1,
			step: 0.01,
			keyframable: true,
		},
		{
			key: BEAUTY_PARAM_KEYS.whiten,
			label: "美白",
			type: "number",
			control: "slider",
			default: DEFAULT_BEAUTY_PARAMS.whiten,
			min: 0,
			max: 1,
			step: 0.01,
			keyframable: true,
		},
		{
			key: BEAUTY_PARAM_KEYS.eye,
			label: "大眼",
			type: "number",
			control: "slider",
			default: DEFAULT_BEAUTY_PARAMS.eye,
			min: 0,
			max: 1,
			step: 0.01,
			keyframable: true,
		},
		{
			key: BEAUTY_PARAM_KEYS.faceSlim,
			label: "瘦脸",
			type: "number",
			control: "slider",
			default: DEFAULT_BEAUTY_PARAMS.faceSlim,
			min: 0,
			max: 1,
			step: 0.01,
			keyframable: true,
		},
		{
			key: BEAUTY_PARAM_KEYS.noseSlim,
			label: "瘦鼻",
			type: "number",
			control: "slider",
			default: DEFAULT_BEAUTY_PARAMS.noseSlim,
			min: 0,
			max: 1,
			step: 0.01,
			keyframable: true,
		},
	];
}
