import type { ParamValues } from "@/params";

export const BACKGROUND_FILL_MODES = [
	"none",
	"blur",
	"color",
	"style",
] as const;

export type BackgroundFillMode = (typeof BACKGROUND_FILL_MODES)[number];

export type BackgroundFillKind = Exclude<BackgroundFillMode, "none">;

export type BackgroundFillSettings = {
	/** Master switch — when false, no fill layer is built. */
	enabled: boolean;
	mode: BackgroundFillMode;
	blurIntensity: number;
	color: string;
	styleId: string | null;
};

/** Stronger than project default (10): clip fill needs a CapCut-visible first look. */
export const DEFAULT_CLIP_BACKGROUND_BLUR_INTENSITY = 40;

/** White (not project black) so color fill is visible against the black canvas clear. */
export const DEFAULT_CLIP_BACKGROUND_FILL_COLOR = "#FFFFFF";

export const DEFAULT_BACKGROUND_FILL: BackgroundFillSettings = {
	enabled: false,
	mode: "none",
	blurIntensity: DEFAULT_CLIP_BACKGROUND_BLUR_INTENSITY,
	color: DEFAULT_CLIP_BACKGROUND_FILL_COLOR,
	styleId: null,
};

export const BACKGROUND_FILL_MODE_OPTIONS: Array<{
	value: BackgroundFillMode;
	label: string;
}> = [
	{ value: "none", label: "None" },
	{ value: "blur", label: "Blur" },
	{ value: "color", label: "Color" },
	{ value: "style", label: "Style" },
];

function readString({
	params,
	key,
	fallback,
}: {
	params: ParamValues;
	key: string;
	fallback: string;
}): string {
	const value = params[key];
	return typeof value === "string" ? value : fallback;
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

function asMode(value: string): BackgroundFillMode {
	if (
		value === "blur" ||
		value === "color" ||
		value === "style" ||
		value === "none"
	) {
		return value;
	}
	return "none";
}

export function readBackgroundFillFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): BackgroundFillSettings {
	const safe = params ?? {};
	const mode = asMode(
		readString({
			params: safe,
			key: "backgroundFill.mode",
			fallback: DEFAULT_BACKGROUND_FILL.mode,
		}),
	);
	const enabledRaw = safe["backgroundFill.enabled"];
	// Prefer explicit enabled; legacy projects only had mode ("none" = off).
	const enabled =
		typeof enabledRaw === "boolean" ? enabledRaw : mode !== "none";
	const styleRaw = safe["backgroundFill.styleId"];
	const styleId =
		typeof styleRaw === "string" && styleRaw.length > 0 ? styleRaw : null;
	return {
		enabled,
		mode,
		blurIntensity: Math.max(
			0,
			readNumber({
				params: safe,
				key: "backgroundFill.blurIntensity",
				fallback: DEFAULT_BACKGROUND_FILL.blurIntensity,
			}),
		),
		color: readString({
			params: safe,
			key: "backgroundFill.color",
			fallback: DEFAULT_BACKGROUND_FILL.color,
		}),
		styleId,
	};
}

export function isBackgroundFillActive({
	fill,
}: {
	fill: BackgroundFillSettings;
}): boolean {
	return fill.enabled && fill.mode !== "none";
}

/** Type dropdown value while Enabled may be off (mode can still be "none" in legacy data). */
export function activeBackgroundFillKind({
	fill,
}: {
	fill: BackgroundFillSettings;
}): BackgroundFillKind {
	if (fill.mode === "color" || fill.mode === "style" || fill.mode === "blur") {
		return fill.mode;
	}
	return "blur";
}
