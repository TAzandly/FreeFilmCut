import type {
	ParamDefinition,
	ParamValue,
	ParamValues,
} from "@/params";
import { MIN_TRANSFORM_SCALE } from "@/animation/transform";
import type { BlendMode } from "@/rendering";
import type {
	ElementType,
	TimelineElement,
} from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import {
	CORNER_RADIUS_MAX,
	CORNER_RADIUS_MIN,
} from "@/text/background";
import { DEFAULT_FONT_SIZE } from "@/text/typography";
import {
	DEFAULT_CHROMA_KEY_COLOR,
	DEFAULT_CHROMA_KEY_EDGE_CLEANUP,
	DEFAULT_CHROMA_KEY_FEATHER,
	DEFAULT_CHROMA_KEY_INTENSITY,
	DEFAULT_CHROMA_KEY_SOFTEN,
} from "@/chroma-key/settings";
import {
	BACKGROUND_FILL_MODE_OPTIONS,
	DEFAULT_BACKGROUND_FILL,
} from "@/background/fill";
import { DEFAULT_COLOR_GRADE_BASIC } from "@/color-grade/settings";
import {
	buildColorGradeCurvesParamDefs,
	buildColorGradeHslParamDefs,
} from "@/color-grade/param-defs";

export type ElementParamDefinition<TKey extends string = string> =
	ParamDefinition<TKey> & {
		read?: ({ element }: { element: TimelineElement }) => ParamValue | null;
		write?: ({
			element,
			value,
		}: {
			element: TimelineElement;
			value: ParamValue;
		}) => TimelineElement;
	};

export function buildDefaultParamValues(
	params: readonly ParamDefinition[],
): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		values[param.key] = param.default;
	}
	return values;
}

export class DefinitionRegistry<TKey extends string, TDefinition> {
	private definitions = new Map<TKey, TDefinition>();
	private entityName: string;

	constructor(entityName: string) {
		this.entityName = entityName;
	}

	register({
		key,
		definition,
	}: {
		key: TKey;
		definition: TDefinition;
	}): void {
		this.definitions.set(key, definition);
	}

	has(key: TKey): boolean {
		return this.definitions.has(key);
	}

	get(key: TKey): TDefinition {
		const def = this.definitions.get(key);
		if (!def) {
			throw new Error(`Unknown ${this.entityName}: ${key}`);
		}
		return def;
	}

	getAll(): TDefinition[] {
		return Array.from(this.definitions.values());
	}
}

const BLEND_MODE_OPTIONS: Array<{ value: BlendMode; label: string }> = [
	{ value: "normal", label: "Normal" },
	{ value: "darken", label: "Darken" },
	{ value: "multiply", label: "Multiply" },
	{ value: "color-burn", label: "Color Burn" },
	{ value: "lighten", label: "Lighten" },
	{ value: "screen", label: "Screen" },
	{ value: "plus-lighter", label: "Plus Lighter" },
	{ value: "color-dodge", label: "Color Dodge" },
	{ value: "overlay", label: "Overlay" },
	{ value: "soft-light", label: "Soft Light" },
	{ value: "hard-light", label: "Hard Light" },
	{ value: "difference", label: "Difference" },
	{ value: "exclusion", label: "Exclusion" },
	{ value: "hue", label: "Hue" },
	{ value: "saturation", label: "Saturation" },
	{ value: "color", label: "Color" },
	{ value: "luminosity", label: "Luminosity" },
];

const canvasTransformParams: ElementParamDefinition[] = [
	{
		key: "transform.positionX",
		label: "Position X",
		type: "number",
		default: DEFAULTS.element.transform.position.x,
		min: -100_000,
		step: 1,
	},
	{
		key: "transform.positionY",
		label: "Position Y",
		type: "number",
		default: DEFAULTS.element.transform.position.y,
		min: -100_000,
		step: 1,
	},
	{
		key: "transform.scaleX",
		label: "Scale X",
		type: "number",
		default: DEFAULTS.element.transform.scaleX,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.scaleY",
		label: "Scale Y",
		type: "number",
		default: DEFAULTS.element.transform.scaleY,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.rotate",
		label: "Rotate",
		type: "number",
		default: DEFAULTS.element.transform.rotate,
		min: -360,
		max: 360,
		step: 1,
	},
];

