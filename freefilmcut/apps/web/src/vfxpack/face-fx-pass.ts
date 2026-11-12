/**
 * Face FX GPU pass — warp2d → eyeRay → procedural anchor3d (ears).
 * Mirrors beauty-pass pooling / renderer state preservation.
 */

import * as THREE from "three";
import type { FaceLandmarks } from "@/beauty/analysis/types";
import type { FaceFxConfig, FaceFxEyeRayLayer, FaceFxWarp2dLayer } from "@/vfxpack/face-fx";
import { resolveFaceFxBindPoint } from "@/vfxpack/face-fx-driver";
import {
	FACE_FX_EARS_FRAGMENT_SHADER,
	FACE_FX_GPU_MAX_FACES,
	FACE_FX_RAY_FRAGMENT_SHADER,
	FACE_FX_VERTEX_SHADER,
	FACE_FX_WARP_FRAGMENT_SHADER,
	faceFxWarpPresetId,
} from "@/vfxpack/face-fx-shaders";

const POOL_IDLE_MS = 10_000;
const MAX_POOLED_SIZES = 3;

export type ApplyFaceFxPassParams = {
	renderer: THREE.WebGLRenderer;
	inputTexture: THREE.Texture;
	width: number;
	height: number;
	faces: readonly FaceLandmarks[];
	config: FaceFxConfig;
	/** Clip-local seconds (wave / ray animation). */
	timeSec?: number;
	maxEdge?: number;
	/** When true, skip procedural ear shader (real GLB anchors draw later). */
	skipProceduralEars?: boolean;
};

type RtPair = {
	a: THREE.WebGLRenderTarget;
	b: THREE.WebGLRenderTarget;
	lastUsed: number;
};

function now(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function makeRt(width: number, height: number): THREE.WebGLRenderTarget {
	const rt = new THREE.WebGLRenderTarget(width, height, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
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
		vertexShader: FACE_FX_VERTEX_SHADER,
		fragmentShader,
		depthTest: false,
		depthWrite: false,
		blending: THREE.NoBlending,
		transparent: false,
		toneMapped: false,
	});
}

