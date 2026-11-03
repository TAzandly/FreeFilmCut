/**
 * Text layer → WebGLRenderTarget → shared Registry Fx → composite.
 *
 * Plain + flower share this path. Flower stencil multi-pass must finish inside
 * renderTextLayerToTarget before Fx. Camera postProcessStack is NEVER used here.
 *
 * Effect definitions: vfxpack/postprocess/registry (same as camera pack PP).
 * Text stack shape: PostProcessStackData on fccUI.textFxStack / timeline props.
 *
 * Color: text RT is HalfFloat RGBA + stencil (display-tagged sRGB). Texture Fx
 * skips OutputPass (keep alpha). HalfFloat keeps UnrealBloom soft falloff from banding.
 */

import * as THREE from "three";
import { renderUIOverlay } from "./ui-overlay";
import {
	renderTextureFx,
	stackHasEnabledEffects,
	type PostProcessStackData,
	type TextureFxCache,
} from "@/vfxpack/postprocess";
import { shouldReuseTextLayerRtSize } from "@/vfxpack/text-layer-aabb";

export type TextLayerRTSpec = {
	/** Keep true: flower inner shadow / face stencil need a stencil buffer. */
	stencilBuffer?: boolean;
	depthBuffer?: boolean;
	/**
	 * When true, keep an existing RT if it already covers (w,h) and is not much
	 * larger (hysteresis). Avoids per-frame realloc as AABB breathes with anim.
	 */
	fit?: boolean;
};

const DEFAULT_SPEC: Required<TextLayerRTSpec> = {
	stencilBuffer: true,
	depthBuffer: true,
};

export function createTextLayerRenderTarget(
	width: number,
	height: number,
	spec: TextLayerRTSpec = {},
): THREE.WebGLRenderTarget {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const stencilBuffer = spec.stencilBuffer ?? DEFAULT_SPEC.stencilBuffer;
	const depthBuffer = spec.depthBuffer ?? DEFAULT_SPEC.depthBuffer;
	const rt = new THREE.WebGLRenderTarget(w, h, {
		type: THREE.HalfFloatType,
		format: THREE.RGBAFormat,
		depthBuffer,
		stencilBuffer,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	});
	rt.texture.colorSpace = THREE.SRGBColorSpace;
	rt.texture.flipY = false;
	rt.texture.generateMipmaps = false;
	rt.texture.minFilter = THREE.LinearFilter;
	rt.texture.magFilter = THREE.LinearFilter;
	rt.texture.name = "FreeFilmCut.TextLayerRT";
	return rt;
}

export function ensureTextLayerRenderTarget(
	prev: THREE.WebGLRenderTarget | null,
	width: number,
	height: number,
	spec: TextLayerRTSpec = {},
): THREE.WebGLRenderTarget {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const fit = !!spec.fit;
	if (prev && prev.texture.type === THREE.HalfFloatType) {
		if (!fit && prev.width === w && prev.height === h) return prev;
		if (fit && shouldReuseTextLayerRtSize(prev.width, prev.height, w, h)) return prev;
	}
	prev?.dispose();
	return createTextLayerRenderTarget(w, h, spec);
}

/**
 * Clear the RT (color+depth+stencil), then draw overlay UI into it.
 * Flower Effect-stack stencil passes must finish inside this call before any FX.
 */
export function renderTextLayerToTarget({
	renderer,
	root,
	uiCamera,
	resW,
	resH,
	target,
	viewRect,
}: {
	renderer: THREE.WebGLRenderer;
	root: THREE.Object3D;
	uiCamera: THREE.OrthographicCamera;
	resW: number;
	resH: number;
	target: THREE.WebGLRenderTarget;
	/** Optional tight frustum in project pixels (bottom-left origin). */
	viewRect?: { x: number; y: number; w: number; h: number } | null;
}): boolean {
	const prevTarget = renderer.getRenderTarget();
	const prevClear = new THREE.Color();
	renderer.getClearColor(prevClear);
	const prevAlpha = renderer.getClearAlpha();

	const prevViewport = new THREE.Vector4();
	const prevScissor = new THREE.Vector4();
	renderer.getViewport(prevViewport);
	renderer.getScissor(prevScissor);
	const prevScissorTest = renderer.getScissorTest();

	renderer.setRenderTarget(target);
	renderer.setViewport(0, 0, target.width, target.height);
	renderer.setScissorTest(false);
	renderer.setClearColor(0x000000, 0);
	renderer.clear(true, true, true);

	const drew = renderUIOverlay({
		renderer,
		root,
		uiCamera,
		resW,
		resH,
		target,
		viewRect: viewRect || null,
	});

	renderer.setClearColor(prevClear, prevAlpha);
	renderer.setRenderTarget(prevTarget);
	renderer.setViewport(prevViewport);
	renderer.setScissor(prevScissor);
	renderer.setScissorTest(prevScissorTest);
	return drew;
}

/**
 * Shared-registry Text Fx after full text rasterization (buildTextureFxComposer).
 */
export function applyTextLayerFx({
	renderer,
	target,
	stack,
	cache,
}: {
	renderer: THREE.WebGLRenderer;
	target: THREE.WebGLRenderTarget;
	stack: PostProcessStackData | null | undefined;
	cache?: TextureFxCache;
}): THREE.Texture {
	if (!stackHasEnabledEffects(stack)) return target.texture;
	return renderTextureFx({
		renderer,
		inputTexture: target.texture,
		width: target.width,
		height: target.height,
		stack,
		cache,
	});
}

/** @deprecated use applyTextLayerFx */
export function applyTextLayerFxPlaceholder(
	_target: THREE.WebGLRenderTarget,
): THREE.Texture | null {
	return null;
}

export function textLayerCompositeSource(
	target: THREE.WebGLRenderTarget,
	opts?: {
		renderer?: THREE.WebGLRenderer;
		stack?: PostProcessStackData | null;
		cache?: TextureFxCache;
	},
): THREE.Texture {
	if (opts?.renderer) {
		return applyTextLayerFx({
			renderer: opts.renderer,
			target,
			stack: opts.stack,
			cache: opts.cache,
		});
	}
	return target.texture;
}
