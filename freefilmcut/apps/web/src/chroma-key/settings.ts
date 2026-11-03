import { resolveAnimationPathValueAtTime } from "@/animation";
import type { ParamValue, ParamValues } from "@/params";
import type { VisualElement } from "@/timeline";

/**
 * Chroma-key settings as the renderer consumes them.
 *
 * Stored in `element.params` under the `chromaKey.*` keys so the existing
 * machinery does the heavy lifting: the property panel renders them, the
 * keyframe system animates them, and `useCoalescedPreview` keeps a slider drag
 * from committing once per pointer event.
 *
 * Every slider stays in **0..100 authoring units** here, exactly as the panel
 * and the project file store it. The conversion into shader units (a CbCr
 * distance radius, a texel radius, …) happens once, at the shader boundary in
 * `services/renderer/compositor/chroma-key-material.ts`, so there is exactly
 * one place where "60 means what" is defined and exactly one place to test it.
 */
export type ChromaKeySettings = {
	enabled: boolean;
	/** sRGB components, 0..1 — the same space the eyedropper samples from. */
	keyColor: [number, number, number];
	/** 强度 0..100 — how far from the key colour still counts as background. */
	intensity: number;
	/** 边缘羽化 0..100 — width of the alpha ramp in colour space. */
	feather: number;
	/** 边缘柔化 0..100 — spatial blur of the matte, in source texels. */
	soften: number;
	/** 阴影 0..100 — keeps dark pixels (the shadow on the screen) opaque. */
	shadow: number;
	/** 边缘清除 0..100 — pulls the key hue out of the surviving fringe. */
	edgeCleanup: number;
};

export const CHROMA_KEY_PARAM_KEYS = [
	"chromaKey.enabled",
	"chromaKey.color",
	"chromaKey.intensity",
	"chromaKey.feather",
	"chromaKey.soften",
	"chromaKey.shadow",
	"chromaKey.edgeCleanup",
] as const;

/**
 * The six keys the Keying tab renders, in reference-panel order (pick the
 * colour first, then judge the key). `chromaKey.enabled` is excluded on
 * purpose — it lives in the section header as a Switch, not as a row.
 */
export const CHROMA_KEY_PANEL_KEYS = [
	"chromaKey.color",
	"chromaKey.intensity",
	"chromaKey.shadow",
	"chromaKey.feather",
	"chromaKey.soften",
	"chromaKey.edgeCleanup",
] as const;

export const DEFAULT_CHROMA_KEY_COLOR = "#00FF00";

/**
 * Defaults chosen so that **switching the keyer on is already a usable key**.
 *
 * The old default (强度 20, 羽化 0) mapped to a 0.146 colour radius with a
 * 0.002 ramp: on real footage — a green screen is never exactly #00FF00, it has
 * a cool or warm cast — the background sat outside the radius and nothing
 * keyed, which is why the eyedropper had to be used before anything happened.
 * These defaults key a typical green screen on their own and leave a visible
 * ramp on the edge.
 */
export const DEFAULT_CHROMA_KEY_INTENSITY = 45;
export const DEFAULT_CHROMA_KEY_FEATHER = 25;
export const DEFAULT_CHROMA_KEY_SOFTEN = 30;
export const DEFAULT_CHROMA_KEY_EDGE_CLEANUP = 20;

const PERCENT_MAX = 100;

export function readChromaKeyFromParams({
	params,
}: {
	params: ParamValues;
}): ChromaKeySettings {
	return {
		enabled: readBoolean({ value: params["chromaKey.enabled"], fallback: false }),
		keyColor: parseHexColorToSrgb({
			hex: readString({
				value: params["chromaKey.color"],
				fallback: DEFAULT_CHROMA_KEY_COLOR,
			}),
		}),
		intensity: clampPercent({
			value: readNumber({
				value: params["chromaKey.intensity"],
				fallback: DEFAULT_CHROMA_KEY_INTENSITY,
			}),
		}),
		feather: clampPercent({
			value: readNumber({
				value: params["chromaKey.feather"],
				fallback: DEFAULT_CHROMA_KEY_FEATHER,
			}),
		}),
		soften: clampPercent({
			value: readNumber({
				value: params["chromaKey.soften"],
				fallback: DEFAULT_CHROMA_KEY_SOFTEN,
			}),
		}),
		shadow: clampPercent({
			value: readNumber({ value: params["chromaKey.shadow"], fallback: 0 }),
		}),
		edgeCleanup: clampPercent({
			value: readNumber({
				value: params["chromaKey.edgeCleanup"],
				fallback: DEFAULT_CHROMA_KEY_EDGE_CLEANUP,
			}),
		}),
	};
}

