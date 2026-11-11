import * as THREE from "three";
import type { BeautyAnalysisFrame } from "../analysis/types";
import type { ClipBeautyParams } from "../types";
import {
	BEAUTY_SMOOTH_FRAGMENT_SHADER,
	BEAUTY_VERTEX_SHADER,
	BEAUTY_WARP_FRAGMENT_SHADER,
	BEAUTY_WHITEN_FRAGMENT_SHADER,
} from "./shaders";
import {
	MAX_BEAUTY_FACES,
	packWarpFaces,
	skinMaskCoverage,
	WARP_VEC4_PER_FACE,
} from "./warp-points";

const MIN_STRENGTH = 1e-4;
/** Distinct RT sizes kept alive (two RTs each). Oldest unused size is evicted. */
const MAX_POOLED_SIZES = 3;
/** Pools idle longer than this are released by `trimBeautyPass`. */
const POOL_IDLE_MS = 10_000;
/** Default cap on the pass resolution's longer edge. */
const DEFAULT_MAX_EDGE = 4096;

export type BeautyPassPlan = { warp: boolean; smooth: boolean; whiten: boolean };

/**
 * Which passes can run. Warp needs landmarks; smooth/whiten need a skin mask
 * with some coverage (landmark fallback masks count). Pure — unit tested.
 */
export function planBeautyPasses({
	beauty,
	faceCount,
	maskCoverage,
}: {
	beauty: ClipBeautyParams;
	faceCount: number;
	maskCoverage: number;
}): BeautyPassPlan {
	const hasMask = maskCoverage > 0;
	return {
		warp:
			faceCount > 0 &&
			(beauty.eye > MIN_STRENGTH ||
				beauty.faceSlim > MIN_STRENGTH ||
				beauty.vFace > MIN_STRENGTH ||
				beauty.noseSlim > MIN_STRENGTH),
		smooth: hasMask && beauty.smooth > MIN_STRENGTH,
		whiten: hasMask && beauty.whiten > MIN_STRENGTH,
	};
}

