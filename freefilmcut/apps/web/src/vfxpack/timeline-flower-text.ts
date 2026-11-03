/**
 * Timeline TextElement → Troika FlowerStyle via a synthetic UI pack scene.
 * Reuses buildPackScene flower stack (same as editor / vfxpack UI text).
 */

import type { LoadedVfxPack, VfxSceneFile, VfxSceneNode } from "@/vfxpack/types";
import type { FlowerStyle } from "@/vfxpack/flower-style";
import { getFlowerPackPreset } from "@/vfxpack/flower-pack-catalog";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import { setTextStickerPackLookup } from "@/vfxpack/text-stickers.js";
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
import {
	DEFAULT_FONT_SIZE,
	FONT_SIZE_SCALE_REFERENCE,
	MIN_FONT_SIZE,
	MAX_FONT_SIZE,
} from "@/text/typography";
import type { TextElement } from "@/timeline";
import type { ParamValues } from "@/params";
import {
	FCC_DEFAULT_TROIKA_FONT,
	getDefaultTroikaFont,
} from "@/fonts/default-troika-font";

export { FCC_DEFAULT_TROIKA_FONT, getDefaultTroikaFont };

export const TIMELINE_FLOWER_TEXT_PACK_PREFIX = "fcc-timeline-flower-text:";

/** DevTools filter: [FreeFilmCut][FlowerStroke] — only when debug flag is on. */
export const FLOWER_STROKE_LOG_PREFIX = "[FreeFilmCut][FlowerStroke]";

/**
 * Hot-path flower stroke diagnostics. Default OFF (was spamming clip console).
 * Enable: `globalThis.__FCC_FLOWER_STROKE_DEBUG = true` or localStorage fccFlowerStrokeDebug=1
 */
export function isFlowerStrokeDebugEnabled(): boolean {
	try {
		const g = globalThis as typeof globalThis & { __FCC_FLOWER_STROKE_DEBUG?: unknown };
		if (g.__FCC_FLOWER_STROKE_DEBUG === true) return true;
		if (typeof localStorage !== "undefined" && localStorage.getItem("fccFlowerStrokeDebug") === "1") {
			return true;
		}
	} catch {
		/* ignore */
	}
	return false;
}

function flowerStrokeLog(...args: unknown[]): void {
	if (!isFlowerStrokeDebugEnabled()) return;
	console.log(FLOWER_STROKE_LOG_PREFIX, ...args);
}

/** Dedupe render-resolve logs when debug is on. */
let _lastFlowerResolveLogKey = "";

