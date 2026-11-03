# -*- coding: utf-8 -*-
from pathlib import Path

flower_ts = r'''/**
 * FreeFilmCut FlowerStyle (花字) — CapCut-aligned schema for OpenCut playback.
 * P1: solid + linear gradient; texture is schema stub (solid fallback).
 */

export type FccRenderType = "solid" | "gradient" | "texture";

export type FillContent = {
	renderType: FccRenderType;
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
		alpha: number;
		angle?: number;
		scale?: number;
	};
};

export type StrokeLayer = {
	enable: boolean;
	width: number;
	alpha: number;
	content: FillContent;
};

export type ShadowLayer = {
	enable: boolean;
	angle: number;
	distance: number;
	diffuse: number;
	alpha: number;
	offsetX: number;
	offsetY: number;
	content: FillContent;
};

export type FlowerStyle = {
	version: number;
	id?: string | null;
	fill: { alpha: number; content: FillContent };
	strokes: StrokeLayer[];
	shadows: ShadowLayer[];
	innerShadows: ShadowLayer[];
	anims?: { in?: unknown; out?: unknown; loop?: unknown };
};

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

export function createSolidContent(color = "#ffffff", alpha = 1): FillContent {
	return {
		renderType: "solid",
		solid: { color: normalizeHex(color), alpha: clamp01(alpha) },
		gradient: defaultGradient(),
		texture: { path: "", alpha: 1 },
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

	return {
		renderType: renderType as FccRenderType,
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
			mode: String(gradSrc.mode || "character"),
		},
		texture: {
			path: String(texSrc.path || ""),
			alpha: texSrc.alpha != null ? clamp01(texSrc.alpha) : 1,
			angle: texSrc.angle != null ? Number(texSrc.angle) : 0,
			scale: texSrc.scale != null ? Number(texSrc.scale) : 1,
		},
	};
}

function normalizeStroke(raw: unknown): StrokeLayer | null {
	if (!raw || typeof raw !== "object") return null;
	const s = raw as Record<string, unknown>;
	return {
		enable: s.enable !== false && s.enabled !== false,
		width: Math.max(0, Number(s.width) || 0),
		alpha: s.alpha != null ? clamp01(s.alpha) : 1,
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
	return {
		enable: s.enable !== false && s.enabled !== false,
		angle,
		distance,
		diffuse: Math.max(0, Number(s.diffuse != null ? s.diffuse : s.blur) || 0),
		alpha: s.alpha != null ? clamp01(s.alpha) : 1,
		offsetX: ox,
		offsetY: oy,
		content: normalizeFillContent(s.content),
	};
}

export function normalizeFlowerStyle(raw: unknown): FlowerStyle {
	const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const fillSrc = src.fill && typeof src.fill === "object" ? (src.fill as Record<string, unknown>) : {};
	return {
		version: Number(src.version) || 1,
		id: (src.id as string | null | undefined) ?? null,
		fill: {
			alpha: fillSrc.alpha != null ? clamp01(fillSrc.alpha) : 1,
			content: normalizeFillContent(fillSrc.content),
		},
		strokes: Array.isArray(src.strokes)
			? (src.strokes.map(normalizeStroke).filter(Boolean) as StrokeLayer[])
			: [],
		shadows: Array.isArray(src.shadows)
			? (src.shadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
			: Array.isArray(src.outerShadows)
				? (src.outerShadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
				: [],
		innerShadows: Array.isArray(src.innerShadows)
			? (src.innerShadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
			: Array.isArray(src.inner_shadows)
				? (src.inner_shadows.map(normalizeShadow).filter(Boolean) as ShadowLayer[])
				: [],
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
	const style = normalizeFlowerStyle({
		fill: { alpha: 1, content: createSolidContent(ui.color || "#ffffff", 1) },
		strokes: [],
		shadows: [],
		innerShadows: [],
	});
	const ol = ui.outline || {};
	if (ol.enabled) {
		style.strokes.push({
			enable: true,
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
		style.shadows.push({
			enable: true,
			angle,
			distance: dist || 4,
			diffuse: Number(sh.blur) || 0,
			alpha: sh.opacity != null ? clamp01(sh.opacity) : 0.75,
			offsetX: ox,
			offsetY: oy,
			content: createSolidContent(sh.color || "#000000", 1),
		});
	}
	return style;
}

export function getEffectiveFlowerStyle(ui: {
	color?: string;
	outline?: FlowerStyle extends never ? never : {
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
	if (ui.flowerStyle && typeof ui.flowerStyle === "object") {
		return normalizeFlowerStyle(ui.flowerStyle);
	}
	return flowerStyleFromLegacy(ui);
}

export function contentPrimaryColor(content: FillContent): string {
	const c = normalizeFillContent(content);
	if (c.renderType === "gradient") return c.gradient.colors[0];
	return c.solid.color;
}

export function contentUsesGradient(content: FillContent): boolean {
	return normalizeFillContent(content).renderType === "gradient";
}
'''

# Fix the weird type in getEffectiveFlowerStyle
flower_ts = flower_ts.replace(
'''export function getEffectiveFlowerStyle(ui: {
	color?: string;
	outline?: FlowerStyle extends never ? never : {
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
}): FlowerStyle {''',
'''export function getEffectiveFlowerStyle(ui: {
	color?: string;
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
}): FlowerStyle {''')

out = Path(r'D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\flower-style.ts')
out.write_bytes(flower_ts.replace('\r\n','\n').encode('utf-8'))
print('wrote', out, out.stat().st_size)