/** Pass size: keep aspect, clamp the longer edge to `maxEdge`. */
export function fitBeautyPassSize(
	width: number,
	height: number,
	maxEdge: number,
): { width: number; height: number } {
	const longest = Math.max(width, height);
	const scale = longest > maxEdge && maxEdge > 0 ? maxEdge / longest : 1;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

export type ApplyBeautyPassParams = {
	renderer: THREE.WebGLRenderer;
	/** Layer texture (sRGB-decoded in hardware; flipY=false). */
	inputTexture: THREE.Texture;
	width: number;
	height: number;
	beauty: ClipBeautyParams;
	/** Missing analysis => nothing to warp or mask => returns `null`. */
	analysis: BeautyAnalysisFrame | null | undefined;
	/** Cap on the longer pass edge (default 4096). */
	maxEdge?: number;
};

/** Preview beauty RT long-edge cap (preview also never exceeds compose size). */
export const BEAUTY_PREVIEW_MAX_EDGE = 1920;

type RtPair = {
	a: THREE.WebGLRenderTarget;
	b: THREE.WebGLRenderTarget;
	lastUsed: number;
};

/** GPU resources bound to one WebGLRenderer. */
class BeautyGpu {
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private readonly mesh: THREE.Mesh;
	private warpMaterial: THREE.ShaderMaterial | null = null;
	private smoothMaterial: THREE.ShaderMaterial | null = null;
	private whitenMaterial: THREE.ShaderMaterial | null = null;
	private maskTexture: THREE.DataTexture | null = null;
	private maskSource: BeautyAnalysisFrame | null = null;
	private maskCoverage = 0;
	private maskUsedAt = 0;
	private readonly pools = new Map<string, RtPair>();
	private readonly prevViewport = new THREE.Vector4();

	constructor() {
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
		this.mesh.frustumCulled = false;
		this.scene.add(this.mesh);
	}

	apply(params: ApplyBeautyPassParams): THREE.Texture | null {
		const { renderer, inputTexture, beauty, analysis } = params;
		if (!analysis) return null;
		const size = fitBeautyPassSize(
			params.width,
			params.height,
			params.maxEdge ?? DEFAULT_MAX_EDGE,
		);

		const coverage = this.updateMask(analysis);
		const plan = planBeautyPasses({
			beauty,
			faceCount: analysis.faces.length,
			maskCoverage: coverage,
		});
		const warped = plan.warp
			? packWarpFaces(analysis.faces, size.width / size.height)
			: null;
		const runWarp = warped !== null && warped.count > 0;
		if (!runWarp && !plan.smooth && !plan.whiten) return null;

		const pair = this.acquirePair(size.width, size.height);
		const prevTarget = renderer.getRenderTarget();
		renderer.getViewport(this.prevViewport);
		const prevScissorTest = renderer.getScissorTest();
		const prevAutoClear = renderer.autoClear;
		renderer.setScissorTest(false);
		renderer.autoClear = false;

		let src: THREE.Texture = inputTexture;
		let dst = pair.a;
		const run = (material: THREE.ShaderMaterial) => {
			material.uniforms.tInput.value = src;
			// Uniforms are mutated in place; force re-upload even if the renderer
			// still believes this material was the last one drawn.
			material.uniformsNeedUpdate = true;
			this.mesh.material = material;
			renderer.setRenderTarget(dst);
			renderer.setViewport(0, 0, size.width, size.height);
			renderer.render(this.scene, this.camera);
			src = dst.texture;
			dst = dst === pair.a ? pair.b : pair.a;
		};

		try {
			if (runWarp && warped) {
				const m = this.getWarpMaterial();
				m.uniforms.uAspect.value = size.width / size.height;
				m.uniforms.uFaceCount.value = warped.count;
				m.uniforms.uEye.value = beauty.eye;
				m.uniforms.uFaceSlim.value = beauty.faceSlim;
				m.uniforms.uVFace.value = beauty.vFace;
				m.uniforms.uNoseSlim.value = beauty.noseSlim;
				m.uniforms.uWarp.value = warped.data;
				run(m);
			}
			if (plan.smooth) {
				const m = this.getSmoothMaterial();
				m.uniforms.uSkinMask.value = this.maskTexture;
				m.uniforms.uSize.value.set(size.width, size.height);
				m.uniforms.uSmooth.value = beauty.smooth;
				run(m);
			}
			if (plan.whiten) {
				const m = this.getWhitenMaterial();
				m.uniforms.uSkinMask.value = this.maskTexture;
				m.uniforms.uWhiten.value = beauty.whiten;
				run(m);
			}
		} finally {
			renderer.setRenderTarget(prevTarget);
			renderer.setViewport(this.prevViewport);
			renderer.setScissorTest(prevScissorTest);
			renderer.autoClear = prevAutoClear;
			// Do not pin the layer texture through the pass uniforms.
			for (const m of [this.warpMaterial, this.smoothMaterial, this.whitenMaterial]) {
				if (m) m.uniforms.tInput.value = null;
			}
		}
		pair.lastUsed = now();
		return src;
	}

	/** Release RT pairs unused for `maxIdleMs`. */
	trim(maxIdleMs: number): void {
		const t = now();
		for (const [key, pair] of this.pools) {
			if (t - pair.lastUsed >= maxIdleMs) {
				pair.a.dispose();
				pair.b.dispose();
				this.pools.delete(key);
			}
		}
		if (this.pools.size === 0 && this.maskTexture && t - this.maskUsedAt >= maxIdleMs) {
			this.disposeMask();
		}
	}

	dispose(): void {
		for (const pair of this.pools.values()) {
			pair.a.dispose();
			pair.b.dispose();
		}
		this.pools.clear();
		this.disposeMask();
		this.warpMaterial?.dispose();
		this.smoothMaterial?.dispose();
		this.whitenMaterial?.dispose();
		this.warpMaterial = this.smoothMaterial = this.whitenMaterial = null;
		this.mesh.geometry.dispose();
	}

	private disposeMask(): void {
		this.maskTexture?.dispose();
		this.maskTexture = null;
		this.maskSource = null;
		this.maskCoverage = 0;
	}

	/** Upload the skin mask when the analysis changed; returns its coverage. */
	private updateMask(analysis: BeautyAnalysisFrame): number {
		this.maskUsedAt = now();
		if (this.maskSource === analysis && this.maskTexture) return this.maskCoverage;
		const { skinWidth: w, skinHeight: h, skinMask } = analysis;
		if (w <= 0 || h <= 0 || skinMask.length < w * h) {
			this.disposeMask();
			return 0;
		}
		const data = skinMask as unknown as Uint8Array<ArrayBuffer>;
		if (
			this.maskTexture &&
			this.maskTexture.image.width === w &&
			this.maskTexture.image.height === h
		) {
			this.maskTexture.image.data = data;
			this.maskTexture.needsUpdate = true;
		} else {
			this.maskTexture?.dispose();
			const tex = new THREE.DataTexture(
				data,
				w,
				h,
				THREE.RedFormat,
				THREE.UnsignedByteType,
			);
			tex.minFilter = THREE.LinearFilter;
			tex.magFilter = THREE.LinearFilter;
			tex.generateMipmaps = false;
			tex.flipY = false;
			tex.unpackAlignment = 1;
			tex.colorSpace = THREE.NoColorSpace;
			tex.needsUpdate = true;
			this.maskTexture = tex;
		}
		this.maskSource = analysis;
		this.maskCoverage = skinMaskCoverage(skinMask);
		return this.maskCoverage;
	}

	private acquirePair(width: number, height: number): RtPair {
		const key = `${width}x${height}`;
		let pair = this.pools.get(key);
		if (!pair) {
			while (this.pools.size >= MAX_POOLED_SIZES) {
				let oldestKey: string | null = null;
				let oldest = Number.POSITIVE_INFINITY;
				for (const [k, p] of this.pools) {
					if (p.lastUsed < oldest) {
						oldest = p.lastUsed;
						oldestKey = k;
					}
				}
				if (oldestKey === null) break;
				const evicted = this.pools.get(oldestKey);
				evicted?.a.dispose();
				evicted?.b.dispose();
				this.pools.delete(oldestKey);
			}
			pair = { a: makeRt(width, height), b: makeRt(width, height), lastUsed: now() };
			this.pools.set(key, pair);
		}
		pair.lastUsed = now();
		return pair;
	}

	private getWarpMaterial(): THREE.ShaderMaterial {
		this.warpMaterial ??= makeMaterial(BEAUTY_WARP_FRAGMENT_SHADER, {
			tInput: { value: null },
			uAspect: { value: 1 },
			uFaceCount: { value: 0 },
			uEye: { value: 0 },
			uFaceSlim: { value: 0 },
			uVFace: { value: 0 },
			uNoseSlim: { value: 0 },
			uWarp: { value: new Float32Array(MAX_BEAUTY_FACES * WARP_VEC4_PER_FACE * 4) },
		});
		return this.warpMaterial;
	}

	private getSmoothMaterial(): THREE.ShaderMaterial {
		this.smoothMaterial ??= makeMaterial(BEAUTY_SMOOTH_FRAGMENT_SHADER, {
			tInput: { value: null },
			uSkinMask: { value: null },
			uSize: { value: new THREE.Vector2(1, 1) },
			uSmooth: { value: 0 },
		});
		return this.smoothMaterial;
	}

	private getWhitenMaterial(): THREE.ShaderMaterial {
		this.whitenMaterial ??= makeMaterial(BEAUTY_WHITEN_FRAGMENT_SHADER, {
			tInput: { value: null },
			uSkinMask: { value: null },
			uWhiten: { value: 0 },
		});
		return this.whitenMaterial;
	}
}

function now(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function makeRt(width: number, height: number): THREE.WebGLRenderTarget {
	const rt = new THREE.WebGLRenderTarget(width, height, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
		// Linear half-float, same as the compositor's accum target.
		type: THREE.HalfFloatType,
		depthBuffer: false,
		stencilBuffer: false,
		generateMipmaps: false,
	});
	rt.texture.flipY = false;
	return rt;
}

function makeMaterial(
	fragmentShader: string,
	uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms,
		vertexShader: BEAUTY_VERTEX_SHADER,
		fragmentShader,
		depthTest: false,
		depthWrite: false,
		blending: THREE.NoBlending,
		transparent: false,
		toneMapped: false,
	});
}

