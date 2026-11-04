/**
 * FreeFilmCut FlowerStyle (花字) = Effect stack on Text (type=text), not a separate node type. CapCut-aligned schema for OpenCut playback.
 * solid / linear gradient / texture; strokes.side = outer | inner.
 * texture.range: CapCut horizontal atlas strips (default 1); char i uses strip i%range.
 * texture.path may be a file URL/path or live RT ref `rt:<RenderTextureObjectUuid>` (MediaFrame GIF/seq/video).
 */

export const FLOWER_STYLE_VERSION = 2;

export type FccRenderType = "solid" | "gradient" | "texture";

export type FccUvMode = "per-char" | "whole-text";

export type FillContent = {
	renderType: FccRenderType;
	/** Plane UV for gradient/texture (and shared stack layers). Default per-char. */
	uvMode: FccUvMode;
	solid: { color: string; alpha: number };
	gradient: {
		style: "linear";
		angle: number;
		colors: [string, string];
		alphas: [number, number];
		stops: [number, number];
		mode?: string;
	};
	texture: {
		path: string;
		fileName?: string;
		alpha: number;
		angle?: number;
		scale?: number;
		/** CapCut horizontal atlas strips; char i samples strip i%range. Default 1. */
		range?: number;
	};
};

export type StrokeSide = "outer" | "inner";

export type StrokeLayer = {
	enable: boolean;
	width: number;
	alpha: number;
	/** outer = under face; inner = inset ring on top of face */
	side: StrokeSide;
	content: FillContent;
};

export type ShadowLayer = {
	enable: boolean;
	angle: number;
	distance: number;
	/** TMP Underlay Dilate — expand shadow silhouette (same units as stroke width). */
	width: number;
	diffuse: number;
	alpha: number;
	offsetX: number;
	offsetY: number;
	content: FillContent;
	/** CapCut nested strokes on this shadow silhouette (投影上挂描边). */
	strokes?: StrokeLayer[];
};

export type FlowerStackKind = "face" | "stroke" | "shadow" | "inner";

export type FlowerStackEntry =
	| { id: string; kind: "face" }
	| ({ id: string; kind: "stroke" } & StrokeLayer)
	| ({ id: string; kind: "shadow" } & ShadowLayer)
	| ({ id: string; kind: "inner" } & ShadowLayer);

export type FlowerStyle = {
	version: number;
	id?: string | null;
	fill: { alpha: number; content: FillContent; visible?: boolean };
	/** Ordered Effect stack (back → front). Canonical for render / reorder. */
	stack: FlowerStackEntry[];
	/** Derived mirrors for older readers. */
	strokes: StrokeLayer[];
	shadows: ShadowLayer[];
	innerShadows: ShadowLayer[];
	anims?: { in?: unknown; out?: unknown; loop?: unknown };
};

let _flowerStackIdSeq = 0;
export function newFlowerStackId(prefix = "fx"): string {
	_flowerStackIdSeq += 1;
	return `${prefix}_${Date.now().toString(36)}_${_flowerStackIdSeq}`;
}

export function createFaceStackEntry(): FlowerStackEntry {
	return { id: "face", kind: "face" };
}

export function migrateBucketsToStack(
	strokes: StrokeLayer[],
	shadows: ShadowLayer[],
	innerShadows: ShadowLayer[],
): FlowerStackEntry[] {
	const stack: FlowerStackEntry[] = [];
	for (const sh of shadows || []) {
		stack.push({ id: newFlowerStackId("sh"), kind: "shadow", ...sh });
	}
	for (const st of strokes || []) {
		if (st.side !== "inner") {
			stack.push({ id: newFlowerStackId("st"), kind: "stroke", ...st });
		}
	}
	stack.push(createFaceStackEntry());
	for (const st of strokes || []) {
		if (st.side === "inner") {
			stack.push({ id: newFlowerStackId("st"), kind: "stroke", ...st });
		}
	}
	for (const sh of innerShadows || []) {
		stack.push({ id: newFlowerStackId("in"), kind: "inner", ...sh });
	}
	return stack;
}

export function deriveBucketsFromStack(stack: FlowerStackEntry[]): {
	strokes: StrokeLayer[];
	shadows: ShadowLayer[];
	innerShadows: ShadowLayer[];
} {
	const strokes: StrokeLayer[] = [];
	const shadows: ShadowLayer[] = [];
	const innerShadows: ShadowLayer[] = [];
	for (const e of stack || []) {
		// Deep-normalize so buckets never share nested stroke arrays with stack
		// (avoids double-scale if a caller mutates both).
		if (e.kind === "stroke") {
			const st = normalizeStroke(e);
			if (st) strokes.push(st);
		} else if (e.kind === "shadow") {
			const sh = normalizeShadow(e);
			if (sh) shadows.push(sh);
		} else if (e.kind === "inner") {
			const sh = normalizeShadow(e);
			if (sh) innerShadows.push(sh);
		}
	}
	return { strokes, shadows, innerShadows };
}

