/**
 * Tight text-layer RT sizing: ink AABB in project pixels + bloom-aware pad.
 *
 * Contract (clip + editor should share):
 * - Size RT from glyph/text ink bounds after layout (and after bend/wipe if they
 *   expand before bloom), NOT a fixed 400x200.
 * - Pad outward so UnrealBloom / DeepGlow halos are not clipped at the RT edge.
 * - UnrealBloom `radius` is a 0..1 mip-weight lerp (NOT pixels). Pad uses the
 *   mip-kernel reach (~12/40/112/288/704 project-px at 1:1 density), weighted by
 *   strength and radius, with a generous floor so small authored radius (e.g. 0.01)
 *   still clears wipe/HDR soft skirts. Result clamps to canvas (→ near full-canvas
 *   when halo would exceed it).
 * - Dirty-rebuild when layout/style/bloom/radius/design-res/preview-scale change;
 *   reuse RT when size stays inside a hysteresis band (no per-frame realloc).
 * - Bloom kernels are texel-relative to the text/PP FBO. Keep 1:1 project-pixel
 *   density on the PP path so radius looks like full-canvas authoring; pad grows
 *   with radius so large blooms fall back toward full-canvas naturally.
 */

import * as THREE from "three";
import {
	isFccTroikaTextMesh,
	layoutAllCanvases,
} from "@/vfxpack/ui-overlay";
import type { PostProcessStackData } from "@/vfxpack/postprocess";