const passes = new WeakMap<THREE.WebGLRenderer, BeautyGpu>();

/**
 * Run warp -> smooth -> whiten on `inputTexture` through pooled ping-pong RTs.
 *
 * Returns the output texture (valid until the next `applyBeautyPass` on this
 * renderer with the same size, so draw it immediately) or `null` when there is
 * nothing to do — missing analysis, or only channels that need data we do not
 * have — in which case the caller keeps the original texture.
 *
 * Preserves renderer render target / viewport / scissor / autoClear.
 */
export function applyBeautyPass(params: ApplyBeautyPassParams): THREE.Texture | null {
	let gpu = passes.get(params.renderer);
	if (!gpu) {
		gpu = new BeautyGpu();
		passes.set(params.renderer, gpu);
	}
	return gpu.apply(params);
}

/** Release idle RTs / mask (call occasionally, e.g. once per frame). */
export function trimBeautyPass(
	renderer: THREE.WebGLRenderer,
	maxIdleMs = POOL_IDLE_MS,
): void {
	passes.get(renderer)?.trim(maxIdleMs);
}

/** Free every GPU resource owned for `renderer` (call on compositor dispose). */
export function disposeBeautyPass(renderer: THREE.WebGLRenderer): void {
	passes.get(renderer)?.dispose();
	passes.delete(renderer);
}