export function getCanvasTransformParams(): readonly ElementParamDefinition[] {
	return canvasTransformParams;
}

const visualElementParams: ElementParamDefinition[] = [
	...canvasTransformParams,
	{
		key: "opacity",
		label: "Opacity",
		type: "number",
		default: DEFAULTS.element.opacity,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "blendMode",
		label: "Blend Mode",
		type: "select",
		default: DEFAULTS.element.blendMode,
		keyframable: false,
		options: BLEND_MODE_OPTIONS,
	},
];

const CHROMA_KEY_ENABLED_KEY = "chromaKey.enabled";

/**
 * Writing any keyer control also switches the keyer on.
 *
 * The six controls carry **no** `dependencies` gate on purpose: gating them on
 * `chromaKey.enabled` made the tab render as a single lonely switch until the
 * user found it, which reads as "the panel is broken / there are no params".
 * Reference panels keep the controls on screen and let the toggle describe
 * state, so this write hook restores that: touching the colour picker or any slider turns
 * the effect on, and the header switch simply mirrors the result.
 */
function writeChromaKeyParam({
	element,
	key,
	value,
}: {
	element: TimelineElement;
	key: string;
	value: ParamValue;
}): TimelineElement {
	if (!("params" in element)) return element;
	return {
		...element,
		params: {
			...element.params,
			[key]: value,
			[CHROMA_KEY_ENABLED_KEY]: true,
		},
	};
}

/**
 * Chroma key ("色度抠图").
 *
 * Registered as ordinary params rather than a bespoke property bag: that is
 * what gives the panel its sliders, keyframe diamonds and the system eyedropper
 * (ColorPicker uses `window.EyeDropper`) without a line of new widget code, and
 * it makes the values animate for free.
 *
 * Sliders are 0..100 to match the reference panel; `chroma-key/settings.ts`
 * normalises to 0..1 for the shader.
 */
const chromaKeyParams: ElementParamDefinition[] = [
	{
		key: "chromaKey.enabled",
		label: "Chroma Key",
		type: "boolean",
		default: false,
		keyframable: false,
	},
	{
		key: "chromaKey.color",
		label: "Key Color",
		type: "color",
		default: DEFAULT_CHROMA_KEY_COLOR,
		keyframable: false,
		write: ({ element, value }) =>
			writeChromaKeyParam({ element, key: "chromaKey.color", value }),
	},
	{
		key: "chromaKey.intensity",
		label: "Intensity",
		type: "number",
		control: "slider",
		default: DEFAULT_CHROMA_KEY_INTENSITY,
		min: 0,
		max: 100,
		step: 1,
		write: ({ element, value }) =>
			writeChromaKeyParam({ element, key: "chromaKey.intensity", value }),
	},
	{
		key: "chromaKey.shadow",
		label: "Shadow",
		type: "number",
		control: "slider",
		default: 0,
		min: 0,
		max: 100,
		step: 1,
		write: ({ element, value }) =>
			writeChromaKeyParam({ element, key: "chromaKey.shadow", value }),
	},
	{
		key: "chromaKey.feather",
		label: "Feather",
		type: "number",
		control: "slider",
		default: DEFAULT_CHROMA_KEY_FEATHER,
		min: 0,
		max: 100,
		step: 1,
		write: ({ element, value }) =>
			writeChromaKeyParam({ element, key: "chromaKey.feather", value }),
	},
	{
		/**
		 * The one knob colour distance cannot replace: feathering only affects pixels
		 * whose *colour* is intermediate, so a clean green screen keeps a hard
		 * geometric edge. This one blurs the matte itself, in source texels.
		 */
		key: "chromaKey.soften",
		label: "Soften",
		type: "number",
		control: "slider",
		default: DEFAULT_CHROMA_KEY_SOFTEN,
		min: 0,
		max: 100,
		step: 1,
		write: ({ element, value }) =>
			writeChromaKeyParam({ element, key: "chromaKey.soften", value }),
	},
	{
		key: "chromaKey.edgeCleanup",
		label: "Spill Removal",
		type: "number",
		control: "slider",
		default: DEFAULT_CHROMA_KEY_EDGE_CLEANUP,
		min: 0,
		max: 100,
		step: 1,
		write: ({ element, value }) =>
			writeChromaKeyParam({ element, key: "chromaKey.edgeCleanup", value }),
	},
];

