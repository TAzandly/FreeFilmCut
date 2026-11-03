import { converter, formatHex, formatHex8, parse } from "culori";
import { clamp, snapToStep } from "@/utils/math";

export type ParamValue = number | string | boolean | number[];
export type ParamValues = Record<string, ParamValue>;

export type VectorSize = 2 | 3 | 4;
export type VecComponents = {
	x: number;
	y: number;
	z?: number;
	w?: number;
};

export type ParamGroup = "stroke";

export type ChannelValueKind = "scalar" | "discrete";
export type ChannelEasingMode = "independent" | "shared";

export interface LinearRgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface ChannelComponentDefinition<TKey extends string = string> {
	key: TKey;
	valueKind: ChannelValueKind;
	defaultInterpolation: "linear" | "hold";
}

export interface LeafChannelLayout<TValue extends ParamValue = ParamValue> {
	kind: "leaf";
	component: ChannelComponentDefinition<"value">;
	easingMode: "independent";
	decompose: (value: TValue) => { value: TValue };
	compose: (components: { value?: TValue }) => TValue | null;
}

export interface CompositeChannelLayout<
	TValue extends ParamValue = ParamValue,
	TComponents extends object = Record<string, ParamValue>,
> {
	kind: "composite";
	components: Array<ChannelComponentDefinition<keyof TComponents & string>>;
	easingMode: ChannelEasingMode;
	decompose: (value: TValue) => TComponents | null;
	compose: (components: Partial<TComponents>) => TValue | null;
}

export type ChannelLayout<
	TValue extends ParamValue = ParamValue,
	TComponents extends object = Record<string, ParamValue>,
> = LeafChannelLayout<TValue> | CompositeChannelLayout<TValue, TComponents>;

export type ParamChannelLayout =
	| LeafChannelLayout<number>
	| LeafChannelLayout<boolean>
	| LeafChannelLayout<string>
	| CompositeChannelLayout<string, LinearRgba>
	| CompositeChannelLayout<number[], VecComponents>;

const toRgb = converter("rgb");