export type TextLayerAabb = {
	/** Bottom-left origin, project/authored pixels (overlay ortho space). */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type TextLayerBloomPadInput = {
	stack?: PostProcessStackData | null;
	canvasW: number;
	canvasH: number;
	/** max(inkW, inkH) before pad */
	inkMaxSide: number;
	/** Extra AA / soft-edge pad even when bloom strength≈0 */
	basePadPx?: number;
};

const _box = new THREE.Box3();
const _corner = new THREE.Vector3();

const BASE_AA_PAD = 8;
/** Reuse RT when existing size is within this factor of needed (avoid thrash). */
export const TEXT_LAYER_RT_SIZE_HYSTERESIS = 1.35;

function finite(n: number, fallback = 0): number {
	return Number.isFinite(n) ? n : fallback;
}

/** Collect bloom/deepGlow pad in project pixels from a PP stack. */
export function bloomPadPxFromStack(input: TextLayerBloomPadInput): number {
	const base = Math.max(0, Math.round(input.basePadPx ?? BASE_AA_PAD));
	const stack = input.stack;
	const canvasMax = Math.max(1, input.canvasW, input.canvasH);
	const inkMax = Math.max(1, input.inkMaxSide);
	let bloomPad = 0;
	if (!stack || stack.enabled === false) return base;
	for (const entry of stack.effects || []) {
		if (!entry || entry.enabled === false) continue;
		const params = entry.params || {};
		if (entry.type === "bloom") {
			const strength = Math.max(0, Number(params.strength) || 0);
			const radius = Math.max(0, Number(params.radius) || 0);
			if (strength < 1e-4) continue;
			bloomPad = Math.max(
				bloomPad,
				unrealBloomHaloPadPx(strength, radius, canvasMax, inkMax),
			);
		} else if (entry.type === "deepGlow") {
			const intensity = Math.max(0, Number(params.intensity) || 0);
			const radius = Math.max(0, Number(params.radius) || 0);
			if (intensity < 1e-4) continue;
			// deepGlow radius is authored in a softer unit; keep generous floor.
			bloomPad = Math.max(
				bloomPad,
				radius * 64 + 32,
				48 * Math.min(2, intensity + 0.35),
				0.06 * canvasMax,
			);
		}
	}
	return Math.max(base, Math.ceil(bloomPad));
}

/**
 * UnrealBloomPass pad in **project pixels** (1:1 PP density).
 *
 * Important: `radius` is a 0..1 **mip-weight lerp** (mix factor↔mirrorFactor),
 * NOT a pixel/kernel radius. Separable kernels [6,10,14,18,22] on the half-res
 * mip chain give approx full-res texel reaches ~[12, 40, 112, 288, 704] when the
 * bloom FBO is 1:1 with authored pixels. Old formula `radius * k * ink` under-
 * padded badly at author values like radius=0.01 (sweep), causing hard RT seams.
 *
 * Pad ≈ strength-weighted mix of those mip reaches; radius shifts weight toward
 * larger mips; clamp so we expand toward full-canvas only when needed.
 */
function unrealBloomHaloPadPx(
	strength: number,
	radius: number,
	canvasMax: number,
	inkMax: number,
): number {
	const s = Math.max(0, strength);
	const t = Math.min(1, Math.max(0, radius));
	// Soft-visible reaches (not the hard kernel tip). Outer mips are faint but
	// wipe/HDR edges + additive composite still show a wide soft skirt.
	const r0 = 12;
	const r1 = 40;
	const r2 = 112;
	const r3 = 288;
	const r4 = Math.min(704, canvasMax * 0.45);
	const reachCore = 0.5 * r0 + 0.35 * r1 + 0.15 * r2; // ~37px
	const reachOuter = 0.25 * r1 + 0.35 * r2 + 0.25 * r3 + 0.15 * r4;
	const reach = (1 - t) * reachCore + t * reachOuter;
	// strength: low values still need core blur room; high pulls outer mips in.
	const sMul = Math.min(2.75, 0.75 + s * 1.25);
	let pad = reach * sMul;
	// Floor: never thinner than a readable halo band; also ~8% canvas / fraction of ink
	// so small-radius authored packs (0.01) still clear wipe bloom skirts.
	pad = Math.max(pad, 64, 0.08 * canvasMax, Math.min(0.22 * canvasMax, 0.45 * inkMax * Math.min(1.4, s + 0.55)));
	pad = Math.min(pad, 0.48 * canvasMax);
	return pad;
}

/** Expand AABB by uniform pad and clamp to the canvas. */
export function padAndClampTextLayerAabb(
	ink: TextLayerAabb,
	padPx: number,
	canvasW: number,
	canvasH: number,
): TextLayerAabb {
	const pad = Math.max(0, Math.ceil(padPx));
	const cw = Math.max(1, Math.round(canvasW));
	const ch = Math.max(1, Math.round(canvasH));
	let x = Math.floor(ink.x - pad);
	let y = Math.floor(ink.y - pad);
	let r = Math.ceil(ink.x + ink.w + pad);
	let t = Math.ceil(ink.y + ink.h + pad);
	x = Math.max(0, Math.min(x, cw - 1));
	y = Math.max(0, Math.min(y, ch - 1));
	r = Math.max(x + 1, Math.min(r, cw));
	t = Math.max(y + 1, Math.min(t, ch));
	return { x, y, w: r - x, h: t - y };
}

/**
 * Heuristic ink box from timeline props when Troika has not synced yet.
 * Overlay space: canvas center + anchoredPosition (Y already flipped by caller).
 */
export function estimateTextInkAabbFromProps(props: {
	content?: string;
	canvasWidth: number;
	canvasHeight: number;
	positionX: number;
	positionY: number;
	scaledFontSize: number;
	letterSpacing?: number;
	lineHeight?: number;
	scaleX?: number;
	scaleY?: number;
}): TextLayerAabb {
	const cw = Math.max(1, props.canvasWidth);
	const ch = Math.max(1, props.canvasHeight);
	const fs = Math.max(1, props.scaledFontSize || 48);
	const text = String(props.content || "");
	const lines = text.split(/\r?\n/);
	const lineCount = Math.max(1, lines.length);
	const longest = lines.reduce((m, l) => Math.max(m, Array.from(l).length), 1);
	const tracking = finite(props.letterSpacing, 0);
	const lh = Math.max(0.5, finite(props.lineHeight, 1.2));
	const sx = Math.max(0.01, Math.abs(finite(props.scaleX, 1)));
	const sy = Math.max(0.01, Math.abs(finite(props.scaleY, 1)));
	const inkW = Math.max(fs, longest * (fs * 0.95 + tracking)) * sx;
	const inkH = Math.max(fs, lineCount * fs * lh) * sy;
	// props.positionY is Canvas2D Y-down; overlay uses -positionY from center.
	const cx = cw * 0.5 + finite(props.positionX, 0);
	const cy = ch * 0.5 - finite(props.positionY, 0);
	return {
		x: cx - inkW * 0.5,
		y: cy - inkH * 0.5,
		w: inkW,
		h: inkH,
	};
}

/**
 * Extra ink expansion from flower stroke / shadow offsets (project px).
 */
export function flowerStyleInkExtraPx(flowerStyle: unknown, fontSize: number): number {
	if (!flowerStyle || typeof flowerStyle !== "object") return 0;
	const fs = Math.max(1, fontSize || 48);
	const style = flowerStyle as {
		strokes?: Array<{ width?: number }>;
		shadows?: Array<{ width?: number; offsetX?: number; offsetY?: number; distance?: number }>;
		stack?: Array<{ kind?: string; width?: number; offsetX?: number; offsetY?: number; distance?: number }>;
	};
	let extra = 0;
	const bump = (width?: number, ox?: number, oy?: number, distance?: number) => {
		const w = Math.max(0, Number(width) || 0);
		const o = Math.max(
			Math.abs(Number(ox) || 0),
			Math.abs(Number(oy) || 0),
			Math.abs(Number(distance) || 0),
		);
		extra = Math.max(extra, w + o);
	};
	for (const s of style.strokes || []) bump(s.width);
	for (const s of style.shadows || []) bump(s.width, s.offsetX, s.offsetY, s.distance);
	for (const s of style.stack || []) {
		if (s.kind === "stroke" || s.kind === "shadow") {
			bump(s.width, s.offsetX, s.offsetY, s.distance);
		}
	}
	// Soft safety relative to font size (AA / underlay dilate).
	return Math.max(extra, fs * 0.08);
}

/**
 * Union world AABB of visible Troika glyph meshes under `root`, in the same
 * units as the current scene graph (overlay = project pixels after layout).
 */
export function computeTroikaInkAabb(root: THREE.Object3D): TextLayerAabb | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let found = false;

	root.updateMatrixWorld(true);
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh & {
			textRenderInfo?: { visibleBounds?: number[]; blockBounds?: number[] };
		};
		const named = isFccTroikaTextMesh(obj);
		const hasInfo = !!(mesh as { textRenderInfo?: unknown }).textRenderInfo;
		if (!named && !hasInfo) return;
		if (!obj.visible) return;
		// Skip parked originals while char-split owns drawing.
		let p: THREE.Object3D | null = obj.parent;
		while (p && p !== root) {
			if (p.name === "__fccTextAnimPark") return;
			p = p.parent;
		}
		const geom = mesh.geometry;
		if (!geom) return;

		// Prefer Troika layout bounds when present (stable + includes outline mesh).
		const info = mesh.textRenderInfo;
		const vb = info?.visibleBounds;
		const bb = info?.blockBounds;
		const b =
			vb && vb.length >= 4 && vb[2] - vb[0] > 1e-4 && vb[3] - vb[1] > 1e-4
				? vb
				: bb && bb.length >= 4 && bb[2] - bb[0] > 1e-4 && bb[3] - bb[1] > 1e-4
					? bb
					: null;

		if (b) {
			mesh.updateWorldMatrix(true, false);
			for (let i = 0; i < 4; i++) {
				_corner
					.set(i & 1 ? b[2] : b[0], i & 2 ? b[3] : b[1], 0)
					.applyMatrix4(mesh.matrixWorld);
				minX = Math.min(minX, _corner.x);
				minY = Math.min(minY, _corner.y);
				maxX = Math.max(maxX, _corner.x);
				maxY = Math.max(maxY, _corner.y);
			}
			found = true;
			return;
		}

		_box.setFromObject(mesh);
		if (_box.isEmpty()) return;
		minX = Math.min(minX, _box.min.x);
		minY = Math.min(minY, _box.min.y);
		maxX = Math.max(maxX, _box.max.x);
		maxY = Math.max(maxY, _box.max.y);
		found = true;
	});

	if (!found || !(maxX > minX) || !(maxY > minY)) return null;
	// Small fraction pad for bend / subpixel AA before bloom pad.
	const pad = Math.max(2, Math.max(maxX - minX, maxY - minY) * 0.06);
	return {
		x: minX - pad,
		y: minY - pad,
		w: maxX - minX + pad * 2,
		h: maxY - minY + pad * 2,
	};
}