function packFontObjectUrl(
	pack: LoadedVfxPack,
	rel: string,
): string {
	const clean = rel.replace(/^pack\//, "").replace(/^\.\//, "");
	const hit =
		pack.objectUrls.get(clean) ||
		pack.objectUrls.get("pack/" + clean) ||
		pack.objectUrls.get(rel);
	if (hit) return hit;
	const bytes = pack.files.get(clean) || pack.files.get("pack/" + clean) || pack.files.get(rel);
	if (!bytes) return "";
	const copy = bytes.slice();
	const url = URL.createObjectURL(new Blob([copy], { type: "font/ttf" }));
	pack.objectUrls.set(clean, url);
	return url;
}

/**
 * Resolve a timeline params.fontFamily value into a Troika `font` URL.
 * Text-template apply stores pack-relative `fonts/…` (or blob URLs) in fontFamily.
 * Pass packId so fonts/ can be resolved from the loaded text-template pack.
 */
export function resolveTroikaFontUrl(
	fontFamily: string | null | undefined,
	packId?: string | null,
): string {
	const f = String(fontFamily || "").trim();
	const fallback = getDefaultTroikaFont();
	if (!f) return fallback;
	if (
		f.startsWith("blob:") ||
		f.startsWith("http://") ||
		f.startsWith("https://") ||
		f.startsWith("data:") ||
		f.startsWith("/fonts/")
	) {
		return f;
	}
	if (f.startsWith("fonts/") || f.startsWith("pack/fonts/")) {
		const id = packId ? String(packId) : "";
		if (id) {
			const pack =
				getPackRegistrySnapshot().packs.find((e) => e.id === id) || null;
			if (pack) {
				const url = packFontObjectUrl(pack, f);
				if (url) return url;
			}
		}
		// Unresolved pack-relative path — Troika cannot fetch it; fall back.
		return fallback;
	}
	if (/^(microsoft yahei|微软雅黑|msyh)$/i.test(f)) return fallback;
	return fallback;
}

/** Fallback when a pack / element carries no usable fontSize (same as new text). */
const DEFAULT_PARAM_FONT_SIZE = DEFAULT_FONT_SIZE;

/** New clip from Assets->Effects: never use pack UIText / pack name. */
export const FLOWER_EFFECT_DEFAULT_CONTENT = "Default";
/** New clip from Assets->Effects default param fontSize. */
export const FLOWER_EFFECT_DEFAULT_FONT_SIZE = 100;

/**
 * Font size -> Troika units (plain + flower unified).
 *   troikaFs = params.fontSize  (1:1, same as Editor)
 * Stroke/shadow still scale via getEffectiveFlowerStyle(troikaFs / flowerBaseFontSize).
 * canvasHeight / flower* args kept for call-site compat; unused for glyph size.
 */
export function scaledFontSizeForCanvas({
	fontSize,
	canvasHeight: _canvasHeight,
	flowerBaseFontSize: _flowerBaseFontSize,
	flowerDesignCanvasHeight: _flowerDesignCanvasHeight,
}: {
	fontSize: number;
	canvasHeight: number;
	flowerBaseFontSize?: number | null;
	flowerDesignCanvasHeight?: number | null;
}): number {
	const fs = Number(fontSize) > 0 ? Number(fontSize) : DEFAULT_PARAM_FONT_SIZE;
	return fs;
}

/**
 * Map Editor designFontSize → OpenCut param (1:1). Kept for callers that need it;
 * applyFlowerPresetToTextElement does NOT overwrite the user's fontSize.
 */
export function editorFontSizeToOpenCutParam({
	designFontSize,
	designCanvasHeight: _designCanvasHeight,
}: {
	designFontSize: number;
	designCanvasHeight?: number | null;
}): number | null {
	const dfs = Number(designFontSize);
	if (!(dfs > 0)) return null;
	return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, dfs));
}

/** @deprecated Plain+flower are both 1:1; clear no longer converts. Kept for rare tooling. */
export function flowerFontSizeToPlainParam({
	flowerFontSize,
	canvasHeight,
}: {
	flowerFontSize: number;
	canvasHeight: number;
}): number {
	const f = Number(flowerFontSize);
	const h =
		Number(canvasHeight) > 0 ? Number(canvasHeight) : FONT_SIZE_SCALE_REFERENCE;
	if (!(f > 0)) return DEFAULT_PARAM_FONT_SIZE;
	const raw = (f * FONT_SIZE_SCALE_REFERENCE) / h;
	return Math.max(1, Math.min(MAX_FONT_SIZE, raw));
}

/** @deprecated Both paths are 1:1; identity in practice. */
export function plainParamToFlowerFontSize({
	plainFontSize,
	canvasHeight,
}: {
	plainFontSize: number;
	canvasHeight: number;
}): number {
	const p = Number(plainFontSize);
	const h =
		Number(canvasHeight) > 0 ? Number(canvasHeight) : FONT_SIZE_SCALE_REFERENCE;
	if (!(p > 0)) return DEFAULT_PARAM_FONT_SIZE;
	const raw = p * (h / FONT_SIZE_SCALE_REFERENCE);
	return Math.max(1, Math.min(MAX_FONT_SIZE, raw));
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
	fontStyle: string;
	letterSpacing: number;
	lineHeight: number;
	flowerStyle: FlowerStyle | null;
	flowerBaseFontSize: number | null;
	flowerDesignCanvasHeight: number | null;
	flowerTemplateId: string | null;
	canvasWidth: number;
	canvasHeight: number;
	positionX: number;
	positionY: number;
	scaleX: number;
	scaleY: number;
	rotate: number;
	opacity: number;
	/** Clip-authored Text Fx (Registry PP on text RT). Pack postProcess merges at compose. */
	textFxStack?: import("@/vfxpack/postprocess").PostProcessStackData | null;
	/** Remapped textStickers from text-template (AABB follow on clip compositor). */
	textStickers?: Array<Record<string, unknown>> | null;
	/** MediaFramePlayers from text-template (gif/seq/video → RT). */
	textTemplateMediaPlayers?: Array<Record<string, unknown>> | null;
	/** Source pack id for media file bytes / objectUrls. */
	textTemplatePackId?: string | null;
};


