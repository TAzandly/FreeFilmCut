import type {
	AnimationPath,
	ElementAnimations,
} from "@/animation/types";
import { formatLinearRgba, parseColorToLinearRgba } from "@/params";
import type { ParamValue } from "@/params";
import { isCompositeChannelData, isLeafChannelData } from "./channel-data";
import {
	getChannelValueAtTime,
	isScalarChannel,
} from "./interpolation";

export function getElementLocalTime({
	timelineTime,
	elementStartTime,
	elementDuration,
}: {
	timelineTime: number;
	elementStartTime: number;
	elementDuration: number;
}): number {
	const localTime = timelineTime - elementStartTime;
	if (localTime <= 0) {
		return 0;
	}

	if (localTime >= elementDuration) {
		return elementDuration;
	}

	return localTime;
}

export function resolveAnimationPathValueAtTime({
	animations,
	propertyPath,
	localTime,
	fallbackValue,
}: {
	animations: ElementAnimations | undefined;
	propertyPath: AnimationPath;
	localTime: number;
	fallbackValue: number;
}): number;
export function resolveAnimationPathValueAtTime({
	animations,
	propertyPath,
	localTime,
	fallbackValue,
}: {
	animations: ElementAnimations | undefined;
	propertyPath: AnimationPath;
	localTime: number;
	fallbackValue: string;
}): string;
export function resolveAnimationPathValueAtTime({
	animations,
	propertyPath,
	localTime,
	fallbackValue,
}: {
	animations: ElementAnimations | undefined;
	propertyPath: AnimationPath;
	localTime: number;
	fallbackValue: boolean;
}): boolean;
export function resolveAnimationPathValueAtTime({
	animations,
	propertyPath,
	localTime,
	fallbackValue,
}: {
	animations: ElementAnimations | undefined;
	propertyPath: AnimationPath;
	localTime: number;
	fallbackValue: ParamValue;
}): ParamValue;
export function resolveAnimationPathValueAtTime({
	animations,
	propertyPath,
	localTime,
	fallbackValue,
}: {
	animations: ElementAnimations | undefined;
	propertyPath: AnimationPath;
	localTime: number;
	fallbackValue: ParamValue;
}): ParamValue {
	const data = animations?.[propertyPath];
	if (!data) {
		return fallbackValue;
	}
	if (isLeafChannelData(data)) {
		if (typeof fallbackValue === "number") {
			return getChannelValueAtTime({
				channel: isScalarChannel(data) ? data : undefined,
				time: localTime,
				fallbackValue,
			});
		}
		if (typeof fallbackValue === "string" || typeof fallbackValue === "boolean") {
			return getChannelValueAtTime({
				channel: !isScalarChannel(data) ? data : undefined,
				time: localTime,
				fallbackValue,
			});
		}
		return fallbackValue;
	}
	if (!isCompositeChannelData(data)) {
		return fallbackValue;
	}

	if (
		typeof fallbackValue === "string" &&
		"r" in data &&
		"g" in data &&
		"b" in data &&
		"a" in data
	) {
		const fallbackComponents = parseColorToLinearRgba({ color: fallbackValue });
		if (fallbackComponents === null) {
			return fallbackValue;
		}

		return formatLinearRgba({
			color: {
				r: getChannelValueAtTime({
					channel: data.r && isScalarChannel(data.r) ? data.r : undefined,
					time: localTime,
					fallbackValue: fallbackComponents.r,
				}),
				g: getChannelValueAtTime({
					channel: data.g && isScalarChannel(data.g) ? data.g : undefined,
					time: localTime,
					fallbackValue: fallbackComponents.g,
				}),
				b: getChannelValueAtTime({
					channel: data.b && isScalarChannel(data.b) ? data.b : undefined,
					time: localTime,
					fallbackValue: fallbackComponents.b,
				}),
				a: getChannelValueAtTime({
					channel: data.a && isScalarChannel(data.a) ? data.a : undefined,
					time: localTime,
					fallbackValue: fallbackComponents.a,
				}),
			},
		});
	}

	if (Array.isArray(fallbackValue) && "x" in data && "y" in data) {
		const size = fallbackValue.length;
		const x = getChannelValueAtTime({
			channel: data.x && isScalarChannel(data.x) ? data.x : undefined,
			time: localTime,
			fallbackValue: Number(fallbackValue[0]) || 0,
		});
		const y = getChannelValueAtTime({
			channel: data.y && isScalarChannel(data.y) ? data.y : undefined,
			time: localTime,
			fallbackValue: Number(fallbackValue[1]) || 0,
		});
		const out = [x, y];
		if (size >= 3) {
			out.push(
				getChannelValueAtTime({
					channel: data.z && isScalarChannel(data.z) ? data.z : undefined,
					time: localTime,
					fallbackValue: Number(fallbackValue[2]) || 0,
				}),
			);
		}
		if (size >= 4) {
			out.push(
				getChannelValueAtTime({
					channel: data.w && isScalarChannel(data.w) ? data.w : undefined,
					time: localTime,
					fallbackValue: Number(fallbackValue[3]) || 0,
				}),
			);
		}
		return out;
	}

	return fallbackValue;
}