function fitSize(
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

function parseHexColor(hex: string): THREE.Color {
	const c = new THREE.Color();
	try {
		c.set(hex);
	} catch {
		c.set("#ff0033");
	}
	return c;
}

/** Pack face centers for warp (radius from face box). */
export function packWarpFaces(
	faces: readonly FaceLandmarks[],
	strength: number,
	maxFaces = FACE_FX_GPU_MAX_FACES,
): { count: number; data: Float32Array } {
	const n = Math.min(faces.length, maxFaces);
	const data = new Float32Array(FACE_FX_GPU_MAX_FACES * 4);
	for (let i = 0; i < n; i++) {
		const box = faces[i].box;
		const cx = box.x + box.w / 2;
		const cy = box.y + box.h / 2;
		const radius = Math.max(box.w, box.h) * 0.55;
		const o = i * 4;
		data[o] = cx;
		data[o + 1] = cy;
		data[o + 2] = radius;
		data[o + 3] = strength;
	}
	return { count: n, data };
}

/** Eye ray origins + dirs in UV (continue past iris away from nose). */
export function packEyeRays(
	faces: readonly FaceLandmarks[],
	maxFaces = FACE_FX_GPU_MAX_FACES,
): { count: number; data: Float32Array } {
	const data = new Float32Array(FACE_FX_GPU_MAX_FACES * 2 * 4);
	let count = 0;
	for (let fi = 0; fi < faces.length && count < FACE_FX_GPU_MAX_FACES * 2; fi++) {
		if (fi >= maxFaces) break;
		const face = faces[fi];
		const nose = resolveFaceFxBindPoint({ face, bind: "noseBridge" });
		const left = resolveFaceFxBindPoint({ face, bind: "leftEye" });
		const right = resolveFaceFxBindPoint({ face, bind: "rightEye" });
		for (const eye of [left, right]) {
			if (!eye.ok || count >= FACE_FX_GPU_MAX_FACES * 2) continue;
			let dx = eye.x - nose.x;
			let dy = eye.y - nose.y;
			const len = Math.hypot(dx, dy) || 1;
			dx /= len;
			dy /= len;
			const o = count * 4;
			data[o] = eye.x;
			data[o + 1] = eye.y;
			data[o + 2] = dx;
			data[o + 3] = dy;
			count++;
		}
	}
	return { count, data };
}

/** Forehead anchors for procedural ears. */
export function packEarAnchors(
	faces: readonly FaceLandmarks[],
	maxFaces = FACE_FX_GPU_MAX_FACES,
): { count: number; data: Float32Array } {
	const data = new Float32Array(FACE_FX_GPU_MAX_FACES * 4);
	const n = Math.min(faces.length, maxFaces);
	for (let i = 0; i < n; i++) {
		const face = faces[i];
		const forehead = resolveFaceFxBindPoint({ face, bind: "forehead" });
		const o = i * 4;
		data[o] = forehead.x;
		data[o + 1] = forehead.y;
		data[o + 2] = Math.max(0.05, face.box.w);
		data[o + 3] = Math.max(0.05, face.box.h);
	}
	return { count: n, data };
}

class FaceFxGpu {
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private readonly mesh: THREE.Mesh;
	private warpMaterial: THREE.ShaderMaterial | null = null;
	private rayMaterial: THREE.ShaderMaterial | null = null;
	private earsMaterial: THREE.ShaderMaterial | null = null;
	private readonly pools = new Map<string, RtPair>();
	private readonly prevViewport = new THREE.Vector4();

	constructor() {
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
		this.mesh.frustumCulled = false;
		this.scene.add(this.mesh);
	}

	apply(params: ApplyFaceFxPassParams): THREE.Texture | null {
		const { renderer, inputTexture, faces, config } = params;
		if (!faces.length) return null;
		const layers = config.layers || [];
		const warps = layers.filter((l): l is FaceFxWarp2dLayer => l.kind === "warp2d");
		const rays = layers.filter((l): l is FaceFxEyeRayLayer => l.kind === "eyeRay");
		const anchors = layers.filter((l) => l.kind === "anchor3d");
		const proceduralEars =
			!params.skipProceduralEars &&
			anchors.some((a) => a.kind === "anchor3d" && !String(a.asset || "").trim());
		if (!warps.length && !rays.length && !proceduralEars) return null;

		const size = fitSize(
			params.width,
			params.height,
			params.maxEdge ?? 4096,
		);
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
			material.uniformsNeedUpdate = true;
			this.mesh.material = material;
			renderer.setRenderTarget(dst);
			renderer.setViewport(0, 0, size.width, size.height);
			renderer.render(this.scene, this.camera);
			src = dst.texture;
			dst = dst === pair.a ? pair.b : pair.a;
		};

		const timeSec = params.timeSec ?? 0;
		const maxFaces = Math.min(
			FACE_FX_GPU_MAX_FACES,
			Math.max(1, config.driver?.maxFaces ?? 4),
		);

		try {
			for (const layer of warps) {
				const packed = packWarpFaces(faces, layer.strength, maxFaces);
				if (packed.count === 0) continue;
				const m = this.getWarpMaterial();
				m.uniforms.uFaceCount.value = packed.count;
				m.uniforms.uPreset.value = faceFxWarpPresetId(layer.preset);
				m.uniforms.uTime.value = timeSec;
				m.uniforms.uFaces.value = packed.data;
				run(m);
			}

			for (const layer of rays) {
				const packed = packEyeRays(faces, maxFaces);
				if (packed.count === 0) continue;
				const m = this.getRayMaterial();
				m.uniforms.uRayCount.value = packed.count;
				m.uniforms.uRays.value = packed.data;
				m.uniforms.uColor.value = parseHexColor(layer.color);
				m.uniforms.uLength.value = Math.max(0.01, layer.length * 0.15);
				m.uniforms.uWidth.value = Math.max(0.001, layer.width * 2.5);
				run(m);
			}

			if (proceduralEars) {
				const packed = packEarAnchors(faces, maxFaces);
				if (packed.count > 0) {
					const m = this.getEarsMaterial();
					m.uniforms.uEarCount.value = packed.count;
					m.uniforms.uEars.value = packed.data;
					m.uniforms.uEarColor.value = new THREE.Color("#f2a6c8");
					run(m);
				}
			}
		} finally {
			renderer.setRenderTarget(prevTarget);
			renderer.setViewport(this.prevViewport);
			renderer.setScissorTest(prevScissorTest);
			renderer.autoClear = prevAutoClear;
			for (const mat of [this.warpMaterial, this.rayMaterial, this.earsMaterial]) {
				if (mat) mat.uniforms.tInput.value = null;
			}
		}

		pair.lastUsed = now();
		return src;
	}

	trim(maxIdleMs: number): void {
		const t = now();
		for (const [key, pair] of this.pools) {
			if (t - pair.lastUsed >= maxIdleMs) {
				pair.a.dispose();
				pair.b.dispose();
				this.pools.delete(key);
			}
		}
	}

	dispose(): void {
		for (const pair of this.pools.values()) {
			pair.a.dispose();
			pair.b.dispose();
		}
		this.pools.clear();
		this.warpMaterial?.dispose();
		this.rayMaterial?.dispose();
		this.earsMaterial?.dispose();
		this.warpMaterial = this.rayMaterial = this.earsMaterial = null;
		this.mesh.geometry.dispose();
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
		this.warpMaterial ??= makeMaterial(FACE_FX_WARP_FRAGMENT_SHADER, {
			tInput: { value: null },
			uFaceCount: { value: 0 },
			uPreset: { value: 0 },
			uTime: { value: 0 },
			uFaces: { value: new Float32Array(FACE_FX_GPU_MAX_FACES * 4) },
		});
		return this.warpMaterial;
	}

	private getRayMaterial(): THREE.ShaderMaterial {
		this.rayMaterial ??= makeMaterial(FACE_FX_RAY_FRAGMENT_SHADER, {
			tInput: { value: null },
			uRayCount: { value: 0 },
			uRays: { value: new Float32Array(FACE_FX_GPU_MAX_FACES * 2 * 4) },
			uColor: { value: new THREE.Color("#ff0033") },
			uLength: { value: 0.35 },
			uWidth: { value: 0.012 },
		});
		return this.rayMaterial;
	}

	private getEarsMaterial(): THREE.ShaderMaterial {
		this.earsMaterial ??= makeMaterial(FACE_FX_EARS_FRAGMENT_SHADER, {
			tInput: { value: null },
			uEarCount: { value: 0 },
			uEars: { value: new Float32Array(FACE_FX_GPU_MAX_FACES * 4) },
			uEarColor: { value: new THREE.Color("#f2a6c8") },
		});
		return this.earsMaterial;
	}
}

const passes = new WeakMap<THREE.WebGLRenderer, FaceFxGpu>();

/**
 * Apply face-fx layers to `inputTexture`. Returns output texture (draw immediately)
 * or `null` when there is nothing to do (caller keeps the below composite).
 */
export function applyFaceFxPass(
	params: ApplyFaceFxPassParams,
): THREE.Texture | null {
	let gpu = passes.get(params.renderer);
	if (!gpu) {
		gpu = new FaceFxGpu();
		passes.set(params.renderer, gpu);
	}
	return gpu.apply(params);
}

export function trimFaceFxPass(
	renderer: THREE.WebGLRenderer,
	maxIdleMs = POOL_IDLE_MS,
): void {
	passes.get(renderer)?.trim(maxIdleMs);
}

export function disposeFaceFxPass(renderer: THREE.WebGLRenderer): void {
	passes.get(renderer)?.dispose();
	passes.delete(renderer);
}