function readTextFxStack(element: {
	params?: Record<string, unknown>;
	textFxStack?: unknown;
}): import("@/vfxpack/postprocess").PostProcessStackData | null {
	const fromEl = (element as { textFxStack?: unknown }).textFxStack;
	const fromParams = element.params && (element.params as { textFxStack?: unknown }).textFxStack;
	const raw = fromEl ?? fromParams ?? null;
	if (!raw || typeof raw !== "object") return null;
	const effects = Array.isArray((raw as { effects?: unknown }).effects)
		? (raw as { effects: import("@/vfxpack/postprocess").PostProcessEffectEntry[] }).effects
		: [];
	return {
		enabled: (raw as { enabled?: boolean }).enabled !== false,
		effects,
	};
}



/** Pack scene sticker by id (shared with text-stickers pose lookup). */
function findPackSceneSticker(
	packId: string,
	stickerId: string,
): Record<string, unknown> | null {
	if (!packId || !stickerId) return null;
	const pack =
		getPackRegistrySnapshot().packs.find((e) => e.id === packId) || null;
	if (!pack?.scene || !Array.isArray((pack.scene as { nodes?: unknown[] }).nodes)) {
		return null;
	}
	for (const node of (pack.scene as {
		nodes: Array<{
			userData?: { fccUI?: { textStickers?: unknown } };
			ui?: { textStickers?: unknown };
		}>;
	}).nodes) {
		const list =
			(node.userData?.fccUI?.textStickers as unknown[]) ||
			(node.ui?.textStickers as unknown[]) ||
			null;
		if (!Array.isArray(list)) continue;
		for (const raw of list) {
			if (!raw || typeof raw !== "object") continue;
			if (String((raw as { id?: unknown }).id || "") === stickerId) {
				return raw as Record<string, unknown>;
			}
		}
	}
	return null;
}

function loadAllPackSceneStickers(
	packId: string | null,
): Array<Record<string, unknown>> | null {
	if (!packId) return null;
	const pack =
		getPackRegistrySnapshot().packs.find((e) => e.id === packId) || null;
	if (!pack?.scene || !Array.isArray((pack.scene as { nodes?: unknown[] }).nodes)) {
		return null;
	}
	const byId = new Map<string, Record<string, unknown>>();
	for (const node of (pack.scene as {
		nodes: Array<{
			userData?: { fccUI?: { textStickers?: unknown } };
			ui?: { textStickers?: unknown };
		}>;
	}).nodes) {
		const list =
			(node.userData?.fccUI?.textStickers as unknown[]) ||
			(node.ui?.textStickers as unknown[]) ||
			null;
		if (!Array.isArray(list)) continue;
		for (const raw of list) {
			if (!raw || typeof raw !== "object") continue;
			const id = String((raw as { id?: unknown }).id || "");
			if (id && !byId.has(id)) byId.set(id, { ...(raw as Record<string, unknown>) });
		}
	}
	return byId.size ? Array.from(byId.values()) : null;
}

/** Always overwrite scale/offset/rotation from pack scene (SoT). */

function rtUuidFromPackMaterial(
	packId: string,
	materialUuid: string,
): string | null {
	if (!packId || !materialUuid) return null;
	const pack =
		getPackRegistrySnapshot().packs.find((e) => e.id === packId) || null;
	if (!pack?.scene || !Array.isArray((pack.scene as { nodes?: unknown[] }).nodes)) {
		return null;
	}
	const re = /^rt:(.+)$/i;
	for (const node of (pack.scene as { nodes: Array<Record<string, unknown>> }).nodes) {
		const mats = node.materials;
		if (!Array.isArray(mats)) continue;
		for (const raw of mats) {
			if (!raw || typeof raw !== "object") continue;
			const m = raw as {
				uuid?: string;
				textures?: { map?: string };
				uniforms?: { map?: { path?: string } };
			};
			if (String(m.uuid || "") !== materialUuid) continue;
			const path =
				(typeof m.textures?.map === "string" && m.textures.map) ||
				(typeof m.uniforms?.map?.path === "string" && m.uniforms.map.path) ||
				"";
			const hit = re.exec(path.trim());
			if (hit) return hit[1];
		}
	}
	return null;
}