const colorGradeBasicParams: ElementParamDefinition[] = [
	{
		key: "colorGrade.temperature",
		label: "Temperature",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.temperature,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "colorGrade.tint",
		label: "Tint",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.tint,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "colorGrade.saturation",
		label: "Saturation",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.saturation,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "colorGrade.brightness",
		label: "Brightness",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.brightness,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "colorGrade.contrast",
		label: "Contrast",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.contrast,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "colorGrade.exposure",
		label: "Exposure",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.exposure,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "colorGrade.highlights",
		label: "Highlights",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.highlights,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "colorGrade.shadows",
		label: "Shadows",
		type: "number",
		control: "slider",
		default: DEFAULT_COLOR_GRADE_BASIC.shadows,
		min: -100,
		max: 100,
		step: 1,
	},
];

const colorGradeHslParams = buildColorGradeHslParamDefs();
const colorGradeCurvesParams = buildColorGradeCurvesParamDefs();

const backgroundFillParams: ElementParamDefinition[] = [
	{
		key: "backgroundFill.enabled",
		label: "Background fill",
		type: "boolean",
		default: DEFAULT_BACKGROUND_FILL.enabled,
		keyframable: false,
	},
	{
		key: "backgroundFill.mode",
		label: "Background fill type",
		type: "select",
		default: DEFAULT_BACKGROUND_FILL.mode,
		keyframable: false,
		options: BACKGROUND_FILL_MODE_OPTIONS,
	},
	{
		key: "backgroundFill.blurIntensity",
		label: "Blur intensity",
		type: "number",
		control: "slider",
		default: DEFAULT_BACKGROUND_FILL.blurIntensity,
		min: 0,
		max: 100,
		step: 1,
		keyframable: false,
	},
	{
		key: "backgroundFill.color",
		label: "Fill color",
		type: "color",
		default: DEFAULT_BACKGROUND_FILL.color,
		keyframable: false,
	},
	{
		key: "backgroundFill.styleId",
		label: "Fill style",
		type: "text",
		default: "",
		keyframable: false,
	},
];

const audioElementParams: ElementParamDefinition[] = [
	{
		key: "volume",
		label: "Volume",
		type: "number",
		default: DEFAULTS.element.volume,
		min: VOLUME_DB_MIN,
		max: VOLUME_DB_MAX,
		step: 0.01,
		/** Stored as dB; 0 = original clip level, negative quieter, positive louder. */
		unit: "dB",
	},
	{
		key: "muted",
		label: "Muted",
		type: "boolean",
		default: false,
		keyframable: false,
	},
	{
		key: "fadeInSec",
		label: "Fade in",
		type: "number",
		default: 0,
		min: 0,
		max: 3600,
		step: 0.01,
		keyframable: false,
	},
	{
		key: "fadeOutSec",
		label: "Fade out",
		type: "number",
		default: 0,
		min: 0,
		max: 3600,
		step: 0.01,
		keyframable: false,
	},
];