function normalizeStackEntry(raw: unknown): FlowerStackEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const s = raw as Record<string, unknown>;
	if (s.kind === "face") return createFaceStackEntry();
	if (s.kind === "stroke") {
		const st = normalizeStroke(raw);
		if (!st) return null;
		return {
			id: typeof s.id === "string" && s.id ? s.id : newFlowerStackId("st"),
			kind: "stroke",
			...st,
		};
	}
	if (s.kind === "shadow") {
		const sh = normalizeShadow(raw);
		if (!sh) return null;
		return {
			id: typeof s.id === "string" && s.id ? s.id : newFlowerStackId("sh"),
			kind: "shadow",
			...sh,
		};
	}
	if (s.kind === "inner" || s.kind === "innerShadow") {
		const sh = normalizeShadow(raw);
		if (!sh) return null;
		return {
			id: typeof s.id === "string" && s.id ? s.id : newFlowerStackId("in"),
			kind: "inner",
			...sh,
		};
	}
	return null;
}

export function normalizeFlowerStack(
	rawStack: unknown,
	buckets: {
		strokes: StrokeLayer[];
		shadows: ShadowLayer[];
		innerShadows: ShadowLayer[];
	},
): FlowerStackEntry[] {
	let stack = Array.isArray(rawStack)
		? (rawStack.map(normalizeStackEntry).filter(Boolean) as FlowerStackEntry[])
		: [];
	if (!stack.length) {
		stack = migrateBucketsToStack(
			buckets.strokes,
			buckets.shadows,
			buckets.innerShadows,
		);
	}
	const faceCount = stack.filter((e) => e.kind === "face").length;
	if (faceCount === 0) {
		let insertAt = stack.length;
		for (let i = 0; i < stack.length; i++) {
			const e = stack[i];
			if (
				e.kind === "inner" ||
				(e.kind === "stroke" && e.side === "inner")
			) {
				insertAt = i;
				break;
			}
		}
		stack.splice(insertAt, 0, createFaceStackEntry());
	} else if (faceCount > 1) {
		let kept = false;
		stack = stack.filter((e) => {
			if (e.kind !== "face") return true;
			if (kept) return false;
			kept = true;
			return true;
		});
	}
	return stack.map((e) => (e.kind === "face" ? createFaceStackEntry() : e));
}

function clamp01(v: unknown): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return 1;
	return Math.max(0, Math.min(1, n));
}

