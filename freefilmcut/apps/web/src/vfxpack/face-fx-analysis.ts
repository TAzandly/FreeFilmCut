/**
 * Face FX analysis: downscale below composite → MediaPipe faces.
 * Reuses beauty face detection (no skin segmentation).
 */

import * as THREE from "three";
import {
	detectBeautyFaces,
	type BeautyFaceDetection,
} from "@/beauty/analysis/face-body-analysis";
import type { FaceLandmarks } from "@/beauty/analysis/types";
import { setMediapipeFacialTransformationMatrixes } from "@/beauty/analysis/mediapipe-face";
import type { FaceFxConfig } from "@/vfxpack/face-fx";

export const FACE_FX_ANALYSIS_MAX_EDGE = 720;
export const FACE_FX_ANALYSIS_THROTTLE_MS = 50;

type CacheEntry = {
	at: number;
	faces: FaceLandmarks[];
};

const latestByKey = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FaceLandmarks[]>>();
let rgbaScratch: THREE.WebGLRenderTarget | null = null;
let lastMatrixMode: boolean | null = null;

function ensureRgbaRt(
	width: number,
	height: number,
): THREE.WebGLRenderTarget {
	if (
		rgbaScratch &&
		rgbaScratch.width === width &&
		rgbaScratch.height === height
	) {
		return rgbaScratch;
	}
	rgbaScratch?.dispose();
	rgbaScratch = new THREE.WebGLRenderTarget(width, height, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		depthBuffer: false,
		stencilBuffer: false,
		generateMipmaps: false,
	});
	rgbaScratch.texture.flipY = false;
	return rgbaScratch;
}

/** Blit a GPU texture into a CPU ImageBitmap (or canvas) for MediaPipe. */
export async function snapshotTextureForFaceFx({
	renderer,
	texture,
	width,
	height,
	maxEdge = FACE_FX_ANALYSIS_MAX_EDGE,
}: {
	renderer: THREE.WebGLRenderer;
	texture: THREE.Texture;
	width: number;
	height: number;
	maxEdge?: number;
}): Promise<ImageBitmap | HTMLCanvasElement | null> {
	if (!(width > 0 && height > 0)) return null;
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));

	const rt = ensureRgbaRt(w, h);
	const prev = renderer.getRenderTarget();
	const prevAutoClear = renderer.autoClear;
	try {
		// Fullscreen blit via WebGLRenderer.copyTextureToTexture is limited;
		// use a one-shot scene blit through setRenderTarget + render.
		const scene = new THREE.Scene();
		const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		const mat = new THREE.MeshBasicMaterial({
			map: texture,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
		});
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
		mesh.frustumCulled = false;
		scene.add(mesh);
		renderer.autoClear = true;
		renderer.setRenderTarget(rt);
		renderer.clear();
		renderer.render(scene, cam);
		mat.dispose();
		mesh.geometry.dispose();

		const pixels = new Uint8Array(w * h * 4);
		renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
		// GL is bottom-up; flip for MediaPipe (top-left origin).
		const flipped = new Uint8ClampedArray(w * h * 4);
		const row = w * 4;
		for (let y = 0; y < h; y++) {
			const src = (h - 1 - y) * row;
			flipped.set(pixels.subarray(src, src + row), y * row);
		}
		const imageData = new ImageData(flipped, w, h);
		if (typeof createImageBitmap === "function") {
			return await createImageBitmap(imageData);
		}
		if (typeof document === "undefined") return null;
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.putImageData(imageData, 0, 0);
		return canvas;
	} catch {
		return null;
	} finally {
		renderer.setRenderTarget(prev);
		renderer.autoClear = prevAutoClear;
	}
}

export async function detectFacesForFaceFx(
	image: ImageBitmap | HTMLCanvasElement,
	config: FaceFxConfig,
): Promise<FaceLandmarks[]> {
	const wantMatrix = config.driver?.transformationMatrix !== false;
	if (lastMatrixMode !== wantMatrix) {
		setMediapipeFacialTransformationMatrixes(wantMatrix);
		lastMatrixMode = wantMatrix;
	}
	const detection: BeautyFaceDetection = await detectBeautyFaces(image);
	const maxFaces = Math.max(1, Math.min(8, config.driver?.maxFaces ?? 4));
	return detection.faces.slice(0, maxFaces);
}

/**
 * Throttled face-fx analysis for a pack clip. Returns the newest faces
 * immediately (possibly stale); kicks a refresh in the background.
 */
export function requestFaceFxFaces({
	key,
	renderer,
	texture,
	width,
	height,
	config,
	onReady,
}: {
	key: string;
	renderer: THREE.WebGLRenderer;
	texture: THREE.Texture;
	width: number;
	height: number;
	config: FaceFxConfig;
	onReady?: () => void;
}): FaceLandmarks[] {
	const cached = latestByKey.get(key);
	const t = typeof performance !== "undefined" ? performance.now() : Date.now();
	if (!inflight.has(key)) {
		const start =
			!cached || t - cached.at >= FACE_FX_ANALYSIS_THROTTLE_MS
				? Promise.resolve()
						.then(() =>
							snapshotTextureForFaceFx({
								renderer,
								texture,
								width,
								height,
							}),
						)
						.then(async (image) => {
							if (!image) return cached?.faces ?? [];
							try {
								return await detectFacesForFaceFx(image, config);
							} finally {
								if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
									image.close();
								}
							}
						})
				: null;
		if (start) {
			const p = start
				.then((faces) => {
					latestByKey.set(key, { at: Date.now(), faces });
					if (latestByKey.size > 48) {
						const first = latestByKey.keys().next().value;
						if (first) latestByKey.delete(first);
					}
					onReady?.();
					return faces;
				})
				.finally(() => {
					inflight.delete(key);
				});
			inflight.set(key, p);
		}
	}
	return cached?.faces ?? [];
}

export function clearFaceFxAnalysis(key?: string): void {
	if (key) {
		latestByKey.delete(key);
		inflight.delete(key);
		return;
	}
	latestByKey.clear();
	inflight.clear();
}

export function disposeFaceFxAnalysisScratch(): void {
	rgbaScratch?.dispose();
	rgbaScratch = null;
}
