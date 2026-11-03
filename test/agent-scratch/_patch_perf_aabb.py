# -*- coding: utf-8 -*-
"""Perf patches: stable text RT AABB, max bloom pad, timecode without React setState, opacity early-out."""
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src")

# ---------- 1) text-layer-aabb.ts: max pad from pack tracks + cache helpers ----------
aabb_path = ROOT / "vfxpack" / "text-layer-aabb.ts"
aabb = aabb_path.read_text(encoding="utf-8")

if "bloomPadPxFromPackTracks" not in aabb:
    insert_after = "export function bloomPadPxFromStack(input: TextLayerBloomPadInput): number {"
    # Find end of bloomPadPxFromStack function - next export after it
    # We'll append new helpers after bloomPadPxFromStack's closing and unrealBloomHaloPadPx
    helper = r'''

/**
 * Bloom pad for RT sizing must NOT follow live K-framed strength every tick —
 * that breathes the AABB, reallocates the text RT, and rebuilds EffectComposer.
 * Use the max strength/radius seen in the static snapshot + track keys.
 */
export function bloomPadPxFromPackTracks(args: {
	stack?: PostProcessStackData | null;
	tracks?: Array<{ path?: string; keys?: Array<{ t: number; v: number }> }> | null;
	canvasW: number;
	canvasH: number;
	inkMaxSide: number;
	basePadPx?: number;
}): number {
	const stack = args.stack;
	if (!stack || stack.enabled === false) {
		return bloomPadPxFromStack({
			stack,
			canvasW: args.canvasW,
			canvasH: args.canvasH,
			inkMaxSide: args.inkMaxSide,
			basePadPx: args.basePadPx,
		});
	}
	const maxByEffect = new Map<string, { strength: number; radius: number; intensity: number }>();
	for (const entry of stack.effects || []) {
		if (!entry || !entry.id) continue;
		const params = entry.params || {};
		maxByEffect.set(String(entry.id), {
			strength: Math.max(0, Number(params.strength) || 0),
			radius: Math.max(0, Number(params.radius) || 0),
			intensity: Math.max(0, Number(params.intensity) || 0),
		});
	}
	for (const tr of args.tracks || []) {
		const path = String(tr?.path || "");
		const m = path.match(/^postProcess\.([^.]+)\.(strength|radius|intensity)$/);
		if (!m || !tr?.keys?.length) continue;
		const id = m[1];
		const param = m[2] as "strength" | "radius" | "intensity";
		let slot = maxByEffect.get(id);
		if (!slot) {
			slot = { strength: 0, radius: 0, intensity: 0 };
			maxByEffect.set(id, slot);
		}
		for (const k of tr.keys) {
			const v = Number(k?.v);
			if (!Number.isFinite(v)) continue;
			slot[param] = Math.max(slot[param], Math.max(0, v));
		}
	}
	const effects = (stack.effects || []).map((e) => {
		if (!e) return e;
		const slot = maxByEffect.get(String(e.id));
		if (!slot) return e;
		const params = { ...(e.params || {}) };
		if (e.type === "bloom") {
			params.strength = Math.max(Number(params.strength) || 0, slot.strength);
			params.radius = Math.max(Number(params.radius) || 0, slot.radius);
		} else if (e.type === "deepGlow") {
			params.intensity = Math.max(Number(params.intensity) || 0, slot.intensity);
			params.radius = Math.max(Number(params.radius) || 0, slot.radius);
		}
		return { ...e, params };
	});
	return bloomPadPxFromStack({
		stack: { ...stack, effects },
		canvasW: args.canvasW,
		canvasH: args.canvasH,
		inkMaxSide: args.inkMaxSide,
		basePadPx: args.basePadPx,
	});
}

/** Expand-only union for animating ink (never shrink mid-play). */
export function unionTextLayerAabb(a: TextLayerAabb, b: TextLayerAabb): TextLayerAabb {
	const x0 = Math.min(a.x, b.x);
	const y0 = Math.min(a.y, b.y);
	const x1 = Math.max(a.x + a.w, b.x + b.w);
	const y1 = Math.max(a.y + a.h, b.y + b.h);
	return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
'''
    # Insert before resolveTextLayerRtRect
    marker = "export function resolveTextLayerRtRect(args: ResolveTextLayerRtRectArgs): TextLayerAabb {"
    if marker not in aabb:
        raise SystemExit("resolveTextLayerRtRect marker missing")
    aabb = aabb.replace(marker, helper + "\n" + marker)

    # Extend resolveTextLayerRtRect to accept optional padOverride
    old_resolve_args = """export type ResolveTextLayerRtRectArgs = {
	root: THREE.Object3D;
	resW: number;
	resH: number;
	/** Fallback when Troika not ready */
	propsFallback?: {
		content?: string;
		positionX: number;
		positionY: number;
		scaledFontSize: number;
		letterSpacing?: number;
		lineHeight?: number;
		scaleX?: number;
		scaleY?: number;
		flowerStyle?: unknown;
	};
	stack?: PostProcessStackData | null;
};"""
    new_resolve_args = """export type ResolveTextLayerRtRectArgs = {
	root: THREE.Object3D;
	resW: number;
	resH: number;
	/** Fallback when Troika not ready */
	propsFallback?: {
		content?: string;
		positionX: number;
		positionY: number;
		scaledFontSize: number;
		letterSpacing?: number;
		lineHeight?: number;
		scaleX?: number;
		scaleY?: number;
		flowerStyle?: unknown;
	};
	stack?: PostProcessStackData | null;
	/** When set, skip bloomPadPxFromStack(stack) and use this pad (stable pack-max). */
	padOverridePx?: number | null;
	/** Skip layout+measure; use this ink AABB (still flower-extra + pad). */
	inkOverride?: TextLayerAabb | null;
};"""
    if old_resolve_args not in aabb:
        raise SystemExit("ResolveTextLayerRtRectArgs block missing")
    aabb = aabb.replace(old_resolve_args, new_resolve_args)

    old_body = """export function resolveTextLayerRtRect(args: ResolveTextLayerRtRectArgs): TextLayerAabb {
	const resW = Math.max(1, Math.round(args.resW));
	const resH = Math.max(1, Math.round(args.resH));
	let ink =
		measureOverlayTextInkAabb(args.root, resW, resH) ||
		(args.propsFallback
			? estimateTextInkAabbFromProps({
					...args.propsFallback,
					canvasWidth: resW,
					canvasHeight: resH,
				})
			: { x: 0, y: 0, w: resW, h: resH });

	const fs = args.propsFallback?.scaledFontSize || 48;
	const flowerExtra = flowerStyleInkExtraPx(args.propsFallback?.flowerStyle, fs);
	if (flowerExtra > 0) {
		ink = {
			x: ink.x - flowerExtra,
			y: ink.y - flowerExtra,
			w: ink.w + flowerExtra * 2,
			h: ink.h + flowerExtra * 2,
		};
	}

	const inkMaxSide = Math.max(ink.w, ink.h);
	const pad = bloomPadPxFromStack({
		stack: args.stack,
		canvasW: resW,
		canvasH: resH,
		inkMaxSide,
	});
	return padAndClampTextLayerAabb(ink, pad, resW, resH);
}"""
    new_body = """export function resolveTextLayerRtRect(args: ResolveTextLayerRtRectArgs): TextLayerAabb {
	const resW = Math.max(1, Math.round(args.resW));
	const resH = Math.max(1, Math.round(args.resH));
	let ink =
		args.inkOverride ||
		measureOverlayTextInkAabb(args.root, resW, resH) ||
		(args.propsFallback
			? estimateTextInkAabbFromProps({
					...args.propsFallback,
					canvasWidth: resW,
					canvasHeight: resH,
				})
			: { x: 0, y: 0, w: resW, h: resH });

	const fs = args.propsFallback?.scaledFontSize || 48;
	const flowerExtra = flowerStyleInkExtraPx(args.propsFallback?.flowerStyle, fs);
	if (flowerExtra > 0) {
		ink = {
			x: ink.x - flowerExtra,
			y: ink.y - flowerExtra,
			w: ink.w + flowerExtra * 2,
			h: ink.h + flowerExtra * 2,
		};
	}

	const inkMaxSide = Math.max(ink.w, ink.h);
	const pad =
		args.padOverridePx != null && Number.isFinite(args.padOverridePx)
			? Math.max(0, Math.ceil(args.padOverridePx))
			: bloomPadPxFromStack({
					stack: args.stack,
					canvasW: resW,
					canvasH: resH,
					inkMaxSide,
				});
	return padAndClampTextLayerAabb(ink, pad, resW, resH);
}"""
    if old_body not in aabb:
        raise SystemExit("resolveTextLayerRtRect body missing")
    aabb = aabb.replace(old_body, new_body)
    aabb_path.write_text(aabb, encoding="utf-8")
    print("patched text-layer-aabb.ts")
else:
    print("text-layer-aabb.ts already patched")

print("aabb ok")