function enrichTextStickersFromPack(
	stickers: Array<Record<string, unknown>> | null,
	packId: string | null,
): Array<Record<string, unknown>> | null {
	const base =
		stickers?.length ? stickers : loadAllPackSceneStickers(packId);
	if (!base?.length || !packId) return base;
	return base.map((s) => {
		const id = typeof s.id === "string" ? s.id : "";
		const packS = id ? findPackSceneSticker(packId, id) : null;
		if (!packS) return s;
		const out = { ...s };
		for (const k of ["scaleX", "scaleY", "offsetX", "offsetY", "rotation"] as const) {
			if (packS[k] != null && Number.isFinite(Number(packS[k]))) {
				out[k] = Number(packS[k]);
			}
		}
		// fcc-tl-flower-26/27: stamp rtTargetUuid from pack ShaderMaterial map `rt:{uuid}`.
		// Hello pack stickers omit rtTargetUuid; without it clip spawns text-AABB
		// media-vis quads for the same RTs and scale looks like a no-op.
		if (!out.rtTargetUuid && typeof packS.materialUuid === "string") {
			const rt = rtUuidFromPackMaterial(packId, packS.materialUuid);
			if (rt) out.rtTargetUuid = rt;
			if (typeof packS.materialUuid === "string") out.materialUuid = packS.materialUuid;
		}
		if (!out.materialUuid && typeof packS.materialUuid === "string") {
			out.materialUuid = packS.materialUuid;
		}
		return out;
	});
}

// Wire pose-time pack lookup once (module load).
setTextStickerPackLookup((packId: string, stickerId: string) =>
	findPackSceneSticker(packId, stickerId),
);

function readTextStickers(element: {
	textStickers?: unknown;
	params?: Record<string, unknown>;
}): Array<Record<string, unknown>> | null {
	const fromEl = (element as { textStickers?: unknown }).textStickers;
	const fromParams =
		element.params && (element.params as { textStickers?: unknown }).textStickers;
	const raw = fromEl ?? fromParams ?? null;
	if (!Array.isArray(raw) || !raw.length) return null;
	// Plain mutable copies so pose can read scaleX/offsetY even if store froze proxies.
	return raw.map((s) => {
		if (!s || typeof s !== "object") return {} as Record<string, unknown>;
		const o = s as Record<string, unknown>;
		const scale =
			o && typeof o.scale === "object" && o.scale
				? (o.scale as Record<string, unknown>)
				: null;
		const offset =
			o && typeof o.offset === "object" && o.offset
				? (o.offset as Record<string, unknown>)
				: null;
		const sx = o.scaleX != null ? o.scaleX : scale?.x;
		const sy = o.scaleY != null ? o.scaleY : scale?.y;
		const ox = o.offsetX != null ? o.offsetX : offset?.x;
		const oy = o.offsetY != null ? o.offsetY : offset?.y;
		return {
			...o,
			scaleX: sx,
			scaleY: sy,
			offsetX: ox,
			offsetY: oy,
			rotation: o.rotation,
		};
	});
}

function readTextTemplateMediaPlayers(element: {
	textTemplateMediaPlayers?: unknown;
	params?: Record<string, unknown>;
}): Array<Record<string, unknown>> | null {
	const fromEl = (element as { textTemplateMediaPlayers?: unknown }).textTemplateMediaPlayers;
	const fromParams =
		element.params &&
		(element.params as { textTemplateMediaPlayers?: unknown }).textTemplateMediaPlayers;
	const raw = fromEl ?? fromParams ?? null;
	if (!Array.isArray(raw) || !raw.length) return null;
	return raw as Array<Record<string, unknown>>;
}