/**
 * Layout overlay canvases then measure ink AABB in project pixels.
 * Call after fccUI / text-anim pose sync, before rendering the text RT.
 */
export function measureOverlayTextInkAabb(
	root: THREE.Object3D,
	resW: number,
	resH: number,
): TextLayerAabb | null {
	layoutAllCanvases(root, resW, resH, { forMode: "overlay" });
	return computeTroikaInkAabb(root);
}

export type ResolveTextLayerRtRectArgs = {
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
};

/**
 * Full resolve: ink measure → flower extra → bloom pad → clamp to canvas.
 */


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

export function resolveTextLayerRtRect(args: ResolveTextLayerRtRectArgs): TextLayerAabb {
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
}

/** Dirty key for RT size (not every anim opacity tick). */
export function textLayerRtDirtyKey(rect: TextLayerAabb, previewScale: number, extra = ""): string {
	return [
		Math.round(rect.x),
		Math.round(rect.y),
		Math.round(rect.w),
		Math.round(rect.h),
		previewScale.toFixed(4),
		extra,
	].join("|");
}

/**
 * Choose RT pixel size with hysteresis against a previous target.
 * Returns whether the existing RT can be kept.
 */
export function shouldReuseTextLayerRtSize(
	prevW: number,
	prevH: number,
	needW: number,
	needH: number,
	hysteresis = TEXT_LAYER_RT_SIZE_HYSTERESIS,
): boolean {
	const pw = Math.max(1, Math.round(prevW));
	const ph = Math.max(1, Math.round(prevH));
	const nw = Math.max(1, Math.round(needW));
	const nh = Math.max(1, Math.round(needH));
	if (pw < nw || ph < nh) return false;
	if (pw > nw * hysteresis || ph > nh * hysteresis) return false;
	return true;
}