export function normalizeHex(hex: unknown, fallback = "#ffffff"): string {
	if (typeof hex === "string") {
		let h = hex.trim();
		if (/^#[0-9a-fA-F]{3}$/.test(h)) {
			h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
		}
		if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
		if (/^[0-9a-fA-F]{6}$/.test(h)) return ("#" + h).toLowerCase();
	}
	if (Array.isArray(hex) && hex.length >= 3) {
		const r = Math.round(clamp01(hex[0]) * 255);
		const g = Math.round(clamp01(hex[1]) * 255);
		const b = Math.round(clamp01(hex[2]) * 255);
		return (
			"#" +
			[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
		);
	}
	return fallback;
}

export function hexToRgb01(hex: string): [number, number, number] {
	const h = normalizeHex(hex).slice(1);
	return [
		parseInt(h.slice(0, 2), 16) / 255,
		parseInt(h.slice(2, 4), 16) / 255,
		parseInt(h.slice(4, 6), 16) / 255,
	];
}

function defaultGradient(): FillContent["gradient"] {
	return {
		style: "linear",
		angle: 90,
		colors: ["#ffffff", "#afafaf"],
		alphas: [1, 1],
		stops: [0, 1],
		mode: "character",
	};
}


export function normalizeUvMode(raw: unknown, legacyGradientMode?: unknown): FccUvMode {
	const n = raw != null ? String(raw).toLowerCase().replace(/_/g, "-").trim() : "";
	if (
		n === "per-char" ||
		n === "perchar" ||
		n === "char" ||
		n === "character" ||
		n === "glyph"
	) {
		return "per-char";
	}
	if (
		n === "whole-text" ||
		n === "wholetext" ||
		n === "whole" ||
		n === "text" ||
		n === "block"
	) {
		return "whole-text";
	}
	const gm =
		legacyGradientMode != null
			? String(legacyGradientMode).toLowerCase().replace(/_/g, "-").trim()
			: "";
	if (gm === "text" || gm === "whole" || gm === "whole-text" || gm === "block") {
		return "whole-text";
	}
	if (gm === "character" || gm === "char" || gm === "per-char" || gm === "glyph") {
		return "per-char";
	}
	return "per-char";
}

export function uvModeToGradientMode(uvMode: unknown): string {
	return normalizeUvMode(uvMode) === "whole-text" ? "text" : "character";
}

export function uvModeToPerCharUniform(uvMode: unknown): number {
	return normalizeUvMode(uvMode) === "whole-text" ? 0 : 1;
}

export function createSolidContent(
	color = "#ffffff",
	alpha = 1,
	opts: { uvMode?: FccUvMode | string } = {},
): FillContent {
	const uvMode = normalizeUvMode(opts.uvMode);
	const g = defaultGradient();
	g.mode = uvModeToGradientMode(uvMode);
	return {
		renderType: "solid",
		uvMode,
		solid: { color: normalizeHex(color), alpha: clamp01(alpha) },
		gradient: g,
		texture: { path: "", fileName: "", alpha: 1, angle: 0, scale: 1, range: 1 },
	};
}

export function normalizeFillContent(raw: unknown): FillContent {
	const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	let renderType = String(src.renderType || src.render_type || "solid");
	if (renderType !== "solid" && renderType !== "gradient" && renderType !== "texture") {
		renderType = "solid";
	}
	const solidSrc = (src.solid && typeof src.solid === "object" ? src.solid : {}) as Record<string, unknown>;
	const gradSrc = (src.gradient && typeof src.gradient === "object" ? src.gradient : {}) as Record<string, unknown>;
	const texSrc = (src.texture && typeof src.texture === "object" ? src.texture : {}) as Record<string, unknown>;

	let gColors: [string, string] = ["#ffffff", "#afafaf"];
	const colors = gradSrc.colors ?? gradSrc.color;
	if (Array.isArray(colors) && colors.length >= 2) {
		gColors = [normalizeHex(colors[0]), normalizeHex(colors[1], "#afafaf")];
	}
	const gAlphas: [number, number] = Array.isArray(gradSrc.alpha) && gradSrc.alpha.length >= 2
		? [clamp01(gradSrc.alpha[0]), clamp01(gradSrc.alpha[1])]
		: Array.isArray(gradSrc.alphas) && (gradSrc.alphas as unknown[]).length >= 2
			? [clamp01((gradSrc.alphas as unknown[])[0]), clamp01((gradSrc.alphas as unknown[])[1])]
			: [1, 1];
	const gStops: [number, number] = Array.isArray(gradSrc.percent) && gradSrc.percent.length >= 2
		? [Number(gradSrc.percent[0]) || 0, Number(gradSrc.percent[1]) || 1]
		: Array.isArray(gradSrc.stops) && (gradSrc.stops as unknown[]).length >= 2
			? [Number((gradSrc.stops as unknown[])[0]) || 0, Number((gradSrc.stops as unknown[])[1]) || 1]
			: [0, 1];

	const uvMode = normalizeUvMode(
		(src as { uvMode?: unknown; uv_mode?: unknown }).uvMode ??
			(src as { uv_mode?: unknown }).uv_mode,
		gradSrc.mode,
	);
	return {
		renderType: renderType as FccRenderType,
		uvMode,
		solid: {
			color: normalizeHex(solidSrc.color),
			alpha: solidSrc.alpha != null ? clamp01(solidSrc.alpha) : 1,
		},
		gradient: {
			style: "linear",
			angle: gradSrc.angle != null ? Number(gradSrc.angle) : 90,
			colors: gColors,
			alphas: gAlphas,
			stops: gStops,
			mode:
				gradSrc.mode != null
					? String(gradSrc.mode)
					: uvModeToGradientMode(uvMode),
		},
		texture: {
			path: String(texSrc.path || ""),
			fileName: String(texSrc.fileName || texSrc.name || ""),
			alpha: texSrc.alpha != null ? clamp01(texSrc.alpha) : 1,
			angle: texSrc.angle != null ? Number(texSrc.angle) : 0,
			scale: texSrc.scale != null ? Number(texSrc.scale) : 1,
			range: normalizeTexRange(texSrc.range),
		},
	};
}

function normalizeStroke(raw: unknown): StrokeLayer | null {
	if (!raw || typeof raw !== "object") return null;
	const s = raw as Record<string, unknown>;
	let side: StrokeSide = "outer";
	if (s.side === "inner" || s.side === "outer") side = s.side;
	else if (s.mode === 1 || s.mode === "inner" || s.inset === true) side = "inner";
	return {
		enable: s.enable !== false && s.enabled !== false,
		width: Math.max(0, Number(s.width) || 0),
		alpha: s.alpha != null ? clamp01(s.alpha) : 1,
		side,
		content: normalizeFillContent(s.content),
	};
}

function normalizeShadow(raw: unknown): ShadowLayer | null {
	if (!raw || typeof raw !== "object") return null;
	const s = raw as Record<string, unknown>;
	const angle = s.angle != null ? Number(s.angle) : -45;
	const distance = Math.max(0, Number(s.distance) || 0);
	const rad = (angle * Math.PI) / 180;
	const ox = s.offsetX != null ? Number(s.offsetX) : Math.cos(rad) * distance;
	const oy = s.offsetY != null ? Number(s.offsetY) : Math.sin(rad) * distance;
	const widthRaw = s.width != null ? s.width : s.dilate;
	const nestedStrokes = Array.isArray(s.strokes)
		? (s.strokes.map(normalizeStroke).filter(Boolean) as StrokeLayer[])
		: [];
	return {
		enable: s.enable !== false && s.enabled !== false,
		angle,
		distance,
		width: Math.max(0, Number(widthRaw) || 0),
		diffuse: Math.max(0, Number(s.diffuse != null ? s.diffuse : s.blur) || 0),
		alpha: s.alpha != null ? clamp01(s.alpha) : 1,
		offsetX: ox,
		offsetY: oy,
		content: normalizeFillContent(s.content),
		strokes: nestedStrokes,
	};
}

export function normalizeFlowerStyle(raw: unknown): FlowerStyle {
	const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const fillSrc = src.fill && typeof src.fill === "object" ? (src.fill as Record<string, unknown>) : {};
	const bucketStrokes = Array.isArray(src.strokes)
		? (src.strokes.map(normalizeStroke).filter(Boolean) as StrokeLayer[])
		: [];
	const bucketShadows = Array.isArray(src.shadows)
		? (src.shadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
		: Array.isArray(src.outerShadows)
			? (src.outerShadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
			: [];
	const bucketInners = Array.isArray(src.innerShadows)
		? (src.innerShadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
		: Array.isArray(src.inner_shadows)
			? (src.inner_shadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
			: [];
	const stack = normalizeFlowerStack(src.stack, {
		strokes: bucketStrokes,
		shadows: bucketShadows,
		innerShadows: bucketInners,
	});
	const derived = deriveBucketsFromStack(stack);
	return {
		version: Math.max(Number(src.version) || 0, 2),
		id: (src.id as string | null | undefined) ?? null,
		fill: {
			alpha: fillSrc.alpha != null ? clamp01(fillSrc.alpha) : 1,
			content: normalizeFillContent(fillSrc.content),
			/** false = hide face pass (inspect strokes/shadows). Default true. */
			visible: fillSrc.visible !== false,
		},
		stack,
		strokes: derived.strokes,
		shadows: derived.shadows,
		innerShadows: derived.innerShadows,
		anims: {
			in: (src.anims as { in?: unknown } | undefined)?.in ?? null,
			out: (src.anims as { out?: unknown } | undefined)?.out ?? null,
			loop: (src.anims as { loop?: unknown } | undefined)?.loop ?? null,
		},
	};
}

export function flowerStyleFromLegacy(ui: {
	color?: string;
	outline?: { enabled?: boolean; width?: number; color?: string; opacity?: number };
	shadow?: {
		enabled?: boolean;
		offsetX?: number;
		offsetY?: number;
		blur?: number;
		color?: string;
		opacity?: number;
	};
}): FlowerStyle {
	const strokes: StrokeLayer[] = [];
	const shadows: ShadowLayer[] = [];
	const ol = ui.outline || {};
	if (ol.enabled) {
		strokes.push({
			enable: true,
			side: "outer",
			width: Number(ol.width) || 2,
			alpha: ol.opacity != null ? clamp01(ol.opacity) : 1,
			content: createSolidContent(ol.color || "#000000", 1),
		});
	}
	const sh = ui.shadow || {};
	if (sh.enabled) {
		const ox = Number(sh.offsetX) || 0;
		const oy = Number(sh.offsetY) || 0;
		const dist = Math.sqrt(ox * ox + oy * oy);
		let angle = -45;
		if (dist > 1e-4) angle = (Math.atan2(oy, ox) * 180) / Math.PI;
		shadows.push({
			enable: true,
			angle,
			distance: dist || 4,
			width: 0,
			diffuse: Number(sh.blur) || 0,
			alpha: sh.opacity != null ? clamp01(sh.opacity) : 0.75,
			offsetX: ox,
			offsetY: oy,
			content: createSolidContent(sh.color || "#000000", 1),
		});
	}
	return normalizeFlowerStyle({
		fill: { alpha: 1, content: createSolidContent(ui.color || "#ffffff", 1) },
		strokes,
		shadows,
		innerShadows: [],
	});
}

function scaleStrokeLinearMeasures(st: any, factor: number) {
	if (!st || typeof st !== "object") return;
	const f = Number(factor);
	if (!(f > 0) || Math.abs(f - 1) < 1e-12) return;
	if (st.width != null) st.width = Math.max(0, (Number(st.width) || 0) * f);
}

function scaleShadowLinearMeasures(sh: any, factor: number) {
	if (!sh || typeof sh !== "object") return;
	const f = Number(factor);
	if (!(f > 0) || Math.abs(f - 1) < 1e-12) return;
	if (sh.distance != null) sh.distance = Math.max(0, (Number(sh.distance) || 0) * f);
	if (sh.width != null) sh.width = Math.max(0, (Number(sh.width) || 0) * f);
	if (sh.diffuse != null) sh.diffuse = Math.max(0, (Number(sh.diffuse) || 0) * f);
	if (sh.blur != null) sh.blur = Math.max(0, (Number(sh.blur) || 0) * f);
	if (sh.offsetX != null) sh.offsetX = (Number(sh.offsetX) || 0) * f;
	if (sh.offsetY != null) sh.offsetY = (Number(sh.offsetY) || 0) * f;
	if (Array.isArray(sh.strokes)) {
		for (let i = 0; i < sh.strokes.length; i++) scaleStrokeLinearMeasures(sh.strokes[i], f);
	}
}

/** Multiply font-relative px on a FlowerStyle by factor (colors/alphas untouched). */
export function rescaleFlowerStyleByFactor(style: unknown, factor: number): FlowerStyle {
	const f = Number(factor);
	const out = normalizeFlowerStyle(JSON.parse(JSON.stringify(style || {})));
	if (!(f > 0) || Math.abs(f - 1) < 1e-12) return out;
	// Scale ONLY the canonical stack. deriveBucketsFromStack uses shallow spreads, so
	// also scaling out.shadows would double-scale Path1 nested strokes (flowertext1
	// white edge lives on shadow.strokes) — stroke/fontSize would drift high.
	if (Array.isArray((out as any).stack)) {
		for (const e of (out as any).stack) {
			if (!e || typeof e !== "object") continue;
			if (e.kind === "stroke") scaleStrokeLinearMeasures(e, f);
			else if (e.kind === "shadow" || e.kind === "inner" || e.kind === "innerShadow") {
				scaleShadowLinearMeasures(e, f);
			}
		}
	}
	// Re-derive strokes/shadows buckets from the scaled stack (no second multiply).
	return normalizeFlowerStyle(out);
}

/** Rescale FlowerStyle linear measures from one fontSize to another. */
export function rescaleFlowerStyleForFontSize(
	style: unknown,
	fromFs: number,
	toFs: number,
): FlowerStyle {
	const from = Number(fromFs) > 0 ? Number(fromFs) : 0;
	const to = Number(toFs) > 0 ? Number(toFs) : 0;
	if (!from || !to) return normalizeFlowerStyle(style);
	return rescaleFlowerStyleByFactor(style, to / from);
}

export function getEffectiveFlowerStyle(ui: {
	color?: string;
	fontSize?: number;
	flowerBaseFontSize?: number;
	outline?: {
		enabled?: boolean;
		width?: number;
		color?: string;
		opacity?: number;
	};
	shadow?: {
		enabled?: boolean;
		offsetX?: number;
		offsetY?: number;
		blur?: number;
		color?: string;
		opacity?: number;
	};
	flowerStyle?: unknown;
}): FlowerStyle {
	let style: FlowerStyle;
	if (ui.flowerStyle && typeof ui.flowerStyle === "object") {
		style = normalizeFlowerStyle(ui.flowerStyle);
	} else {
		style = flowerStyleFromLegacy(ui);
	}
	const base = Number(ui.flowerBaseFontSize) > 0 ? Number(ui.flowerBaseFontSize) : 0;
	const fs = Number(ui.fontSize) > 0 ? Number(ui.fontSize) : 48;
	if (base > 0 && Math.abs(fs - base) > 1e-6) {
		return rescaleFlowerStyleForFontSize(style, base, fs);
	}
	return style;
}

export function contentPrimaryColor(content: FillContent): string {
	const c = normalizeFillContent(content);
	if (c.renderType === "gradient") return c.gradient.colors[0];
	return c.solid.color;
}

export function contentUsesGradient(content: FillContent): boolean {
	return normalizeFillContent(content).renderType === "gradient";
}


/** Public URL prefix for built-in flower textures in OpenCut (Next.js public/). */
export const FLOWER_PUBLIC_ASSET_PREFIX = "/flower";

export function flowerPublicUrl(assetDirRel: string, fileName: string): string {
	const dir = String(assetDirRel || "").replace(/^\/+/, "").replace(/\/+$/, "");
	const file = String(fileName || "").replace(/^\/+/, "");
	const parts = [FLOWER_PUBLIC_ASSET_PREFIX.replace(/^\/+/, ""), dir, file].filter(Boolean);
	return "/" + parts.join("/");
}

function normalizeTexRange(v: unknown): number {
	const n = Math.floor(Number(v));
	if (!Number.isFinite(n) || n < 1) return 1;
	return n;
}

function defaultTextureStub(): FillContent["texture"] {
	return { path: "", fileName: "", alpha: 1, angle: 0, scale: 1, range: 1 };
}

export function createGradientContent(opts: {
	colors?: [string, string] | string[];
	alphas?: [number, number] | number[];
	stops?: [number, number] | number[];
	angle?: number;
	mode?: string;
	uvMode?: FccUvMode | string;
} = {}): FillContent {
	const colors: [string, string] =
		Array.isArray(opts.colors) && opts.colors.length >= 2
			? [normalizeHex(opts.colors[0]), normalizeHex(opts.colors[1])]
			: ["#ffffff", "#afafaf"];
	const alphas: [number, number] =
		Array.isArray(opts.alphas) && opts.alphas.length >= 2
			? [clamp01(opts.alphas[0]), clamp01(opts.alphas[1])]
			: [1, 1];
	const stops: [number, number] =
		Array.isArray(opts.stops) && opts.stops.length >= 2
			? [Number(opts.stops[0]) || 0, Number(opts.stops[1]) || 1]
			: [0, 1];
	const uvMode = normalizeUvMode(opts.uvMode, opts.mode);
	return {
		renderType: "gradient",
		uvMode,
		solid: { color: colors[0], alpha: alphas[0] },
		gradient: {
			style: "linear",
			angle: opts.angle != null ? Number(opts.angle) : 90,
			colors,
			alphas,
			stops,
			mode: opts.mode != null ? String(opts.mode) : uvModeToGradientMode(uvMode),
		},
		texture: defaultTextureStub(),
	};
}

export function createTextureContent(opts: {
	path?: string;
	fileName?: string;
	name?: string;
	fallbackColor?: string;
	alpha?: number;
	angle?: number;
	scale?: number;
	range?: number;
	uvMode?: FccUvMode | string;
} = {}): FillContent {
	const uvMode = normalizeUvMode(opts.uvMode);
	const g = defaultGradient();
	g.mode = uvModeToGradientMode(uvMode);
	return {
		renderType: "texture",
		uvMode,
		solid: { color: normalizeHex(opts.fallbackColor || "#ffffff"), alpha: 1 },
		gradient: g,
		texture: {
			...defaultTextureStub(),
			path: opts.path || "",
			fileName: opts.fileName || opts.name || "",
			alpha: opts.alpha != null ? clamp01(opts.alpha) : 1,
			angle: opts.angle != null ? Number(opts.angle) : 0,
			scale: opts.scale != null ? Number(opts.scale) : 1,
			range: normalizeTexRange(opts.range),
		},
	};
}

export function createStrokeLayer(
	overrides: Partial<StrokeLayer> & { content?: FillContent } = {},
): StrokeLayer {
	return (
		normalizeStroke({
			enable: true,
			width: 4,
			alpha: 1,
			side: "outer",
			content: createSolidContent("#000000", 1),
			...overrides,
		}) || {
			enable: true,
			width: 4,
			alpha: 1,
			side: "outer",
			content: createSolidContent("#000000", 1),
		}
	);
}

export function createInnerStrokeLayer(
	overrides: Partial<StrokeLayer> & { content?: FillContent } = {},
): StrokeLayer {
	return createStrokeLayer({
		side: "inner",
		width: 3,
		content: createSolidContent("#ffffff", 1),
		...overrides,
	});
}

export function createShadowLayer(
	overrides: Partial<ShadowLayer> & { content?: FillContent; strokes?: StrokeLayer[] } = {},
): ShadowLayer {
	return (
		normalizeShadow({
			enable: true,
			angle: -45,
			distance: 4,
			width: 0,
			diffuse: 2,
			alpha: 0.75,
			content: createSolidContent("#000000", 1),
			strokes: [],
			...overrides,
		}) || {
			enable: true,
			angle: -45,
			distance: 4,
			width: 0,
			diffuse: 2,
			alpha: 0.75,
			offsetX: 0,
			offsetY: 0,
			content: createSolidContent("#000000", 1),
			strokes: [],
		}
	);
}

/** Empty / identity flower style (solid fill, no FX). */
export function createDefaultFlowerStyle(
	overrides: Record<string, unknown> = {},
): FlowerStyle {
	return normalizeFlowerStyle({
		version: FLOWER_STYLE_VERSION,
		id: null,
		fill: { alpha: 1, content: createSolidContent("#ffffff", 1) },
		stack: [createFaceStackEntry()],
		strokes: [],
		shadows: [],
		innerShadows: [],
		anims: { in: null, out: null, loop: null },
		...overrides,
	});
}

function ensureStyleWithFill(
	style: unknown,
	fillColor: string,
): FlowerStyle {
	if (style) return normalizeFlowerStyle(style);
	return createDefaultFlowerStyle({
		fill: { alpha: 1, content: createSolidContent(fillColor, 1) },
	});
}

/** First outer stroke on a Default-text flowerStyle (or null). */
export function getDefaultTextOuterStroke(
	style: unknown,
): StrokeLayer | null {
	const s = style ? normalizeFlowerStyle(style) : null;
	if (!s) return null;
	return (
		s.strokes.find((st) => st.side !== "inner" && st.enable) ??
		s.strokes.find((st) => st.side !== "inner") ??
		null
	);
}

/** First outer shadow on a Default-text flowerStyle (or null). */
export function getDefaultTextOuterShadow(
	style: unknown,
): ShadowLayer | null {
	const s = style ? normalizeFlowerStyle(style) : null;
	if (!s) return null;
	return s.shadows.find((sh) => sh.enable) ?? s.shadows[0] ?? null;
}

/**
 * Replace Default-text outer stroke (at most one). Keeps existing outer shadows.
 * Pass `enable: false` to clear stroke.
 */
export function setDefaultTextOuterStroke(
	style: unknown,
	next: { enable: boolean; width: number; color: string },
	opts: { fillColor?: string } = {},
): FlowerStyle {
	const fillColor = opts.fillColor ?? "#ffffff";
	const base = ensureStyleWithFill(style, fillColor);
	const strokes = next.enable
		? [
				createStrokeLayer({
					enable: true,
					width: Math.max(0, Number(next.width) || 0),
					side: "outer",
					alpha: 1,
					content: createSolidContent(normalizeHex(next.color, "#000000"), 1),
				}),
			]
		: [];
	return normalizeFlowerStyle({
		version: base.version,
		id: base.id,
		fill: base.fill,
		stack: [],
		strokes,
		shadows: base.shadows,
		innerShadows: [],
		anims: base.anims,
	});
}

/**
 * Replace Default-text outer shadow (at most one). Keeps existing outer strokes.
 * Pass `enable: false` to clear shadow.
 */
export function setDefaultTextOuterShadow(
	style: unknown,
	next: {
		enable: boolean;
		distance: number;
		angle: number;
		diffuse: number;
		color: string;
		alpha: number;
	},
	opts: { fillColor?: string } = {},
): FlowerStyle {
	const fillColor = opts.fillColor ?? "#ffffff";
	const base = ensureStyleWithFill(style, fillColor);
	const shadows = next.enable
		? [
				createShadowLayer({
					enable: true,
					distance: Math.max(0, Number(next.distance) || 0),
					angle: Number(next.angle) || 0,
					diffuse: Math.max(0, Number(next.diffuse) || 0),
					width: 0,
					alpha: clamp01(next.alpha),
					content: createSolidContent(normalizeHex(next.color, "#000000"), 1),
					strokes: [],
				}),
			]
		: [];
	const strokes = base.strokes.filter((st) => st.side !== "inner");
	return normalizeFlowerStyle({
		version: base.version,
		id: base.id,
		fill: base.fill,
		stack: [],
		strokes,
		shadows,
		innerShadows: [],
		anims: base.anims,
	});
}

export function cloneFlowerStyle(style: unknown): FlowerStyle {
	try {
		return normalizeFlowerStyle(JSON.parse(JSON.stringify(style || {})));
	} catch {
		return normalizeFlowerStyle(style);
	}
}

export function serializeFlowerStyle(style: unknown): FlowerStyle {
	return cloneFlowerStyle(style);
}

export function shadowOffsetPx(layer: {
	offsetX?: number;
	offsetY?: number;
	angle?: number;
	distance?: number;
}): { x: number; y: number } {
	if (layer.offsetX != null || layer.offsetY != null) {
		return { x: Number(layer.offsetX) || 0, y: Number(layer.offsetY) || 0 };
	}
	const angle = layer.angle != null ? Number(layer.angle) : -45;
	const distance = Math.max(0, Number(layer.distance) || 0);
	const rad = (angle * Math.PI) / 180;
	return { x: Math.cos(rad) * distance, y: Math.sin(rad) * distance };
}

/** CapCut artistEffect pack id 7645318555541638462 (花字库). */
export const JIANYING_7645_PACK_ID = "7645318555541638462";
/** Relative dir under public/flower and editor assets/flower. */
export const JIANYING_7645_ASSET_DIR = "7645";

/** CapCut stroke width is ~em fraction → Troika outlineWidth in world units. */
export function capcutStrokeWidthToFcc(width: number, fontSize = 48): number {
	const fs = Number(fontSize) > 0 ? Number(fontSize) : 48;
	return Math.max(0, Number(width) || 0) * fs;
}

/** CapCut diffuse is small relative → Troika outlineBlur. */
export function capcutDiffuseToFcc(diffuse: number, fontSize = 48): number {
	const fs = Number(fontSize) > 0 ? Number(fontSize) : 48;
	return Math.max(0, Number(diffuse) || 0) * fs;
}

/**
 * CapCut shadow distance looks absolute at design size (~fontSize 48);
 * scale linearly with current fontSize.
 */
export function capcutDistanceToFcc(distance: number, fontSize = 48): number {
	const fs = Number(fontSize) > 0 ? Number(fontSize) : 48;
	return Math.max(0, Number(distance) || 0) * (fs / 48);
}

function jy7645Tex(
	fileName: string,
	opts: { fallbackColor?: string; alpha?: number; angle?: number; scale?: number } = {},
): FillContent {
	const path = flowerPublicUrl(JIANYING_7645_ASSET_DIR, fileName);
	return createTextureContent({
		path,
		fileName,
		fallbackColor: opts.fallbackColor || "#ffffff",
		alpha: opts.alpha != null ? opts.alpha : 1,
		angle: opts.angle != null ? opts.angle : 0,
		scale: opts.scale != null ? opts.scale : 1,
	});
}

/**
 * Build FlowerStyle approximating CapCut pack 7645318555541638462.
 * CapCut nests strokes under shadows (投影上挂描边). Path1 keeps that nesting.
 */
export function createJianying7645FlowerStyle(fontSize = 48): FlowerStyle {
	const fs = Number(fontSize) > 0 ? Number(fontSize) : 48;
	const fill = { alpha: 1, content: createSolidContent("#ffffff", 1) };
	const shadows = [
		createShadowLayer({
			enable: true,
			angle: -89.99,
			distance: capcutDistanceToFcc(4.548161120840636, fs),
			diffuse: capcutDiffuseToFcc(0.059836544074722706, fs),
			alpha: 0.9,
			content: createSolidContent("#fb9ffb", 1),
			strokes: [],
		}),
		createShadowLayer({
			enable: true,
			angle: -89.99,
			distance: capcutDistanceToFcc(2.446584938704033, fs),
			diffuse: 0,
			alpha: 0,
			content: createSolidContent("#000000", 1),
			strokes: [
				createStrokeLayer({
					enable: true,
					side: "outer",
					width: capcutStrokeWidthToFcc(0.14500875656742557, fs),
					alpha: 1,
					content: createSolidContent("#ffffff", 1),
				}),
			],
		}),
		createShadowLayer({
			enable: true,
			angle: -89.99,
			distance: capcutDistanceToFcc(2.9772329246935203, fs),
			diffuse: 0,
			alpha: 0,
			content: createSolidContent("#000000", 1),
			strokes: [
				createStrokeLayer({
					enable: true,
					side: "outer",
					width: capcutStrokeWidthToFcc(0.12, fs),
					alpha: 1,
					content: createSolidContent("#024479", 1),
				}),
			],
		}),
		createShadowLayer({
			enable: true,
			angle: -45,
			distance: 0,
			diffuse: 0,
			alpha: 1,
			content: jy7645Tex("1780131613632.png", {
				fallbackColor: "#d94895",
				angle: 0,
				scale: 1,
			}),
			strokes: [
				createStrokeLayer({
					enable: true,
					side: "outer",
					width: capcutStrokeWidthToFcc(0.0574430823117338, fs),
					alpha: 1,
					content: jy7645Tex("1780131613632.png", {
						fallbackColor: "#d94895",
						angle: 9,
						scale: 1,
					}),
				}),
				createStrokeLayer({
					enable: true,
					side: "outer",
					width: capcutStrokeWidthToFcc(0.102276707530648, fs),
					alpha: 1,
					content: jy7645Tex("1780131838447.png", {
						fallbackColor: "#472fd3",
						angle: 0,
						scale: 1,
					}),
				}),
			],
		}),
		createShadowLayer({
			enable: true,
			angle: -45,
			distance: 0,
			diffuse: capcutDiffuseToFcc(0.005545826036193811, fs),
			alpha: 0.8861646234676007,
			content: createGradientContent({
				colors: ["#a018a0", "#1c000b"],
				alphas: [1, 1],
				stops: [0.4668141592920354, 0.7411504424778761],
				angle: 90,
			}),
			strokes: [],
		}),
	];
	const innerShadows = [
		createShadowLayer({
			enable: true,
			angle: -45,
			distance: capcutDistanceToFcc(5.0, fs),
			diffuse: capcutDiffuseToFcc(0.025, fs),
			alpha: 0.9,
			content: jy7645Tex("1780131462621.png", {
				fallbackColor: "#fdd3ef",
				angle: 0,
				scale: 1.3,
			}),
			strokes: [],
		}),
	];
	return normalizeFlowerStyle({
		version: FLOWER_STYLE_VERSION,
		id: JIANYING_7645_PACK_ID,
		fill,
		strokes: [],
		shadows,
		innerShadows,
		anims: { in: null, out: null, loop: null },
	});
}

export type FlowerPresetDef = {
	id: string;
	name: string;
	cover: string;
	/** Design fontSize the create() measures are authored for (editor uses 48). */
	designFontSize: number;
	/**
	 * Editor pack canvas height (scene.resolution.height) when known.
	 * Used for layout/logging; apply does not remap params.fontSize from this.
	 * Stroke scale uses flowerBaseFontSize (= designFontSize) vs current UI fontSize.
	 */
	designCanvasHeight?: number;
	create: (fontSize?: number) => FlowerStyle;
};

/** Named presets for Text library / apply-to-clip. */
export const FLOWER_PRESETS: FlowerPresetDef[] = [
	{
		id: JIANYING_7645_PACK_ID,
		name: "Sample",
		cover: flowerPublicUrl(JIANYING_7645_ASSET_DIR, "cover_icon.png"),
		designFontSize: 48,
		create: createJianying7645FlowerStyle,
	},
];

export function getFlowerPreset(id: string | null | undefined): FlowerPresetDef | null {
	if (!id) return null;
	return FLOWER_PRESETS.find((p) => p.id === id) || null;
}

/** Collect texture path URLs used by a FlowerStyle (for prefetch). */
export function collectFlowerTexturePaths(style: unknown): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const addContent = (content: unknown) => {
		const c = normalizeFillContent(content);
		if (c.renderType === "texture" && c.texture?.path) {
			const p = c.texture.path;
			if (!seen.has(p)) {
				seen.add(p);
				out.push(p);
			}
		}
	};
	const s = normalizeFlowerStyle(style);
	addContent(s.fill?.content);
	for (const st of s.strokes || []) addContent(st.content);
	for (const sh of s.shadows || []) {
		addContent(sh.content);
		for (const n of sh.strokes || []) addContent(n.content);
	}
	for (const sh of s.innerShadows || []) {
		addContent(sh.content);
		for (const n of sh.strokes || []) addContent(n.content);
	}
	if (Array.isArray(s.stack)) {
		for (const e of s.stack) {
			if (!e || typeof e !== "object") continue;
			if ("content" in e) addContent((e as { content?: unknown }).content);
			if ("strokes" in e && Array.isArray((e as { strokes?: unknown[] }).strokes)) {
				for (const n of (e as { strokes: { content?: unknown }[] }).strokes) {
					addContent(n?.content);
				}
			}
		}
	}
	return out;
}

/**
 * Remap editor-relative texture paths (assets/flower/7645/...) to OpenCut public URLs.
 * Idempotent for already-public / absolute URLs.
 */
export function remapFlowerStyleTexturePathsForOpenCut(style: unknown): FlowerStyle {
	const s = cloneFlowerStyle(style);
	const rewrite = (content: FillContent): FillContent => {
		const c = normalizeFillContent(content);
		if (c.renderType !== "texture" || !c.texture.path) return c;
		let p = c.texture.path;
		if (
			p.startsWith("http") ||
			p.startsWith("blob:") ||
			p.startsWith("data:") ||
			p.startsWith("/") ||
			p.startsWith("rt:")
		) {
			return c;
		}
		// assets/flower/7645/x.png → /flower/7645/x.png
		const m = p.replace(/\\/g, "/").match(/(?:assets\/)?flower\/([^/]+)\/(.+)$/i);
		if (m) {
			p = flowerPublicUrl(m[1], m[2]);
		} else if (p.includes("7645")) {
			const file = p.split("/").pop() || p;
			p = flowerPublicUrl(JIANYING_7645_ASSET_DIR, file);
		}
		return { ...c, texture: { ...c.texture, path: p } };
	};
	const walkLayer = <T extends { content: FillContent; strokes?: StrokeLayer[] }>(layer: T): T => {
		const next = { ...layer, content: rewrite(layer.content) };
		if (Array.isArray(layer.strokes)) {
			next.strokes = layer.strokes.map((st) => ({
				...st,
				content: rewrite(st.content),
			}));
		}
		return next;
	};
	s.fill = { ...s.fill, content: rewrite(s.fill.content) };
	s.strokes = (s.strokes || []).map((st) => ({ ...st, content: rewrite(st.content) }));
	s.shadows = (s.shadows || []).map((sh) => walkLayer(sh));
	s.innerShadows = (s.innerShadows || []).map((sh) => walkLayer(sh));
	if (Array.isArray(s.stack)) {
		s.stack = s.stack.map((e) => {
			if (!e || e.kind === "face") return e;
			if (e.kind === "stroke") return { ...e, content: rewrite(e.content) };
			return walkLayer(e as typeof e & { content: FillContent });
		}) as FlowerStyle["stack"];
	}
	return normalizeFlowerStyle(s);
}