function readTextTemplatePackId(element: {
	textTemplatePackId?: unknown;
	params?: Record<string, unknown>;
}): string | null {
	const fromEl = (element as { textTemplatePackId?: unknown }).textTemplatePackId;
	const fromParams =
		element.params &&
		(element.params as { textTemplatePackId?: unknown }).textTemplatePackId;
	const raw = fromEl ?? fromParams ?? null;
	return typeof raw === "string" && raw ? raw : null;
}

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
				flowerDesignCanvasHeight?: number | null;
				flowerTemplateId?: string | null;
		  };
	canvasWidth: number;
	canvasHeight: number;
}): TimelineFlowerTextProps {
	const p = element.params as ParamValues & Record<string, unknown>;
	const fontSize = readTextParamNumber(p, "fontSize", 15);
	const color = readTextParamString(p, "color", "#ffffff") || "#ffffff";
	let flowerStyle: FlowerStyle | null = null;
	const rawStyle = (element as TextElement).flowerStyle ?? (p as { flowerStyle?: unknown }).flowerStyle;
	const hasAuthoredFlower = !!(rawStyle && typeof rawStyle === "object");
	if (hasAuthoredFlower) {
		flowerStyle = remapFlowerStyleTexturePathsForOpenCut(rawStyle);
		// fcc-tl-flower-64: Default text (and clear-flower) stamps a solid flowerStyle at
		// create time. Basic/Typography color only writes params.color; keep solid face
		// in sync so color picks actually show. Gradient/texture fills (Effects) untouched.
		const fillRt = flowerStyle?.fill?.content?.renderType;
		if (flowerStyle && (!fillRt || fillRt === 'solid')) {
			flowerStyle = {
				...flowerStyle,
				fill: {
					alpha: flowerStyle.fill?.alpha ?? 1,
					content: createSolidContent(color, 1),
				},
			};
		}
	} else {
		// Plain Default text: still use FlowerStyle solid face (same Troika stack as Effects).
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
	let designCanvasH = Number((element as TextElement).flowerDesignCanvasHeight);
	if (!(designCanvasH > 0)) {
		designCanvasH = readTextParamNumber(p, "flowerDesignCanvasHeight", 0);
	}
	if (!(designCanvasH > 0) && templateId) {
		const preset = getFlowerPackPreset(templateId);
		const fromPack = Number(preset?.designCanvasHeight);
		if (fromPack > 0) designCanvasH = fromPack;
	}
	// Catalog may not be loaded yet on first paint ? known Editor packs.
	if (!(designCanvasH > 0) && templateId && /flowertext1/i.test(templateId)) {
		designCanvasH = 400;
	}
	const scaled = scaledFontSizeForCanvas({
		fontSize,
		canvasHeight,
		flowerBaseFontSize: baseFs > 0 ? baseFs : null,
		flowerDesignCanvasHeight: designCanvasH > 0 ? designCanvasH : null,
	});
	if (isFlowerStrokeDebugEnabled()) {
		const resolveLogKey = JSON.stringify({
			templateId,
			fontSize,
			scaled,
			baseFs,
			designCanvasH,
			canvasHeight,
			hasAuthoredFlower,
		});
		if (resolveLogKey !== _lastFlowerResolveLogKey) {
			_lastFlowerResolveLogKey = resolveLogKey;
			flowerStrokeLog("render-resolve", {
				path: hasAuthoredFlower ? "existing-clip-or-flower" : "plain-default",
				packId: templateId,
				paramFontSize: fontSize,
				troikaFontSize: scaled,
				designFontSize: baseFs > 0 ? baseFs : null,
				designCanvasHeight: designCanvasH > 0 ? designCanvasH : null,
				scaleFactor: baseFs > 0 ? scaled / baseFs : null,
				troikaOneToOne: true,
				canvasWidth,
				canvasHeight,
			});
			if (hasAuthoredFlower && flowerStyle) {
				logFlowerStyleStrokes({
					path: "render-resolve",
					packId: templateId,
					style: flowerStyle,
					designFontSize: baseFs > 0 ? baseFs : scaled,
					effectiveFontSize: scaled,
				});
			}
		}
	}
	return {
		content: readTextParamString(p, "content", "Default text") || "Default text",
		fontSize,
		scaledFontSize: scaled,
		fontFamily: readTextParamString(p, "fontFamily", "Noto Sans SC") || "Noto Sans SC",
		color,
		textAlign: readTextParamString(p, "textAlign", "center") || "center",
		fontWeight: readTextParamString(p, "fontWeight", "normal") || "normal",
		fontStyle: readTextParamString(p, "fontStyle", "normal") || "normal",
		letterSpacing: readTextParamNumber(p, "letterSpacing", 0),
		lineHeight: readTextParamNumber(p, "lineHeight", 1.2),
		flowerStyle,
		flowerBaseFontSize: baseFs > 0 ? baseFs : null,
		flowerDesignCanvasHeight: designCanvasH > 0 ? designCanvasH : null,
		flowerTemplateId: templateId,
		textFxStack: readTextFxStack(element),
		canvasWidth,
		canvasHeight,
		positionX: readTextParamNumber(p, "transform.positionX", 0),
		positionY: readTextParamNumber(p, "transform.positionY", 0),
		scaleX: readTextParamNumber(p, "transform.scaleX", 1),
		scaleY: readTextParamNumber(p, "transform.scaleY", 1),
		rotate: readTextParamNumber(p, "transform.rotate", 0),
		opacity: readTextParamNumber(p, "opacity", 1),
		textStickers: enrichTextStickersFromPack(
			readTextStickers(element),
			readTextTemplatePackId(element) ||
				(typeof (element as { flowerTemplateId?: unknown }).flowerTemplateId ===
				"string"
					? String((element as { flowerTemplateId: string }).flowerTemplateId)
					: null),
		),
		textTemplateMediaPlayers: readTextTemplateMediaPlayers(element),
		textTemplatePackId:
			readTextTemplatePackId(element) ||
			(typeof (element as { flowerTemplateId?: unknown }).flowerTemplateId ===
			"string"
				? String((element as { flowerTemplateId: string }).flowerTemplateId)
				: null),
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
		// fcc-tl-flower-52: use pack/custom font from params.fontFamily (blob or fonts/)
		font: resolveTroikaFontUrl(props.fontFamily, props.textTemplatePackId),
		fontBold: "", // unused: fake bold via SDF expand, not bold font file
		fontUrl: resolveTroikaFontUrl(props.fontFamily, props.textTemplatePackId),
		bold: props.fontWeight === "bold",
		italic: props.fontStyle === "italic",
		fontStyle: props.fontStyle === "italic" ? "italic" : "normal",
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
		flowerDesignCanvasHeight: props.flowerDesignCanvasHeight,
		textFxStack: props.textFxStack,
		textStickers: props.textStickers ?? null,
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
		position: [0, 0, 0] as [number, number, number],
		rotation: [0, 0, 0] as [number, number, number],
		quaternion: [0, 0, 0, 1] as [number, number, number, number],
		scale: [1, 1, 1] as [number, number, number],
	};
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
		ui: { ...fccUI } as NonNullable<import("@/vfxpack/types").VfxSceneNode["ui"]>,
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
		fs: props.fontStyle,
		ls: props.letterSpacing,
		lh: props.lineHeight,
		sty: props.flowerStyle,
		base: props.flowerBaseFontSize,
		dch: props.flowerDesignCanvasHeight,
		tid: props.flowerTemplateId,
		fx: props.textFxStack,
		stk: props.textStickers,
		mp: props.textTemplateMediaPlayers,
		tidPack: props.textTemplatePackId,
		cw: props.canvasWidth,
		ch: props.canvasHeight,
		rev: 67, // fcc-tl-flower-67: idle preview RAF sleep + light FPS meter
	});
}