const textElementParams: ElementParamDefinition[] = [
	{
		key: "content",
		label: "Content",
		type: "text",
		default: "Default text",
		keyframable: false,
	},
	{
		key: "fontFamily",
		label: "Font Family",
		type: "font",
		default: "Noto Sans SC",
		keyframable: false,
	},
	{
		key: "fontSize",
		label: "Font Size",
		type: "number",
		default: DEFAULT_FONT_SIZE,
		min: 1,
		step: 1,
	},
	{
		key: "color",
		label: "Color",
		type: "color",
		default: "#ffffff",
	},
	{
		key: "textAlign",
		label: "Text Align",
		type: "select",
		default: "center",
		keyframable: false,
		options: [
			{ value: "left", label: "Left" },
			{ value: "center", label: "Center" },
			{ value: "right", label: "Right" },
		],
	},
	{
		key: "fontWeight",
		label: "Font Weight",
		type: "select",
		default: "normal",
		keyframable: false,
		options: [
			{ value: "normal", label: "Normal" },
			{ value: "bold", label: "Bold" },
		],
	},
	{
		key: "fontStyle",
		label: "Font Style",
		type: "select",
		default: "normal",
		keyframable: false,
		options: [
			{ value: "normal", label: "Normal" },
			{ value: "italic", label: "Italic" },
		],
	},
	{
		key: "textDecoration",
		label: "Text Decoration",
		type: "select",
		default: "none",
		keyframable: false,
		options: [
			{ value: "none", label: "None" },
			{ value: "underline", label: "Underline" },
			{ value: "line-through", label: "Line Through" },
		],
	},
	{
		key: "letterSpacing",
		label: "Letter Spacing",
		type: "number",
		default: DEFAULTS.text.letterSpacing,
		min: -100,
		step: 0.1,
	},
	{
		key: "lineHeight",
		label: "Line Height",
		type: "number",
		default: DEFAULTS.text.lineHeight,
		min: 0.1,
		step: 0.1,
	},
	{
		key: "background.enabled",
		label: "Background Enabled",
		type: "boolean",
		default: DEFAULTS.text.background.enabled,
		keyframable: false,
	},
	{
		key: "background.color",
		label: "Background Color",
		type: "color",
		default: DEFAULTS.text.background.color,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.cornerRadius",
		label: "Background Radius",
		type: "number",
		default: DEFAULTS.text.background.cornerRadius,
		min: CORNER_RADIUS_MIN,
		max: CORNER_RADIUS_MAX,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingX",
		label: "Background Padding X",
		type: "number",
		default: DEFAULTS.text.background.paddingX,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingY",
		label: "Background Padding Y",
		type: "number",
		default: DEFAULTS.text.background.paddingY,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetX",
		label: "Background Offset X",
		type: "number",
		default: DEFAULTS.text.background.offsetX,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetY",
		label: "Background Offset Y",
		type: "number",
		default: DEFAULTS.text.background.offsetY,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
];

export const elementParamRegistry = new DefinitionRegistry<
	ElementType,
	readonly ElementParamDefinition[]
>("element params");

elementParamRegistry.register({
	key: "video",
	definition: [
		...visualElementParams,
		...audioElementParams,
		...chromaKeyParams,
		...backgroundFillParams,
		...colorGradeBasicParams,
		...colorGradeHslParams,
		...colorGradeCurvesParams,
	],
});
elementParamRegistry.register({
	key: "image",
	definition: [
		...visualElementParams,
		...chromaKeyParams,
		...backgroundFillParams,
		...colorGradeBasicParams,
		...colorGradeHslParams,
		...colorGradeCurvesParams,
	],
});
elementParamRegistry.register({
	key: "text",
	definition: [...textElementParams, ...visualElementParams],
});
elementParamRegistry.register({
	key: "sticker",
	definition: visualElementParams,
});
elementParamRegistry.register({
	key: "graphic",
	definition: visualElementParams,
});
elementParamRegistry.register({ key: "audio", definition: audioElementParams });
elementParamRegistry.register({ key: "effect", definition: [] });

export function getElementParams({
	element,
}: {
	element: TimelineElement;
}): readonly ElementParamDefinition[] {
	return elementParamRegistry.has(element.type)
		? elementParamRegistry.get(element.type)
		: [];
}

export function getBuiltInElementParams({
	type,
}: {
	type: ElementType;
}): readonly ElementParamDefinition[] {
	return elementParamRegistry.has(type) ? elementParamRegistry.get(type) : [];
}

export function getElementParam({
	element,
	key,
}: {
	element: TimelineElement;
	key: string;
}): ElementParamDefinition | null {
	return (
		getElementParams({ element }).find((param) => param.key === key) ?? null
	);
}

export function readElementParamValue({
	element,
	param,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
}): ParamValue | null {
	if (param.read) {
		return param.read({ element });
	}
	if ("params" in element) {
		return element.params[param.key] ?? param.default;
	}
	return null;
}

export function writeElementParamValue({
	element,
	param,
	value,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
	value: ParamValue;
}): TimelineElement {
	if (param.write) {
		return param.write({ element, value });
	}
	if ("params" in element) {
		return {
			...element,
			params: {
				...element.params,
				[param.key]: value,
			},
		};
	}
	return element;
}

export function buildElementParamValues({
	element,
}: {
	element: TimelineElement;
}): ParamValues {
	const values: ParamValues = {};
	for (const param of getElementParams({ element })) {
		const value = readElementParamValue({ element, param });
		if (value !== null) {
			values[param.key] = value;
		}
	}
	return values;
}

