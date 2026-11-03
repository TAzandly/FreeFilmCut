/**
 * Timeline TextElement → Troika FlowerStyle via a synthetic UI pack scene.
 * Reuses buildPackScene flower stack (same as editor / vfxpack UI text).
 */

import type { LoadedVfxPack, VfxSceneFile, VfxSceneNode } from "@/vfxpack/types";
import type { FlowerStyle } from "@/vfxpack/flower-style";
import { getFlowerPackPreset } from "@/vfxpack/flower-pack-catalog";
import {
	FLOWER_PRESETS,
	createDefaultFlowerStyle,
	createSolidContent,
	createJianying7645FlowerStyle,
	getFlowerPreset,
	remapFlowerStyleTexturePathsForOpenCut,
	JIANYING_7645_PACK_ID,
	type FlowerPresetDef,
} from "@/vfxpack/flower-style";
import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import type { TextElement } from "@/timeline";
import type { ParamValues } from "@/params";

export const TIMELINE_FLOWER_TEXT_PACK_PREFIX = "fcc-timeline-flower-text:";

export function scaledFontSizeForCanvas({
	fontSize,
	canvasHeight,
}: {
	fontSize: number;
	canvasHeight: number;
}): number {
	const fs = Number(fontSize) > 0 ? Number(fontSize) : 15;
	const h =
		Number(canvasHeight) > 0 ? Number(canvasHeight) : FONT_SIZE_SCALE_REFERENCE;
	return fs * (h / FONT_SIZE_SCALE_REFERENCE);
}

export function readTextParamString(
	params: ParamValues | Record<string, unknown>,
	key: string,
	fallback = "",
): string {
	const v = (params as Record<string, unknown>)[key];
	return typeof v === "string" ? v : fallback;
}