export type FlowerTextElementPatch = {
	params: ParamValues;
	flowerStyle: FlowerStyle | null;
	flowerBaseFontSize: number | null;
	flowerDesignCanvasHeight: number | null;
	flowerTemplateId: string | null;
	/** Art-text MediaPlayers (gif/seq/video -> RT) for flowerStyle `rt:` fills. */
	textTemplateMediaPlayers?: Array<Record<string, unknown>> | null;
	textTemplatePackId?: string | null;
};

/** Apply a named flower preset onto a text element (design size 48). */

/** Dump stroke/shadow linear measures (raw design + scaled to effectiveFontSize). */
export function logFlowerStyleStrokes({
	path,
	packId,
	style,
	designFontSize,
	effectiveFontSize,
}: {
	path: string;
	packId?: string | null;
	style: FlowerStyle | null | undefined;
	designFontSize: number;
	effectiveFontSize: number;
}): void {
	if (!isFlowerStrokeDebugEnabled()) return;
	const base = Number(designFontSize) > 0 ? Number(designFontSize) : 0;
	const eff = Number(effectiveFontSize) > 0 ? Number(effectiveFontSize) : base;
	const factor = base > 0 ? eff / base : 1;
	const stack = (style && style.stack) || [];
	const strokes: Record<string, unknown>[] = [];
	const shadows: Record<string, unknown>[] = [];

	const pushStroke = (
		st: {
			id?: string;
			width?: number;
			side?: string;
			alpha?: number;
			content?: {
				renderType?: string;
				solid?: { color?: string };
				gradient?: { colors?: string[] };
			};
		},
		extra: Record<string, unknown> = {},
	) => {
		const w = Number(st.width) || 0;
		const col =
			st.content?.renderType === "gradient"
				? st.content.gradient?.colors?.[0]
				: st.content?.solid?.color;
		const widthScaled = w * factor;
		strokes.push({
			id: st.id,
			side: st.side ?? "outer",
			widthRaw: w,
			widthScaled,
			widthOverFontSize: eff > 0 ? widthScaled / eff : null,
			expand: widthScaled,
			outlineWidth: widthScaled,
			color: col,
			alpha: st.alpha,
			...extra,
		});
	};

	for (const e of stack) {
		if (!e || typeof e !== "object") continue;
		if (e.kind === "stroke") {
			pushStroke(e as Parameters<typeof pushStroke>[0], { parent: "stack" });
		} else if (e.kind === "shadow" || e.kind === "inner") {
			const sh = e as {
				id?: string;
				distance?: number;
				diffuse?: number;
				blur?: number;
				offsetX?: number;
				offsetY?: number;
				alpha?: number;
				strokes?: Array<{
					id?: string;
					width?: number;
					side?: string;
					alpha?: number;
					content?: {
						renderType?: string;
						solid?: { color?: string };
						gradient?: { colors?: string[] };
					};
				}>;
			};
			const dist = Number(sh.distance) || 0;
			const blur = Number(sh.diffuse) || Number(sh.blur) || 0;
			const ox = Number(sh.offsetX) || 0;
			const oy = Number(sh.offsetY) || 0;
			const nested = sh.strokes || [];
			for (let i = 0; i < nested.length; i++) {
				const st = nested[i]!;
				pushStroke(st, {
					parent: e.kind,
					parentId: sh.id,
					nestedIndex: i,
				});
			}
			shadows.push({
				id: sh.id,
				kind: e.kind,
				distanceRaw: dist,
				distanceScaled: dist * factor,
				offsetXRaw: ox,
				offsetYRaw: oy,
				offsetXScaled: ox * factor,
				offsetYScaled: oy * factor,
				blurRaw: blur,
				blurScaled: blur * factor,
				alpha: sh.alpha,
				nestedStrokeCount: nested.length,
			});
		}
	}

	// Also surface bucket strokes if stack was empty but buckets exist
	if (strokes.length === 0 && style?.strokes?.length) {
		for (const st of style.strokes) {
			pushStroke(st as Parameters<typeof pushStroke>[0], { parent: "bucket" });
		}
	}

	flowerStrokeLog(path, {
		packId: packId ?? null,
		designFontSize: base,
		effectiveFontSize: eff,
		scaleFactor: factor,
		strokeCount: strokes.length,
		strokes,
		allStrokes: strokes,
		shadows,
		note: "Path1: nested shadow.strokes flattened into strokes/allStrokes (top-level kind:stroke often empty).",
	});
}


