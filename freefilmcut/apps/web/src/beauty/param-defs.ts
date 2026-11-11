import type { ElementParamDefinition } from "@/params/registry";
import { BEAUTY_PARAM_KEYS, DEFAULT_BEAUTY_PARAMS } from "./types";

export function buildBeautyParamDefs(): ElementParamDefinition[] {
	return [
		{
			key: BEAUTY_PARAM_KEYS.smooth,
			label: "Smooth",
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
			label: "Whiten",
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
			label: "Eye",
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
			label: "Face Slim",
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
			label: "Nose Slim",
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