function srgbToLinear({ value }: { value: number }): number {
	return value <= 0.04045
		? value / 12.92
		: Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb({ value }: { value: number }): number {
	const clamped = clamp({ value, min: 0, max: 1 });
	return clamped <= 0.0031308
		? clamped * 12.92
		: 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

export function parseColorToLinearRgba({
	color,
}: {
	color: string;
}): LinearRgba | null {
	const parsed = parse(color);
	const rgb = parsed ? toRgb(parsed) : null;
	if (!rgb) {
		return null;
	}

	return {
		r: srgbToLinear({ value: rgb.r ?? 0 }),
		g: srgbToLinear({ value: rgb.g ?? 0 }),
		b: srgbToLinear({ value: rgb.b ?? 0 }),
		a: clamp({ value: rgb.alpha ?? 1, min: 0, max: 1 }),
	};
}

export function formatLinearRgba({
	color,
}: {
	color: LinearRgba;
}): string {
	const rgb: {
		mode: "rgb";
		r: number;
		g: number;
		b: number;
		alpha: number;
	} = {
		mode: "rgb",
		r: linearToSrgb({ value: color.r }),
		g: linearToSrgb({ value: color.g }),
		b: linearToSrgb({ value: color.b }),
		alpha: clamp({ value: color.a, min: 0, max: 1 }),
	};
	return rgb.alpha < 1 ? formatHex8(rgb) : formatHex(rgb);
}

function createLeafChannelLayout<TValue extends ParamValue>({
	valueKind,
	defaultInterpolation,
}: {
	valueKind: ChannelValueKind;
	defaultInterpolation: "linear" | "hold";
}): LeafChannelLayout<TValue> {
	return {
		kind: "leaf",
		component: {
			key: "value",
			valueKind,
			defaultInterpolation,
		},
		easingMode: "independent",
		decompose: (value) => ({ value }),
		compose: ({ value }) => value ?? null,
	};
}

export const NUMBER_CHANNEL_LAYOUT: LeafChannelLayout<number> =
	createLeafChannelLayout<number>({
		valueKind: "scalar",
		defaultInterpolation: "linear",
	});

export const BOOLEAN_CHANNEL_LAYOUT: LeafChannelLayout<boolean> =
	createLeafChannelLayout<boolean>({
		valueKind: "discrete",
		defaultInterpolation: "hold",
	});

export const STRING_CHANNEL_LAYOUT: LeafChannelLayout<string> =
	createLeafChannelLayout<string>({
		valueKind: "discrete",
		defaultInterpolation: "hold",
	});

const colorComponent = (
	key: keyof LinearRgba,
): ChannelComponentDefinition<keyof LinearRgba> => ({
	key,
	valueKind: "scalar",
	defaultInterpolation: "linear",
});

export const COLOR_CHANNEL_LAYOUT: CompositeChannelLayout<string, LinearRgba> = {
	kind: "composite",
	components: [
		colorComponent("r"),
		colorComponent("g"),
		colorComponent("b"),
		colorComponent("a"),
	],
	easingMode: "shared",
	decompose: (value) => parseColorToLinearRgba({ color: value }),
	compose: ({ r, g, b, a }) =>
		typeof r === "number" &&
		typeof g === "number" &&
		typeof b === "number" &&
		typeof a === "number"
			? formatLinearRgba({ color: { r, g, b, a } })
			: null,
};

const vectorComponent = (
	key: keyof VecComponents,
): ChannelComponentDefinition<keyof VecComponents> => ({
	key,
	valueKind: "scalar",
	defaultInterpolation: "linear",
});

export function createVectorChannelLayout({
	size,
}: {
	size: VectorSize;
}): CompositeChannelLayout<number[], VecComponents> {
	const keys = (
		[
			["x", "y"],
			["x", "y", "z"],
			["x", "y", "z", "w"],
		] as const
	)[size - 2];
	return {
		kind: "composite",
		components: keys.map((key) => vectorComponent(key)),
		easingMode: "shared",
		decompose: (value) => {
			if (!Array.isArray(value) || value.length < size) return null;
			const out: VecComponents = {
				x: Number(value[0]) || 0,
				y: Number(value[1]) || 0,
			};
			if (size >= 3) out.z = Number(value[2]) || 0;
			if (size >= 4) out.w = Number(value[3]) || 0;
			return out;
		},
		compose: (components) => {
			if (
				typeof components.x !== "number" ||
				typeof components.y !== "number"
			) {
				return null;
			}
			const out = [components.x, components.y];
			if (size >= 3) {
				if (typeof components.z !== "number") return null;
				out.push(components.z);
			}
			if (size >= 4) {
				if (typeof components.w !== "number") return null;
				out.push(components.w);
			}
			return out;
		},
	};
}

export const VEC2_CHANNEL_LAYOUT = createVectorChannelLayout({ size: 2 });
export const VEC3_CHANNEL_LAYOUT = createVectorChannelLayout({ size: 3 });
export const VEC4_CHANNEL_LAYOUT = createVectorChannelLayout({ size: 4 });

interface BaseParamDefinition<TKey extends string = string> {
	key: TKey;
	label: string;
	group?: ParamGroup;
	keyframable?: boolean;
	dependencies?: Array<{ param: string; equals: ParamValue }>;
}

export interface NumberParamDefinition<TKey extends string = string>
	extends BaseParamDefinition<TKey> {
	type: "number";
	default: number;
	channels?: LeafChannelLayout<number>;
	min: number;
	max?: number;
	step: number;
	/** When set, min/max/step are in display space. display = stored * displayMultiplier. */
	displayMultiplier?: number;
	/**
	 * Display unit. `percent` remaps against max; `dB` is a suffix only
	 * (stored value is already decibels, 0 = unity / source level).
	 */
	unit?: "percent" | "dB";
	/**
	 * Render as a horizontal slider instead of the drag-scrub number field.
	 * Use it for 0..N "how much" controls (opacity-style ranges) where seeing
	 * the position along the range matters more than typing an exact number;
	 * the numeric readout stays visible next to the track.
	 */
	control?: "slider";
	/** Short label shown as the scrub handle icon in the number field (e.g. "W", "R"). */
	shortLabel?: string;
}

export interface BooleanParamDefinition<TKey extends string = string>
	extends BaseParamDefinition<TKey> {
	type: "boolean";
	default: boolean;
	channels?: LeafChannelLayout<boolean>;
}

export interface ColorParamDefinition<TKey extends string = string>
	extends BaseParamDefinition<TKey> {
	type: "color";
	default: string;
	channels?: ChannelLayout<string, LinearRgba>;
}

export interface SelectParamDefinition<TKey extends string = string>
	extends BaseParamDefinition<TKey> {
	type: "select";
	default: string;
	channels?: LeafChannelLayout<string>;
	options: Array<{ value: string; label: string }>;
}

export interface TextParamDefinition<TKey extends string = string>
	extends BaseParamDefinition<TKey> {
	type: "text";
	default: string;
	channels?: LeafChannelLayout<string>;
}

export interface FontParamDefinition<TKey extends string = string>
	extends BaseParamDefinition<TKey> {
	type: "font";
	default: string;
	channels?: LeafChannelLayout<string>;
}

export interface VectorParamDefinition<TKey extends string = string>
	extends BaseParamDefinition<TKey> {
	type: "vector";
	size: VectorSize;
	default: number[];
	channels?: CompositeChannelLayout<number[], VecComponents>;
	min?: number;
	max?: number;
	step?: number;
}

export type ParamDefinition<TKey extends string = string> =
	| NumberParamDefinition<TKey>
	| BooleanParamDefinition<TKey>
	| ColorParamDefinition<TKey>
	| SelectParamDefinition<TKey>
	| TextParamDefinition<TKey>
	| FontParamDefinition<TKey>
	| VectorParamDefinition<TKey>;

export function getParamChannelLayout({
	param,
}: {
	param: ParamDefinition;
}): ParamChannelLayout {
	switch (param.type) {
		case "number":
			return param.channels ?? NUMBER_CHANNEL_LAYOUT;
		case "boolean":
			return param.channels ?? BOOLEAN_CHANNEL_LAYOUT;
		case "color":
			return param.channels ?? COLOR_CHANNEL_LAYOUT;
		case "vector":
			return (
				param.channels ??
				(param.size === 2
					? VEC2_CHANNEL_LAYOUT
					: param.size === 3
						? VEC3_CHANNEL_LAYOUT
						: VEC4_CHANNEL_LAYOUT)
			);
		case "select":
		case "text":
		case "font":
			return param.channels ?? STRING_CHANNEL_LAYOUT;
		default: {
			const exhaustive: never = param;
			return exhaustive;
		}
	}
}

export function getParamValueKind({
	param,
}: {
	param: ParamDefinition;
}): "number" | "color" | "discrete" {
	const layout = getParamChannelLayout({ param });
	if (layout.kind === "composite") {
		return "color";
	}
	if (layout.component.valueKind === "scalar") {
		return "number";
	}
	return "discrete";
}

export function getParamDefaultInterpolation({
	param,
}: {
	param: ParamDefinition;
}): "linear" | "hold" {
	const layout = getParamChannelLayout({ param });
	if (layout.kind === "leaf") {
		return layout.component.defaultInterpolation;
	}
	return layout.components[0]?.defaultInterpolation ?? "linear";
}

export function getParamNumericRange({
	param,
}: {
	param: ParamDefinition;
}): { min?: number; max?: number; step?: number } | undefined {
	if (param.type !== "number") {
		return undefined;
	}

	return {
		min: param.min,
		max: param.max,
		step: param.step,
	};
}

export function coerceParamValue({
	param,
	value,
}: {
	param: ParamDefinition;
	value: unknown;
}): ParamValue | null {
	switch (param.type) {
		case "number": {
			if (typeof value !== "number" || Number.isNaN(value)) {
				return null;
			}

			const steppedValue = snapToStep({ value, step: param.step });
			const maxValue = param.max ?? Number.POSITIVE_INFINITY;
			return Math.min(maxValue, Math.max(param.min, steppedValue));
		}
		case "boolean":
			return typeof value === "boolean" ? value : null;
		case "color":
		case "text":
		case "font":
			return typeof value === "string" ? value : null;
		case "select":
			return typeof value === "string" &&
				param.options.some((option) => option.value === value)
				? value
				: null;
		case "vector": {
			if (!Array.isArray(value) || value.length < param.size) {
				return null;
			}
			const step = param.step ?? 0.01;
			const min = param.min ?? Number.NEGATIVE_INFINITY;
			const max = param.max ?? Number.POSITIVE_INFINITY;
			const out: number[] = [];
			for (let i = 0; i < param.size; i++) {
				const n = Number(value[i]);
				if (!Number.isFinite(n)) return null;
				const stepped = snapToStep({ value: n, step });
				out.push(Math.min(max, Math.max(min, stepped)));
			}
			return out;
		}
		default: {
			const exhaustive: never = param;
			return exhaustive;
		}
	}
}