export function applyFlowerPresetToTextElement({
	params,
	presetId,
}: {
	params: ParamValues;
	presetId: string;
}): FlowerTextElementPatch {
	const preset = getFlowerPackPreset(presetId) || getFlowerPreset(presetId);
	const designFs = preset?.designFontSize ?? 48;
	const designCanvasHeight =
		preset && Number(preset.designCanvasHeight) > 0
			? Number(preset.designCanvasHeight)
			: null;
	let style: FlowerStyle;
	if (preset) {
		// Style authored at designFs; render scales via scaledFontSizeForCanvas + getEffectiveFlowerStyle.
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
	const prevParamFs = readTextParamNumber(params, "fontSize", DEFAULT_PARAM_FONT_SIZE);
	// Keep user's current UI fontSize — pack must not overwrite it (e.g. 80 stays 80).
	// flowerBaseFontSize = designFs so stroke/shadow scale = fontSize/designFs.
	// Never copy pack UIText / scene text into clip content (Assets uses FLOWER_EFFECT_DEFAULT_CONTENT; props keep user's text).
	const nextParams: ParamValues = {
		...params,
		color: fillColor,
		content: readTextParamString(params, "content", FLOWER_EFFECT_DEFAULT_CONTENT),
	};
	const paramFs = readTextParamNumber(nextParams, "fontSize", DEFAULT_PARAM_FONT_SIZE);
	if (isFlowerStrokeDebugEnabled()) {
		const scaleAtApply = designFs > 0 ? paramFs / designFs : 1;
		flowerStrokeLog("apply-preset", {
			path: "apply-preset",
			packId: presetId,
			packName: preset?.name ?? null,
			paramFontSizeBefore: prevParamFs,
			paramFontSize: paramFs,
			designFontSize: designFs,
			designCanvasHeight,
			troikaFontSize: paramFs,
			scaleFactor: scaleAtApply,
			note: "Flower apply keeps params.fontSize; Troika 1:1 with that number. Stroke scale = fontSize/designFs (flowerBaseFontSize).",
		});
		logFlowerStyleStrokes({
			path: "apply-preset",
			packId: presetId,
			style,
			designFontSize: designFs,
			effectiveFontSize: paramFs,
		});
	}
	const packPreset = getFlowerPackPreset(presetId);
	const mediaPlayers =
		packPreset && Array.isArray(packPreset.mediaPlayers) && packPreset.mediaPlayers.length
			? packPreset.mediaPlayers
			: null;
	// Always bind the art-text pack id so textures/… resolve via pack.objectUrls
	// (registerArtTextPackFromZip during catalog load).
	const mediaPackId = packPreset ? presetId : null;
	return {
		params: nextParams,
		flowerStyle: style,
		flowerBaseFontSize: designFs,
		flowerDesignCanvasHeight: designCanvasHeight,
		flowerTemplateId: presetId,
		textTemplateMediaPlayers: mediaPlayers,
		textTemplatePackId: mediaPackId,
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

export type ClearFlowerStyleResult = Pick<
	FlowerTextElementPatch,
	| "flowerStyle"
	| "flowerBaseFontSize"
	| "flowerDesignCanvasHeight"
	| "flowerTemplateId"
	| "textTemplateMediaPlayers"
	| "textTemplatePackId"
> & {
	params?: ParamValues;
};

/**
 * Remove pack flower effect. Converts params.fontSize so plain Troika
 * (param*(canvasH/90)) matches the previous flower 1:1 visual size.
 * Pass wasFlowerSized=true when the clip used flowerBaseFontSize (1:1 mode).
 */
export function clearFlowerStyleFromTextElement({
	params,
	fillColor,
}: {
	params?: ParamValues;
	/** @deprecated ignored — plain text is also 1:1; no convert on clear. */
	canvasHeight?: number;
	/** @deprecated ignored — fontSize is never rewritten on clear. */
	wasFlowerSized?: boolean;
	fillColor?: string;
} = {}): ClearFlowerStyleResult {
	const nextParams: ParamValues | undefined = params
		? { ...params }
		: undefined;
	if (isFlowerStrokeDebugEnabled()) {
		const prevFs = nextParams
			? readTextParamNumber(nextParams, "fontSize", DEFAULT_PARAM_FONT_SIZE)
			: null;
		flowerStrokeLog("clear-flower", {
			path: "clear-flower",
			paramFontSize: prevFs,
			note: "Keep params.fontSize unchanged; plain + flower both Troika 1:1.",
		});
	}
	const color =
		(typeof fillColor === "string" && fillColor) ||
		(nextParams && typeof nextParams.color === "string" && nextParams.color) ||
		"#ffffff";
	return {
		...(nextParams ? { params: nextParams } : {}),
		flowerStyle: createDefaultFlowerStyle({
			fill: {
				alpha: 1,
				content: createSolidContent(color, 1),
			},
		}),
		flowerBaseFontSize: null,
		flowerDesignCanvasHeight: null,
		flowerTemplateId: null,
		textTemplateMediaPlayers: null,
		textTemplatePackId: null,
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