/**
 * Samples the keyer at a clip-local time so 强度/羽化/柔化/阴影/边缘清除 animate
 * with the rest of the clip.
 *
 * Only the enabled flag and the colour are read from the base params — a
 * colour has no meaningful interpolation here (a keyframed colour would be a
 * moving target that re-keys the whole frame every frame), so the key colour is
 * deliberately taken as a constant.
 */
export function resolveChromaKeyAtTime({
	base,
	animations,
	localTime,
}: {
	base: ChromaKeySettings;
	animations: VisualElement["animations"] | undefined;
	localTime: Parameters<typeof resolveAnimationPathValueAtTime>[0]["localTime"];
}): ChromaKeySettings {
	if (!base.enabled) return base;

	const sample = ({
		key,
		fallback,
	}: {
		key: string;
		fallback: number;
	}): number => {
		const value: ParamValue = resolveAnimationPathValueAtTime({
			animations,
			propertyPath: key,
			localTime,
			fallbackValue: fallback,
		});
		return clampPercent({
			value: typeof value === "number" ? value : fallback,
		});
	};

	return {
		enabled: true,
		keyColor: base.keyColor,
		intensity: sample({ key: "chromaKey.intensity", fallback: base.intensity }),
		feather: sample({ key: "chromaKey.feather", fallback: base.feather }),
		soften: sample({ key: "chromaKey.soften", fallback: base.soften }),
		shadow: sample({ key: "chromaKey.shadow", fallback: base.shadow }),
		edgeCleanup: sample({
			key: "chromaKey.edgeCleanup",
			fallback: base.edgeCleanup,
		}),
	};
}

/**
 * `#RRGGBB` (or `#RGB`) → sRGB 0..1.
 *
 * Deliberately *not* converted to linear: the shader converts the sampled
 * pixel back to sRGB before measuring distance, so both sides live in the space
 * the eyedropper read from the preview. Comparing in linear compresses the
 * dark end of the ramp and makes the same slider value key differently on
 * dark vs bright footage.
 */
export function parseHexColorToSrgb({
	hex,
}: {
	hex: string;
}): [number, number, number] {
	const trimmed = hex.trim().replace(/^#/, "");
	if (trimmed.length === 3) {
		const [r, g, b] = trimmed;
		return [
			hexPairToUnit({ pair: `${r}${r}` }),
			hexPairToUnit({ pair: `${g}${g}` }),
			hexPairToUnit({ pair: `${b}${b}` }),
		];
	}
	if (trimmed.length !== 6 || !/^[0-9a-f]{6}$/i.test(trimmed)) {
		return parseHexColorToSrgb({ hex: DEFAULT_CHROMA_KEY_COLOR });
	}
	return [
		hexPairToUnit({ pair: trimmed.slice(0, 2) }),
		hexPairToUnit({ pair: trimmed.slice(2, 4) }),
		hexPairToUnit({ pair: trimmed.slice(4, 6) }),
	];
}

function hexPairToUnit({ pair }: { pair: string }): number {
	return Number.parseInt(pair, 16) / 255;
}

export function clampPercent({ value }: { value: number }): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(PERCENT_MAX, Math.max(0, value));
}

function readNumber({
	value,
	fallback,
}: {
	value: ParamValue | undefined;
	fallback: number;
}): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function readBoolean({
	value,
	fallback,
}: {
	value: ParamValue | undefined;
	fallback: boolean;
}): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function readString({
	value,
	fallback,
}: {
	value: ParamValue | undefined;
	fallback: string;
}): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}