/** Map authored AABB → compose/accum pixels (preview scale may differ on X/Y). */
export function mapAabbToDestRect(
	aabb: TextLayerAabb,
	authoredW: number,
	authoredH: number,
	destW: number,
	destH: number,
): TextLayerAabb {
	const sx = Math.max(1, destW) / Math.max(1, authoredW);
	const sy = Math.max(1, destH) / Math.max(1, authoredH);
	return {
		x: aabb.x * sx,
		y: aabb.y * sy,
		w: Math.max(1, aabb.w * sx),
		h: Math.max(1, aabb.h * sy),
	};
}

/**
 * Convert overlay AABB (0..resW, 0..resH, Y-up) to centered ortho frustum
 * used by flower PP beauty cam (placeCanvas still sees full res).
 */
export function aabbToCenteredOrthoView(aabb: TextLayerAabb, resW: number, resH: number) {
	const hw = resW * 0.5;
	const hh = resH * 0.5;
	return {
		fullW: resW,
		fullH: resH,
		/** setViewOffset x from left */
		offsetX: aabb.x,
		/** setViewOffset y from top */
		offsetY: resH - (aabb.y + aabb.h),
		width: aabb.w,
		height: aabb.h,
		/** optional direct frustum if not using view offset */
		left: aabb.x - hw,
		right: aabb.x + aabb.w - hw,
		bottom: aabb.y - hh,
		top: aabb.y + aabb.h - hh,
	};
}