export function readTextParamNumber(
	params: ParamValues | Record<string, unknown>,
	key: string,
	fallback: number,
): number {
	const v = (params as Record<string, unknown>)[key];
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

export type TimelineFlowerTextProps = {
	content: string;
	fontSize: number;
	scaledFontSize: number;
	fontFamily: string;
	color: string;
	textAlign: string;
	fontWeight: string;
	letterSpacing: number;
	lineHeight: number;
	flowerStyle: FlowerStyle | null;
	flowerBaseFontSize: number | null;
	flowerTemplateId: string | null;
	canvasWidth: number;
	canvasHeight: number;
	positionX: number;
	positionY: number;
	scaleX: number;
	scaleY: number;
	rotate: number;
	opacity: number;
};

export function resolveTimelineFlowerTextProps({
	element,
	canvasWidth,
	canvasHeight,
}: {
	element:
		| TextElement
		| {
				id?: string;
				params: ParamValues;
				flowerStyle?: unknown | null;
				flowerBaseFontSize?: number | null;
				flowerTemplateId?: string | null;
		  };
	canvasWidth: number;
	canvasHeight: number;
}): TimelineFlowerTextProps {
	const p = element.params as ParamValues & Record<string, unknown>;
	const fontSize = readTextParamNumber(p, "fontSize", 15);
	const scaled = scaledFontSizeForCanvas({ fontSize, canvasHeight });
	const color = readTextParamString(p, "color", "#ffffff") || "#ffffff";
	let flowerStyle: FlowerStyle | null = null;
	const rawStyle = (element as TextElement).flowerStyle ?? (p as { flowerStyle?: unknown }).flowerStyle;
	if (rawStyle && typeof rawStyle === "object") {
		flowerStyle = remapFlowerStyleTexturePathsForOpenCut(rawStyle);
	} else {
		// Plain Default text: still use FlowerStyle solid face (same Troika stack as Effects).
		// Leaving flowerStyle null made getEffectiveFlowerStyle rebuild every sync and
		// raced the one-shot OpenCut preview blit before Troika glyphs were ready.
		flowerStyle = createDefaultFlowerStyle({
			fill: {
				alpha: 1,
				content: createSolidContent(color, 1),
			},
		});
	}
	const baseFromEl = Number((element as TextElement).flowerBaseFontSize);
	const baseFs =
		baseFromEl > 0
			? baseFromEl
			: readTextParamNumber(p, "flowerBaseFontSize", 0);
	const templateId =
		(element as TextElement).flowerTemplateId ||
		readTextParamString(p, "flowerTemplateId", "") ||
		null;
	return {
		content: readTextParamString(p, "content", "Default text") || "Default text",
		fontSize,
		scaledFontSize: scaled,
		fontFamily: readTextParamString(p, "fontFamily", "Arial") || "Arial",
		color,
		textAlign: readTextParamString(p, "textAlign", "center") || "center",
		fontWeight: readTextParamString(p, "fontWeight", "normal") || "normal",
		letterSpacing: readTextParamNumber(p, "letterSpacing", 0),
		lineHeight: readTextParamNumber(p, "lineHeight", 1.2),
		flowerStyle,
		flowerBaseFontSize: baseFs > 0 ? baseFs : null,
		flowerTemplateId: templateId,
		canvasWidth,
		canvasHeight,
		positionX: readTextParamNumber(p, "transform.positionX", 0),
		positionY: readTextParamNumber(p, "transform.positionY", 0),
		scaleX: readTextParamNumber(p, "transform.scaleX", 1),
		scaleY: readTextParamNumber(p, "transform.scaleY", 1),
		rotate: readTextParamNumber(p, "transform.rotate", 0),
		opacity: readTextParamNumber(p, "opacity", 1),
	};
}

/** Build fccUI for getEffectiveFlowerStyle / Troika sync. */
export function timelinePropsToFccUI(props: TimelineFlowerTextProps) {
	const align =
		props.textAlign === "left" || props.textAlign === "right"
			? props.textAlign
			: "center";
	return {
		type: "text" as const,
		text: props.content,
		fontSize: props.scaledFontSize,
		font: "",
		fontBold: "",
		bold: props.fontWeight === "bold",
		color: props.color,
		letterSpacing: props.letterSpacing,
		lineHeight: props.lineHeight,
		align,
		verticalAlign: "middle",
		outline: { enabled: false, width: 2, color: "#000000", opacity: 1 },
		shadow: {
			enabled: false,
			offsetX: 2,
			offsetY: -2,
			blur: 4,
			color: "#000000",
			opacity: 0.75,
		},
		flowerStyle: props.flowerStyle,
		flowerBaseFontSize: props.flowerBaseFontSize,
		sizeDelta: [
			Math.max(1, props.canvasWidth * 0.9),
			Math.max(1, props.scaledFontSize * 3),
		] as [number, number],
		anchorMin: [0.5, 0.5] as [number, number],
		anchorMax: [0.5, 0.5] as [number, number],
		pivot: [0.5, 0.5] as [number, number],
		anchoredPosition: [0, 0] as [number, number],
		localEulerAngles: [0, 0, 0] as [number, number, number],
		localScale: [1, 1, 1] as [number, number, number],
		renderMode: "overlay" as const,
	};
}

export function buildSyntheticFlowerTextPack({
	packId,
	props,
}: {
	packId: string;
	props: TimelineFlowerTextProps;
}): LoadedVfxPack {
	const W = Math.max(1, Math.round(props.canvasWidth));
	const H = Math.max(1, Math.round(props.canvasHeight));
	const fccUI = timelinePropsToFccUI(props);
	const canvasUuid = `${packId}:canvas`;
	const textUuid = `${packId}:text`;
	const identityTransform = {
		position: [0, 0, 0],
		rotation: [0, 0, 0],
		quaternion: [0, 0, 0, 1],
		scale: [1, 1, 1],
	} as const;
	const canvasNode: VfxSceneNode = {
		uuid: canvasUuid,
		name: "TimelineTextCanvas",
		kind: "ui",
		type: "Group",
		parent: null,
		transform: { ...identityTransform },
		ui: {
			type: "canvas",
			anchorMin: [0, 0],
			anchorMax: [1, 1],
			pivot: [0.5, 0.5],
			anchoredPosition: [0, 0],
			sizeDelta: [0, 0],
			renderMode: "overlay",
		},
		userData: {
			fccUI: {
				type: "canvas",
				anchorMin: [0, 0],
				anchorMax: [1, 1],
				pivot: [0.5, 0.5],
				anchoredPosition: [0, 0],
				sizeDelta: [0, 0],
				renderMode: "overlay",
			},
		},
	};
	const textNode: VfxSceneNode = {
		uuid: textUuid,
		name: "TimelineText",
		kind: "ui",
		type: "Group",
		parent: canvasUuid,
		transform: { ...identityTransform },
		ui: { ...fccUI },
		userData: { fccUI: { ...fccUI } },
	};
	const scene: VfxSceneFile = {
		schema: "vfxpack/1.1",
		name: packId,
		resolution: { width: W, height: H },
		nodes: [canvasNode, textNode],
	};
	return {
		id: packId,
		displayName: "Timeline flower text",
		type: "art-text",
		scope: "stack",
		manifest: {
			schema: "vfxpack/1.1",
			id: packId,
			displayName: "Timeline flower text",
			type: "art-text",
			scope: "stack",
			version: "1",
		} as LoadedVfxPack["manifest"],
		scene,
		files: new Map(),
		objectUrls: new Map(),
		sourceFileName: `${packId}.synthetic`,
	};
}

export function contentHashForFlowerText(props: TimelineFlowerTextProps): string {
	return JSON.stringify({
		c: props.content,
		fs: props.scaledFontSize,
		ff: props.fontFamily,
		col: props.color,
		al: props.textAlign,
		fw: props.fontWeight,
		ls: props.letterSpacing,
		lh: props.lineHeight,
		sty: props.flowerStyle,
		base: props.flowerBaseFontSize,
		tid: props.flowerTemplateId,
		cw: props.canvasWidth,
		ch: props.canvasHeight,
		rev: 2, // fcc-tl-flower-2: default solid style + preview epoch
	});
}

export type FlowerTextElementPatch = {
	params: ParamValues;
	flowerStyle: FlowerStyle | null;
	flowerBaseFontSize: number | null;
	flowerTemplateId: string | null;
};

/** Apply a named flower preset onto a text element (design size 48). */
export function applyFlowerPresetToTextElement({
	params,
	presetId,
}: {
	params: ParamValues;
	presetId: string;
}): FlowerTextElementPatch {
	const preset = getFlowerPackPreset(presetId) || getFlowerPreset(presetId);
	const designFs = preset?.designFontSize ?? 48;
	let style: FlowerStyle;
	if (preset) {
		style = remapFlowerStyleTexturePathsForOpenCut(preset.create(designFs));
	} else if (presetId === JIANYING_7645_PACK_ID) {
		style = remapFlowerStyleTexturePathsForOpenCut(
			createJianying7645FlowerStyle(designFs),
		);
	} else {
		style = createDefaultFlowerStyle({
			fill: {
				alpha: 1,
				content: createSolidContent(
					typeof params.color === "string" ? params.color : "#ffffff",
					1,
				),
			},
		});
	}
	const fillColor =
		style.fill?.content?.renderType === "gradient"
			? style.fill.content.gradient.colors[0]
			: style.fill?.content?.solid?.color || "#ffffff";
	return {
		params: { ...params, color: fillColor },
		flowerStyle: style,
		flowerBaseFontSize: designFs,
		flowerTemplateId: presetId,
	};
}

/** @deprecated use applyFlowerPresetToTextElement */
export function applyFlowerPresetToTextParams({
	params,
	presetId,
}: {
	params: ParamValues;
	presetId: string;
}): ParamValues {
	return applyFlowerPresetToTextElement({ params, presetId }).params;
}

export function clearFlowerStyleFromTextElement(): Pick<
	FlowerTextElementPatch,
	"flowerStyle" | "flowerBaseFontSize" | "flowerTemplateId"
> {
	return {
		flowerStyle: null,
		flowerBaseFontSize: null,
		flowerTemplateId: null,
	};
}

export type BuiltinTextTemplate = {
	id: string;
	name: string;
	cover: string;
	/** null = plain default (Troika solid fill from color, no flowerStyle). */
	presetId: string | null;
};

export function listBuiltinTextTemplates(): BuiltinTextTemplate[] {
	const flower: BuiltinTextTemplate[] = FLOWER_PRESETS.map((p) => ({
		id: p.id,
		name: p.name,
		cover: p.cover,
		presetId: p.id,
	}));
	return [
		{
			id: "default",
			name: "Default text",
			cover: "",
			presetId: null,
		},
		...flower,
	];
}

export type { FlowerPresetDef };
