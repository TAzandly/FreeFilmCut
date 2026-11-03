import "@/vfxpack/troika-preconfig";
import * as THREE from "three";
import {
	incrementCounter,
	isRenderPerfEnabled,
} from "@/diagnostics/render-perf";
import type {
	ExternalTextureDescriptor,
	FrameDescriptor,
	FrameItemDescriptor,
	QuadTransformDescriptor,
	RenderedTextureDescriptor,
	TextureUploadDescriptor,
} from "./types";
import {
	buildPackScene,
	disposeBuiltPackScene,
	getPackRegistrySnapshot,
	subscribePackRegistry,
	buildPackComposer,
	packComposerSignature,
	applyPackComposerParams,
	applyExposedMaterialParams,
	applyExposedTextParams,
	stackHasEnabledEffects,
	applyGlobalScreenParams,
	applyGlobalScreenParamsToObject3D,
	applyAnimToRoot,
	samplePackTimeline,
	timelineAssetHasVideoTracks,
	type FreecapcutAnimClip,
	PACK_SCENE_BUILD_REV,
	bindTransitionInputTextures,
	normalizeVfxPackType,
	type BuiltPackScene,
	type BuiltPostProcess,
} from "@/vfxpack";
import {
	getPackVideoPreviewPlaying,
	seekPackTimelineVideo,
	syncPackVideos,
} from "@/vfxpack/pack-video";
import type { ParamValues } from "@/params";
import { resolveAppliedStickerPose } from "@/vfxpack/sticker-motion";
import {
	applyActiveTextAnimPack,
	applyTextPoseToFlowerProps,
	assertTextAnimOriginalsHidden,
	resolveActiveTextAnimPack,
	samplePackPostProcess,
} from "@/vfxpack/textanim/apply-pack";

function readStickerPlacement(params: ParamValues | null | undefined): {
	scaleX: number;
	scaleY: number;
	positionX: number;
	positionY: number;
	rotate: number;
} {
	const read = (key: string, fallback: number) => {
		const value = params?.[key];
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	};
	return {
		scaleX: read("transform.scaleX", 1),
		scaleY: read("transform.scaleY", 1),
		positionX: read("transform.positionX", 0),
		positionY: read("transform.positionY", 0),
		rotate: read("transform.rotate", 0),
	};
}
import { parseVfxPackIdFromEffectType } from "@/vfxpack/effect-id";
import {
	BELOW_INPUT_UNIFORM_NAMES,
	packNeedsBelowInput,
} from "@/vfxpack/below-input";
import {
	buildSyntheticFlowerTextPack,
	TIMELINE_FLOWER_TEXT_PACK_PREFIX,
	type TimelineFlowerTextProps,
} from "@/vfxpack/timeline-flower-text";
import { bumpFlowerTextFrameEpoch } from "@/vfxpack/flower-text-epoch";
import type { LoadedVfxPack } from "@/vfxpack/types";
import {
	UI_CAMERA_LAYER,
	createUIOverlayCamera,
	renderUIOverlay,
	prepareCameraModeUI,
	getFccUI,
	isUIText,
	restoreCameraModeUI,
	packHasUIMode,
	RENDER_MODE_OVERLAY,
} from "@/vfxpack/ui-overlay";
import {
	ensureTextLayerRenderTarget,
	renderTextLayerToTarget,
	textLayerCompositeSource,
} from "@/vfxpack/text-layer-rt";
import {
	aabbToCenteredOrthoView,
	mapAabbToDestRect,
	resolveTextLayerRtRect,
	bloomPadPxFromPackTracks,
	measureOverlayTextInkAabb,
	type TextLayerAabb,
} from "@/vfxpack/text-layer-aabb";
import { isCompositorAntialiasEnabled } from "./antialias-setting";

/**
 * FreeFilmCut Three.js blit compositor (MVP).
 * - Orthographic textured-quad blit for FrameDescriptor layers
 * - Timeline .vfxpack sceneEffect clips rendered in track order
 * - filter/effect + scope below: snapshot accum 鈫?bind uInput/belowInput/iChannel0
 * - Optional activeOverlayIds still drawn last as a peek
 *
 * Toggle via NEXT_PUBLIC_USE_THREE (default ON). Set to "0" for wasm fallback.
 */

type RenderedCacheEntry = {
	kind: "rendered";
	canvas: OffscreenCanvas;
	texture: THREE.CanvasTexture;
	contentHash: string;
	width: number;
	height: number;
};

type ExternalCacheEntry = {
	kind: "external";
	source: CanvasImageSource;
	texture: THREE.Texture;
	width: number;
	height: number;
};

type TextureCacheEntry = RenderedCacheEntry | ExternalCacheEntry;


/** Editor Config default is NeutralToneMapping (key value 7 in three r15x+/r18x). */
function resolvePackOutputToneMapping(
	payload: { output?: { toneMapping?: string | number }; toneMapping?: string | number } | null | undefined,
): THREE.ToneMapping {
	const raw =
		payload?.output?.toneMapping ??
		payload?.toneMapping ??
		"neutral";
	if (typeof raw === "number" && Number.isFinite(raw)) {
		// 0 === NoToneMapping in three; keep none as none (do not fall through to Neutral).
		if (raw === 0) return THREE.NoToneMapping;
		return raw as THREE.ToneMapping;
	}
	const key = String(raw).toLowerCase();
	switch (key) {
		case "none":
		case "notonemapping":
		case "0":
			return THREE.NoToneMapping;
		case "linear":
			return THREE.LinearToneMapping;
		case "reinhard":
			return THREE.ReinhardToneMapping;
		case "cineon":
			return THREE.CineonToneMapping;
		case "aces":
		case "acesfilmic":
			return THREE.ACESFilmicToneMapping;
		case "agx":
			return THREE.AgXToneMapping;
		case "neutral":
		default:
			return THREE.NeutralToneMapping;
	}
}

function resolvePackOutputExposure(
	payload: { output?: { toneMappingExposure?: number }; toneMappingExposure?: number } | null | undefined,
): number {
	const v = payload?.output?.toneMappingExposure ?? payload?.toneMappingExposure;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : 1;
}


class ThreeCompositor {
	private renderer: THREE.WebGLRenderer | null = null;
	private scene: THREE.Scene | null = null;
	private camera: THREE.OrthographicCamera | null = null;
	private initializedSize: { width: number; height: number } | null = null;
	private cache = new Map<string, TextureCacheEntry>();
	private layerMeshes: THREE.Mesh[] = [];
	private layerPool: THREE.Mesh[] = [];
	private packScenes = new Map<string, BuiltPackScene>();
	/** Synthetic Troika flower-text scenes for timeline TextElements. */
	private flowerTextScenes = new Map<
		string,
		{
			built: BuiltPackScene;
			hash: string;
			pack: LoadedVfxPack;
			/** Stable tight-RT cache: expand-only ink + pack-max bloom pad (no per-frame realloc). */
			rtCache?: {
				key: string;
				ink: import("@/vfxpack/text-layer-aabb").TextLayerAabb;
				rect: import("@/vfxpack/text-layer-aabb").TextLayerAabb;
				padPx: number;
			};
		}
	>();
	private flowerTextBuildInFlight = new Set<string>();
	/** Shared Text-layer RT (plain + flower). stencilBuffer required for inner shadow. */
	private textLayerRT: THREE.WebGLRenderTarget | null = null;
	/** Cache for shared-registry Text Fx composers (per compositor). */
	private textFxCache: import("@/vfxpack/postprocess").TextureFxCache = { built: null };
	private lastFrameFlowerTextIds = new Set<string>();
	/** Shared ortho camera for Screen-Space UI (layer 1), after PP. */
	private uiOverlayCamera: THREE.OrthographicCamera | null = null;
	/** Ortho beauty cam for timeline text pack-PP (matches canvas px; not pack default 16:9 perspective). */
	private flowerPpOrtho: THREE.OrthographicCamera | null = null;
	private packComposers = new Map<string, BuiltPostProcess>();
	private packBuildInFlight = new Set<string>();
	/** Track LoadedVfxPack identity so re-import rebuilds GPU scene. */
	private packSource = new Map<string, unknown>();
	private unsubscribePacks: (() => void) | null = null;
	/** Pack ids referenced by the latest frame (timeline clips). */
	private lastFramePackIds = new Set<string>();

	/** Offscreen accum for stack compose + below-input snapshots. */
	private accumRT: THREE.WebGLRenderTarget | null = null;
	private belowSourceRT: THREE.WebGLRenderTarget | null = null;
	/** Ping-pong target: render packs here while sampling accum/below. */
	private packRT: THREE.WebGLRenderTarget | null = null;
	/** Sticker packs render here at their own resolution, then contain onto the canvas. */
	private stickerRT: THREE.WebGLRenderTarget | null = null;
	/** Stable uInput source: blit of full accum (all layers below). */
	private belowFbTex: THREE.FramebufferTexture | null = null;
	private belowDebugFrames = 0;
	/** Last below-composite texture bound as uInput. */
	private lastBelowTexture: THREE.Texture | null = null;
	private blitScene: THREE.Scene | null = null;
	private blitCamera: THREE.OrthographicCamera | null = null;
	/** RT鈫扲T copy (raw sample, no color-mgmt). */
	private blitMaterial: THREE.ShaderMaterial | null = null;
	/** Final present to canvas 鈥?MeshBasic handles sRGB output. */
	private presentMaterial: THREE.MeshBasicMaterial | null = null;
	private blitMesh: THREE.Mesh | null = null;
	/** 4x MSAA beauty target. Compose targets stay single-sample so below-input copy still works. */
	private msaaRT: THREE.WebGLRenderTarget | null = null;
	private msaaUnavailable = false;
	private clearScratch = new THREE.Color();
	/** Save/restore around tight text RT / pack PP so video layers keep full viewport. */
	private viewportScratch = new THREE.Vector4();
	private scissorScratch = new THREE.Vector4();

	ensureInitialized({ width, height }: { width: number; height: number }) {
		if (!this.renderer) {
			const renderer = new THREE.WebGLRenderer({
				antialias: false,
				alpha: true,
				premultipliedAlpha: false,
				preserveDrawingBuffer: true,
				powerPreference: "high-performance",
				stencil: true,
			});
			// Match editor: working linear, display sRGB. Bloom/OutputPass assume this.
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.toneMappingExposure = 1;
			renderer.setClearColor(0x000000, 1);
			renderer.autoClear = true;
			renderer.setPixelRatio(1);
			renderer.setSize(width, height, false);

			const scene = new THREE.Scene();
			// Match canvas Y-down coordinate space used by FrameDescriptor.
			const camera = new THREE.OrthographicCamera(
				0,
				width,
				0,
				height,
				-1000,
				1000,
			);
			camera.position.z = 10;
			camera.updateProjectionMatrix();

			this.renderer = renderer;
			this.scene = scene;
			this.camera = camera;
			this.initializedSize = { width, height };
			this.ensureComposeTargets(width, height);
			this.ensureBlitPass();

			if (!this.unsubscribePacks) {
				this.unsubscribePacks = subscribePackRegistry(() => {
					this.syncPackScenes();
				});
				this.syncPackScenes();
			}
			return;
		}

		if (
			!this.initializedSize ||
			this.initializedSize.width !== width ||
			this.initializedSize.height !== height
		) {
			this.renderer.setSize(width, height, false);
			if (this.camera) {
				this.camera.left = 0;
				this.camera.right = width;
				this.camera.top = 0;
				this.camera.bottom = height;
				this.camera.updateProjectionMatrix();
			}
			this.initializedSize = { width, height };
			this.ensureComposeTargets(width, height);
			this.ensureBlitPass();
			this.updatePackCameraAspects(width, height);
		}
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.renderer) {
			throw new Error("Three compositor is not initialized");
		}
		return this.renderer.domElement;
	}

	syncTextures(textures: TextureUploadDescriptor[]) {
		const nextIds = new Set(textures.map((texture) => texture.id));
		for (const previousId of this.cache.keys()) {
			if (!nextIds.has(previousId)) {
				const entry = this.cache.get(previousId);
				entry?.texture.dispose();
				this.cache.delete(previousId);
			}
		}

		for (const texture of textures) {
			if (texture.kind === "external") {
				this.syncExternalTexture(texture);
			} else {
				this.syncRenderedTexture(texture);
			}
		}
	}

	render(frame: FrameDescriptor) {
		this.ensureInitialized({ width: frame.width, height: frame.height });
		const renderer = this.renderer;
		const scene = this.scene;
		const camera = this.camera;
		const accumRT = this.accumRT;
		if (!renderer || !scene || !camera || !accumRT) {
			throw new Error("Three compositor is not initialized");
		}

		const [r, g, b, a] = frame.clear.color;
		renderer.setRenderTarget(accumRT);
		renderer.setClearColor(new THREE.Color(r, g, b), a);
		renderer.autoClear = true;
		renderer.clear();

		this.clearLayerMeshes();

		const framePackIds = new Set<string>();
		this.lastFrameFlowerTextIds = new Set<string>();
		let z = 0;
		let didDraw = false;
		let layersBelow = 0;

		/** Composite one media layer onto accum (bottom → top), so uInput sees full stack. */
		const compositeOneLayer = (
			item: Extract<FrameItemDescriptor, { type: "layer" }>,
		) => {
			this.clearLayerMeshes();
			this.addLayerMesh(item, z);
			z += 1;
			if (this.layerMeshes.length === 0) return;
			renderer.setRenderTarget(accumRT);
			// Tight text RT must not leave a small viewport; video/image need full accum.
			renderer.setViewport(0, 0, accumRT.width, accumRT.height);
			renderer.setScissorTest(false);
			renderer.autoClear = false;
			renderer.render(scene, camera);
			didDraw = true;
			layersBelow += 1;
			this.clearLayerMeshes();
		};

		for (const item of frame.items) {
			if (item.type === "sceneEffect") {
				const packId = parseVfxPackIdFromEffectType({
					effectType: item.effectType,
				});
				if (packId) {
					framePackIds.add(packId);
					// accum holds the FULL blend of every layer below this pack
					this.renderOnePack({
						packId,
						width: frame.width,
						height: frame.height,
						clearFirst: !didDraw,
						target: accumRT,
						layersBelowCount: layersBelow,
						liveParams: item.effectParams,
						clipLocalTime: item.clipLocalTime ?? 0,
						clipDurationSec: item.clipDurationSec ?? 0,
						stickerAnims: item.stickerAnims,
					});
					didDraw = true;
					renderer.autoClear = false;
					// Pack result becomes part of the stack for anything above
					layersBelow += 1;
					continue;
				}
				// Built-in scene effects (blur etc.): still no-op in Three MVP.
				continue;
			}

			if (item.type === "transition") {
				framePackIds.add(item.packId);
				const fromEntry = this.cache.get(item.fromTextureId);
				const toEntry = this.cache.get(item.toTextureId);
				this.renderOnePack({
					packId: item.packId,
					width: frame.width,
					height: frame.height,
					clearFirst: !didDraw,
					target: accumRT,
					layersBelowCount: layersBelow,
					clipLocalTime: item.packTimelineTimeSec,
					transitionInputs:
						fromEntry && toEntry
							? { texFrom: fromEntry.texture, texTo: toEntry.texture }
							: null,
				});
				didDraw = true;
				renderer.autoClear = false;
				layersBelow += 1;
				continue;
			}

			// "flowerText" covers all timeline TextNode (plain + flower) via Text→RT→blit.
			if (item.type === "flowerText") {
				this.lastFrameFlowerTextIds.add(item.elementId);
				const drew = this.renderOneFlowerText({
					item,
					width: frame.width,
					height: frame.height,
					clearFirst: !didDraw,
					target: accumRT,
				});
				if (drew) {
					didDraw = true;
					renderer.autoClear = false;
					layersBelow += 1;
				}
				continue;
			}

			compositeOneLayer(item);
		}
		if (!didDraw) {
			renderer.setRenderTarget(accumRT);
			renderer.clear();
		}

		this.lastFramePackIds = framePackIds;
		this.syncPackScenes();
		this.pruneFlowerTextScenes();

		// Optional force-overlay peek (packs toggled On in Effects panel).
		this.renderForcedOverlays({
			width: frame.width,
			height: frame.height,
			skipIds: framePackIds,
			target: accumRT,
		});

		// Present accum 鈫?canvas
		this.presentAccum();

		if (isRenderPerfEnabled()) {
			incrementCounter({ name: "threeBlitFrames" });
		}
	}


	private presentAccum() {
		const renderer = this.renderer;
		const accumRT = this.accumRT;
		if (!renderer || !accumRT) return;
		// Quality / size changes dispose blit inside ensureComposeTargets; rebuild if missing.
		if (!this.blitScene || !this.blitMesh || !this.presentMaterial) {
			this.ensureBlitPass();
		}
		const blitScene = this.blitScene;
		const blitCamera = this.blitCamera;
		const blitMesh = this.blitMesh;
		const presentMaterial = this.presentMaterial;
		if (!blitScene || !blitCamera || !blitMesh || !presentMaterial) {
			return;
		}
		const prevMat = blitMesh.material;
		blitMesh.material = presentMaterial;
		presentMaterial.map = accumRT.texture;
		presentMaterial.needsUpdate = true;
		renderer.getViewport(this.viewportScratch);
		renderer.getScissor(this.scissorScratch);
		const prevScissorTest = renderer.getScissorTest();
		const cw = Math.max(1, renderer.domElement.width || accumRT.width);
		const ch = Math.max(1, renderer.domElement.height || accumRT.height);
		renderer.setRenderTarget(null);
		renderer.setViewport(0, 0, cw, ch);
		renderer.setScissorTest(false);
		renderer.autoClear = true;
		renderer.setClearColor(0x000000, 1);
		renderer.render(blitScene, blitCamera);
		renderer.autoClear = true;
		renderer.setViewport(this.viewportScratch);
		renderer.setScissor(this.scissorScratch);
		renderer.setScissorTest(prevScissorTest);
		blitMesh.material = prevMat;
		presentMaterial.map = null;
	}

	private ensureStickerTarget(width: number, height: number): THREE.WebGLRenderTarget {
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		if (this.stickerRT && this.stickerRT.width === w && this.stickerRT.height === h) {
			return this.stickerRT;
		}
		this.stickerRT?.dispose();
		const rt = new THREE.WebGLRenderTarget(w, h, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			type: THREE.UnsignedByteType,
			depthBuffer: true,
			stencilBuffer: true,
		});
		rt.texture.colorSpace = THREE.SRGBColorSpace;
		rt.texture.flipY = false;
		rt.texture.generateMipmaps = false;
		this.stickerRT = rt;
		return rt;
	}

	private ensureComposeTargets(width: number, height: number) {
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		const needNew =
			!this.accumRT ||
			this.accumRT.width !== w ||
			this.accumRT.height !== h ||
			this.accumRT.texture.type !== THREE.HalfFloatType ||
			!this.packRT ||
			this.packRT.texture.type !== THREE.HalfFloatType;
		if (!needNew) return;

		this.accumRT?.dispose();
		this.belowSourceRT?.dispose();
		this.packRT?.dispose();
		this.stickerRT?.dispose();
		this.stickerRT = null;
		// Drop blit so HalfFloat/no-dither fragment is rebuilt after target type change.
		if (this.blitMesh) {
			this.blitMesh.geometry.dispose();
			const material = this.blitMesh.material;
			if (Array.isArray(material)) {
				for (const entry of material) entry.dispose();
			} else {
				material.dispose();
			}
		}
		this.presentMaterial?.dispose();
		this.blitScene = null;
		this.blitCamera = null;
		this.blitMaterial = null;
		this.presentMaterial = null;
		this.blitMesh = null;
		this.textLayerRT?.dispose();
		this.textLayerRT = null;
		this.textFxCache.built?.dispose();
		this.textFxCache.built = null;
		for (const id of [...this.flowerTextScenes.keys()]) {
			this.disposeFlowerTextEntry(id);
		}
		this.belowFbTex?.dispose();

		const opts: THREE.RenderTargetOptions = {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			// Match editor Texture FX: HalfFloat through compose so soft bloom
			// is not quantized before present. Final canvas is still 8-bit.
			type: THREE.HalfFloatType,
			depthBuffer: true,
			stencilBuffer: true,
		};
		const makeRT = (
			withDepth: boolean,
			type: THREE.TextureDataType = THREE.HalfFloatType,
		) => {
			const rt = new THREE.WebGLRenderTarget(w, h, {
				...opts,
				type,
				depthBuffer: withDepth,
			});
			// Keep sRGB so MeshBasic present matches video.
			// Do NOT mutate colorSpace/flipY later - that can invalidate sampling.
			rt.texture.colorSpace = THREE.SRGBColorSpace;
			rt.texture.flipY = false;
			rt.texture.generateMipmaps = false;
			return rt;
		};
		this.accumRT = makeRT(true);
		this.belowSourceRT = makeRT(false);
		// Same HalfFloat as accum: bloom soft halo survives packRT -> accum blit.
		this.packRT = makeRT(true, THREE.HalfFloatType);
		// Optional RGBA8 fallback only; preferred uInput path is RT blit (HalfFloat).
		const fb = new THREE.FramebufferTexture(w, h);
		fb.colorSpace = THREE.SRGBColorSpace;
		fb.minFilter = THREE.LinearFilter;
		fb.magFilter = THREE.LinearFilter;
		fb.generateMipmaps = false;
		this.belowFbTex = fb;
		// Blit/present were disposed above with the old RTs.
		this.ensureBlitPass();
	}

	private ensureBlitPass() {
		if (this.blitScene && this.blitMaterial?.uniforms.uResolution) return;
		if (this.blitMesh) {
			this.blitMesh.geometry.dispose();
			const material = this.blitMesh.material;
			if (Array.isArray(material)) {
				for (const entry of material) entry.dispose();
			} else {
				material.dispose();
			}
		}
		this.presentMaterial?.dispose();
		this.blitScene = null;
		const scene = new THREE.Scene();
		const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
		const material = new THREE.ShaderMaterial({
			uniforms: {
				tDiffuse: { value: null as THREE.Texture | null },
				uFlipY: { value: 0 },
				uScale: { value: new THREE.Vector2(1, 1) },
				uOffset: { value: new THREE.Vector2(0, 0) },
				uRotate: { value: 0 },
				uResolution: { value: new THREE.Vector2(1, 1) },
				uOpacity: { value: 1 },
			},
			vertexShader: /* glsl */ `
				uniform vec2 uScale;
				uniform vec2 uOffset;
				uniform float uRotate;
				uniform vec2 uResolution;
				varying vec2 vUv;
				void main() {
					vUv = uv;
					vec2 safeRes = max(uResolution, vec2(1.0));
					vec2 localPx = position.xy * uScale * safeRes * 0.5;
					float c = cos(uRotate);
					float s = sin(uRotate);
					localPx = vec2(c * localPx.x - s * localPx.y, s * localPx.x + c * localPx.y);
					vec2 ndc = localPx / (safeRes * 0.5) + uOffset;
					gl_Position = vec4(ndc, 0.0, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				uniform sampler2D tDiffuse;
				uniform float uFlipY;
				uniform float uOpacity;
				varying vec2 vUv;
				void main() {
					vec2 uv = uFlipY > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
					gl_FragColor = texture2D(tDiffuse, uv) * uOpacity;
				}
			`,
			depthTest: false,
			depthWrite: false,
			transparent: false,
			toneMapped: false,
		});
		const presentMaterial = new THREE.MeshBasicMaterial({
			map: null,
			depthTest: false,
			depthWrite: false,
			transparent: false,
			toneMapped: false,
		});
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
		scene.add(mesh);
		this.blitScene = scene;
		this.blitCamera = camera;
		this.blitMaterial = material;
		this.presentMaterial = presentMaterial;
		this.blitMesh = mesh;
	}

	private ensureMsaaTarget(width: number, height: number): THREE.WebGLRenderTarget | null {
		const renderer = this.renderer;
		if (!renderer || this.msaaUnavailable) return null;
		if (!isCompositorAntialiasEnabled()) return null;
		const maxSamples = renderer.capabilities?.maxSamples ?? 0;
		const samples = maxSamples > 1 ? Math.min(4, maxSamples) : 0;
		if (samples <= 1) {
			this.msaaUnavailable = true;
			return null;
		}
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		if (
			this.msaaRT &&
			this.msaaRT.width === w &&
			this.msaaRT.height === h &&
			this.msaaRT.samples === samples
		) {
			return this.msaaRT;
		}
		this.msaaRT?.dispose();
		const rt = new THREE.WebGLRenderTarget(w, h, {
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			type: THREE.UnsignedByteType,
			depthBuffer: true,
			stencilBuffer: true,
			samples,
		});
		rt.texture.colorSpace = THREE.SRGBColorSpace;
		rt.texture.flipY = false;
		rt.texture.generateMipmaps = false;
		renderer.initRenderTarget(rt);
		const gl = renderer.getContext() as WebGL2RenderingContext;
		const props = renderer.properties.get(rt) as {
			__webglMultisampledFramebuffer?: WebGLFramebuffer;
		};
		const fb = props.__webglMultisampledFramebuffer;
		let complete = false;
		if (fb) {
			const state = renderer.state as unknown as {
				bindFramebuffer: (
					target: number,
					framebuffer: WebGLFramebuffer | null,
				) => void;
			};
			state.bindFramebuffer(gl.FRAMEBUFFER, fb);
			complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
			state.bindFramebuffer(gl.FRAMEBUFFER, null);
		}
		if (!complete) {
			rt.dispose();
			this.msaaRT = null;
			this.msaaUnavailable = true;
			return null;
		}
		this.msaaRT = rt;
		return rt;
	}

	/**
	 * Draw root into target. MSAA renders into a cleared buffer, then copies
	 * the resolved image back. The previous frame is not kept in that buffer,
	 * so moving objects do not leave trails.
	 */
	private renderObjectAntialiased({
		root,
		camera,
		target,
		replace,
		width,
		height,
		allowMsaa = true,
	}: {
		root: THREE.Object3D;
		camera: THREE.Camera;
		target: THREE.WebGLRenderTarget;
		replace: boolean;
		width: number;
		height: number;
		allowMsaa?: boolean;
	}) {
		const renderer = this.renderer;
		if (!renderer) return;
		const msaa = allowMsaa ? this.ensureMsaaTarget(width, height) : null;
		const prevAuto = renderer.autoClear;
		if (!msaa) {
			renderer.setRenderTarget(target);
			if (replace) {
				renderer.autoClear = true;
				renderer.clear();
			} else {
				renderer.autoClear = false;
				renderer.clearDepth();
			}
			renderer.render(root, camera);
			renderer.autoClear = prevAuto;
			return;
		}
		renderer.getClearColor(this.clearScratch);
		const prevAlpha = renderer.getClearAlpha();
		renderer.setRenderTarget(msaa);
		renderer.setClearColor(0x000000, replace ? 1 : 0);
		renderer.clear(true, true, true);
		renderer.autoClear = true;
		renderer.render(root, camera);
		renderer.autoClear = prevAuto;
		renderer.setClearColor(this.clearScratch, prevAlpha);
		this.blitTextureToTarget({
			source: msaa.texture,
			target,
			flipY: false,
			clear: replace,
			blend: replace ? "replace" : "alpha",
		});
	}

	/** Blit a texture into a render target (or canvas when target is null). */
	private blitTextureToTarget({
		source,
		target,
		flipY = false,
		clear = true,
		clearColor = 0x000000,
		clearAlpha = 1,
		blend = "replace",
		contain,
		placement,
		destRect,
		opacity = 1,
		straightAlphaFromPremul = false,
	}: {
		source: THREE.Texture;
		target: THREE.WebGLRenderTarget | null;
		flipY?: boolean;
		clear?: boolean;
		clearColor?: number;
		clearAlpha?: number;
		blend?: "replace" | "alpha";
		/** Fit source pixels inside the destination without stretching. */
		contain?: {
			sourceWidth: number;
			sourceHeight: number;
			destWidth: number;
			destHeight: number;
		};
		/** Extra placement on top of contain. Scale is a multiplier, position is pixels, rotation is degrees. */
		placement?: {
			scaleX: number;
			scaleY: number;
			positionX: number;
			positionY: number;
			rotate: number;
		};
		/**
		 * Place source as a axis-aligned quad covering destRect in destination
		 * pixels (bottom-left origin). Used by tight text-layer RT blit.
		 */
		destRect?: { x: number; y: number; w: number; h: number } | null;
		/** Multiplies rgb and alpha of the finished picture. */
		opacity?: number;
		/**
		 * Editor Viewport presentComposerToLetterbox: additive bloom leaves
		 * premultiplied-looking rgb with low a; convert to straight alpha for
		 * premultipliedAlpha:false compositing.
		 */
		straightAlphaFromPremul?: boolean;
	}) {
		const renderer = this.renderer;
		const blitScene = this.blitScene;
		const blitCamera = this.blitCamera;
		const blitMaterial = this.blitMaterial;
		if (!renderer || !blitScene || !blitCamera || !blitMaterial) return;

		const blitMesh = this.blitMesh;
		if (!blitMesh) return;
		const prevMat = blitMesh.material;
		const prevTransparent = blitMaterial.transparent;
		const prevBlending = blitMaterial.blending;
		blitMesh.material = blitMaterial;
		blitMaterial.transparent = blend === "alpha" || straightAlphaFromPremul;
		blitMaterial.blending = blend === "alpha" ? THREE.NormalBlending : THREE.NoBlending;
		blitMaterial.uniforms.tDiffuse.value = source;
		blitMaterial.uniforms.uFlipY.value = flipY ? 1 : 0;
		blitMaterial.uniforms.uOpacity.value = opacity;
		const scale = blitMaterial.uniforms.uScale.value as THREE.Vector2;
		const offset = blitMaterial.uniforms.uOffset.value as THREE.Vector2;
		const resolution = blitMaterial.uniforms.uResolution.value as THREE.Vector2;
		const destWidth = contain?.destWidth || target?.width || renderer.domElement.width || 1;
		const destHeight = contain?.destHeight || target?.height || renderer.domElement.height || 1;
		resolution.set(Math.max(1, destWidth), Math.max(1, destHeight));
		if (
			destRect &&
			destRect.w > 0 &&
			destRect.h > 0 &&
			destWidth > 0 &&
			destHeight > 0
		) {
			const dw = Math.max(1, destWidth);
			const dh = Math.max(1, destHeight);
			scale.set(destRect.w / dw, destRect.h / dh);
			const cx = destRect.x + destRect.w * 0.5;
			const cy = destRect.y + destRect.h * 0.5;
			offset.set((cx / dw) * 2 - 1, (cy / dh) * 2 - 1);
			blitMaterial.uniforms.uRotate.value = 0;
		} else if (
			contain &&
			contain.sourceWidth > 0 &&
			contain.sourceHeight > 0 &&
			contain.destWidth > 0 &&
			contain.destHeight > 0
		) {
			const pixel = Math.min(
				contain.destWidth / contain.sourceWidth,
				contain.destHeight / contain.sourceHeight,
			);
			const userScaleX = placement?.scaleX ?? 1;
			const userScaleY = placement?.scaleY ?? 1;
			scale.set(
				((contain.sourceWidth * pixel) / contain.destWidth) * userScaleX,
				((contain.sourceHeight * pixel) / contain.destHeight) * userScaleY,
			);
			const posX = placement?.positionX ?? 0;
			const posY = placement?.positionY ?? 0;
			offset.set((posX * 2) / contain.destWidth, (-posY * 2) / contain.destHeight);
			blitMaterial.uniforms.uRotate.value =
				-((placement?.rotate ?? 0) * Math.PI) / 180;
		} else {
			scale.set(1, 1);
			offset.set(0, 0);
			blitMaterial.uniforms.uRotate.value = 0;
		}
		blitMaterial.uniformsNeedUpdate = true;

		const prevFrag = blitMaterial.fragmentShader;
		if (straightAlphaFromPremul) {
			// Same contract as editor Viewport _blitMat (display-encoded, straight alpha).
			blitMaterial.fragmentShader = /* glsl */ `
				uniform sampler2D tDiffuse;
				uniform float uFlipY;
				uniform float uOpacity;
				varying vec2 vUv;
				void main() {
					vec2 uv = uFlipY > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
					vec4 c = texture2D(tDiffuse, uv);
					vec3 rgb = clamp(c.rgb, 0.0, 1.0);
					float a = clamp(max(c.a, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
					vec3 straight = a > 1e-5 ? rgb / a : vec3(0.0);
					gl_FragColor = vec4(straight, a) * uOpacity;
				}
			`;
			blitMaterial.needsUpdate = true;
		}

		renderer.getViewport(this.viewportScratch);
		renderer.getScissor(this.scissorScratch);
		const prevScissorTestBlit = renderer.getScissorTest();
		const blitW = Math.max(1, target?.width || destWidth);
		const blitH = Math.max(1, target?.height || destHeight);
		renderer.setRenderTarget(target);
		renderer.setViewport(0, 0, blitW, blitH);
		renderer.setScissorTest(false);
		renderer.autoClear = clear;
		if (clear) {
			renderer.setClearColor(clearColor, clearAlpha);
			renderer.clear();
		}
		renderer.render(blitScene, blitCamera);
		renderer.autoClear = false;
		renderer.setViewport(this.viewportScratch);
		renderer.setScissor(this.scissorScratch);
		renderer.setScissorTest(prevScissorTestBlit);
		if (straightAlphaFromPremul) {
			blitMaterial.fragmentShader = prevFrag;
			blitMaterial.needsUpdate = true;
		}
		blitMaterial.uniforms.tDiffuse.value = null;
		(blitMaterial.uniforms.uScale.value as THREE.Vector2).set(1, 1);
		(blitMaterial.uniforms.uOffset.value as THREE.Vector2).set(0, 0);
		blitMaterial.uniforms.uRotate.value = 0;
		blitMaterial.uniforms.uOpacity.value = 1;
		blitMaterial.transparent = prevTransparent;
		blitMaterial.blending = prevBlending;
		blitMesh.material = prevMat;
	}

	/**
	 * Snapshot full accum (all layers below) for uInput.
	 * Prefer HalfFloat RT blit (accumRT -> belowSourceRT) so soft bloom is not
	 * re-quantized through RGBA8 FramebufferTexture. FramebufferTexture remains
	 * a last-resort fallback only (RGBA8; can band). See comments historically
	 * pointing at docs/uinput-black-cube-rootcause.md for the black-uInput case.
	 */
	private snapshotBelowSource(): THREE.Texture | null {
		const renderer = this.renderer;
		const accumRT = this.accumRT;
		const belowFbTex = this.belowFbTex;
		const belowSourceRT = this.belowSourceRT;
		if (!renderer || !accumRT) return null;

		// Preferred: both RTs HalfFloat — no 8-bit round-trip for uInput.
		if (belowSourceRT) {
			this.blitTextureToTarget({
				source: accumRT.texture,
				target: belowSourceRT,
				flipY: false,
				clear: true,
			});
			renderer.initTexture(belowSourceRT.texture);
			this.debugBelowPixels(belowSourceRT.texture, "belowRT");
			this.lastBelowTexture = belowSourceRT.texture;
			return belowSourceRT.texture;
		}

		// Last resort: RGBA8 FramebufferTexture (quantizes; avoid for bloom).
		renderer.setRenderTarget(accumRT);
		if (belowFbTex) {
			renderer.copyFramebufferToTexture(belowFbTex);
			renderer.initTexture(belowFbTex);
			this.lastBelowTexture = belowFbTex;
			return belowFbTex;
		}
		return null;
	}

	/** One-shot proof that below input has non-zero pixels (dev console). */
	private debugBelowPixels(_tex: THREE.Texture, _tag: string) {
		// silenced: was spamming console during playback
	}

		private bindBelowInputTexture({
		built,
		texture,
	}: {
		built: BuiltPackScene;
		texture: THREE.Texture;
	}) {
		const renderer = this.renderer;
		const names =
			built.belowInputUniformNames.length > 0
				? built.belowInputUniformNames
				: [...BELOW_INPUT_UNIFORM_NAMES];

		// Do not mutate texture.flipY / colorSpace on shared GPU textures.
		if (renderer) {
			renderer.initTexture(texture);
		}
		this.lastBelowTexture = texture;

		const applyToMaterial = (mat: THREE.Material | null | undefined) => {
			const shader = mat as THREE.ShaderMaterial;
			if (!shader?.isShaderMaterial || !shader.uniforms) return;
			let touched = false;
			for (const name of names) {
				if (!shader.uniforms[name]) {
					shader.uniforms[name] = { value: texture };
				} else {
					shader.uniforms[name].value = texture;
				}
				touched = true;
			}
			for (const name of BELOW_INPUT_UNIFORM_NAMES) {
				if (shader.uniforms[name]) {
					shader.uniforms[name].value = texture;
					touched = true;
				}
			}
			// Null sibling samplers (e.g. map) make uInput sample black on many GPUs.
			for (const [k, u] of Object.entries(shader.uniforms)) {
				if (!u || u.value) continue;
				if (/map|input|channel|tex|sampler/i.test(k)) {
					u.value = texture;
					touched = true;
				}
			}
			// CommonShader / many Editor defaults sample `map`, not `uInput`.
			// When the author did not supply a map (useMap === false), also feed
			// the below-composite into `map` so those packs show the video.
			const useMapU = shader.uniforms.useMap;
			const mapU = shader.uniforms.map;
			const useMapOn = !!(useMapU && useMapU.value);
			if (mapU && !useMapOn) {
				mapU.value = texture;
				touched = true;
			}
			if (touched) {
				shader.uniformsNeedUpdate = true;
				shader.toneMapped = false;
				if (shader.opacity === undefined || shader.opacity <= 0) {
					shader.opacity = 1;
				}
				if (shader.uniforms.opacity) {
					const o = shader.uniforms.opacity.value;
					if (typeof o === "number" && o <= 0) {
						shader.uniforms.opacity.value = 1;
					}
				}
			}
		};

		built.root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh) return;
			const materials = Array.isArray(mesh.material)
				? mesh.material
				: [mesh.material];
			for (const mat of materials) applyToMaterial(mat);
		});
		// Also bind via uuid map (covers materials not currently on a mesh).
		if (built.materialsByUuid) {
			for (const mat of built.materialsByUuid.values()) {
				applyToMaterial(mat);
			}
		}
	}


	/** Resolve pack type/scope from the registry for below-input decisions. */
	private lookupPackMeta(
		packId: string,
	): { type: string; scope: string } | null {
		const pack = getPackRegistrySnapshot().packs.find((p) => p.id === packId);
		if (!pack) return null;
		return {
			type: String(pack.type || ""),
			scope: String(pack.scope || ""),
		};
	}

	/**
	 * Bind outgoing/incoming cut frames. CanvasTexture is a valid sampler2D.
	 * flipY true matches TextureLoader uploads used by pack materials; these
	 * textures are not also drawn as Y-down layer quads.
	 */
	private bindCutTransitionInputs({
		built,
		transitionInputs,
	}: {
		built: BuiltPackScene;
		transitionInputs?: {
			texFrom: THREE.Texture;
			texTo: THREE.Texture;
		} | null;
	}) {
		if (!transitionInputs) return;
		transitionInputs.texFrom.flipY = true;
		transitionInputs.texTo.flipY = true;
		transitionInputs.texFrom.needsUpdate = true;
		transitionInputs.texTo.needsUpdate = true;
		bindTransitionInputTextures({
			root: built.root,
			materialsByUuid: built.materialsByUuid,
			texFrom: transitionInputs.texFrom,
			texTo: transitionInputs.texTo,
		});
	}

	private renderOnePack({
		packId,
		width,
		height,
		clearFirst,
		target,
		layersBelowCount = 0,
		liveParams = null,
		clipLocalTime = 0,
		clipDurationSec = 0,
		stickerAnims = null,
		transitionInputs = null,
	}: {
		packId: string;
		width: number;
		height: number;
		clearFirst: boolean;
		target: THREE.WebGLRenderTarget | null;
		layersBelowCount?: number;
		liveParams?: ParamValues | null;
		/** Clip-local seconds for sampling pack .anim. */
		clipLocalTime?: number;
		clipDurationSec?: number;
		stickerAnims?: import("@/timeline").StickerAnimAssignment | null;
		/** Outgoing / incoming cut frames. CanvasTextures are valid samplers. */
		transitionInputs?: {
			texFrom: THREE.Texture;
			texTo: THREE.Texture;
		} | null;
	}) {
		const renderer = this.renderer;
		const accumRT = this.accumRT;
		const packRT = this.packRT;
		if (!renderer || !accumRT) return;
		const built = this.packScenes.get(packId);
		if (!built) {
			// Scene still building; kick sync and skip this frame.
			this.ensurePackBuilt(packId);
			if (clearFirst && target) {
				renderer.setRenderTarget(target);
				renderer.clear();
			}
			return;
		}
		const meta = this.lookupPackMeta(packId);
		const nativeSticker =
			normalizeVfxPackType(meta?.type || built.packType) === "sticker";
		const renderW = nativeSticker
			? Math.max(1, built.resolution?.width || width)
			: width;
		const renderH = nativeSticker
			? Math.max(1, built.resolution?.height || height)
			: height;
		if (built.camera instanceof THREE.PerspectiveCamera) {
			built.camera.aspect = renderW / Math.max(1, renderH);
			built.camera.updateProjectionMatrix();
		}
		const samplesBelow = built.belowInputUniformNames.length > 0;
		const needsBelow =
			samplesBelow ||
			built.needsBelowInput ||
			packNeedsBelowInput({
				type: meta?.type || built.packType,
				scope: meta?.scope || built.packScope,
			});

		const prevTone = renderer.toneMapping;
		const prevExposure = renderer.toneMappingExposure;
		if (built.render?.toneMapping !== undefined) {
			renderer.toneMapping = built.render.toneMapping as THREE.ToneMapping;
		}
		if (built.render?.toneMappingExposure !== undefined) {
			renderer.toneMappingExposure = built.render.toneMappingExposure;
		}

		// Stickers keep the pack's own pixels. Other packs use the project canvas.
		applyGlobalScreenParamsToObject3D(built.root, renderW, renderH);
		if (built.materialsByUuid) {
			for (const mat of built.materialsByUuid.values()) {
				applyGlobalScreenParams(mat, renderW, renderH);
			}
		}

		// NLE timelines (when present) drive animation / activation / video tracks.
		// Otherwise fall back to applying all pack .anim clips + free-run pack videos.
		const timelines = built.timelines || [];
		const timelineOwnsVideo = timelines.some((a) =>
			timelineAssetHasVideoTracks(a),
		);
		if (timelines.length > 0) {
			const animByName = new Map<string, FreecapcutAnimClip>();
			for (const clip of built.animClips || []) {
				if (clip?.name) animByName.set(clip.name, clip);
			}
			const nlePlaying = getPackVideoPreviewPlaying();
			for (const asset of timelines) {
				samplePackTimeline({
					root: built.root,
					asset,
					t: clipLocalTime,
					animByName,
					objectsByUuid: built.objectsByUuid,
					animOpts: {
						materialsByUuid: built.materialsByUuid,
						postProcess: built.postProcess,
						objectsByUuid: built.objectsByUuid,
					},
					timelinePlaying: nlePlaying,
					seekVideo: seekPackTimelineVideo,
				});
			}
		} else if (built.animClips && built.animClips.length > 0) {
			for (const clip of built.animClips) {
				applyAnimToRoot(built.root, clip, clipLocalTime, {
					materialsByUuid: built.materialsByUuid,
					postProcess: built.postProcess,
					objectsByUuid: built.objectsByUuid,
				});
			}
		}

		// Blit VideoPlayer → RT. When Timeline owns video tracks, do not free-run
		// every player to clipLocalTime (would fight Timeline seek / audio).
		syncPackVideos(renderer, built.root, clipLocalTime, {
			driveTransport: !timelineOwnsVideo,
		});

		applyExposedMaterialParams({
			materialsByUuid: built.materialsByUuid ?? new Map(),
			exposed: built.exposedParams ?? [],
			liveParams,
		});
		applyExposedTextParams({
			objectsByUuid: built.objectsByUuid,
			exposed: built.exposedParams ?? [],
			liveParams,
		});

		const drawPackTo = (rt: THREE.WebGLRenderTarget | null, opts?: { clearFirst?: boolean; keepDepth?: boolean }) => {
			const clearFirst = opts?.clearFirst ?? true;
			const keepDepth = opts?.keepDepth ?? false;
			this.bindCutTransitionInputs({ built, transitionInputs });
			if (built.postProcess && stackHasEnabledEffects(built.postProcess)) {
				this.renderPackWithPostProcess({
					packId,
					built,
					width: renderW,
					height: renderH,
					target: rt,
					liveParams,
					clearFirst,
					keepDepthClear: keepDepth,
					transitionInputs,
					allowMsaa: !nativeSticker,
				});
				if (rt) {
					this.renderPackUIOverlay({
						built,
						width: renderW,
						height: renderH,
						target: rt,
						allowMsaa: !nativeSticker,
					});
				}
				return;
			}
			if (!rt) return;
			{
				const resW = Math.max(1, built.resolution?.width || renderW);
				const resH = Math.max(1, built.resolution?.height || renderH);
				prepareCameraModeUI({
					root: built.root,
					beautyCam: built.camera,
					resW,
					resH,
				});
				this.renderObjectAntialiased({
					root: built.root,
					camera: built.camera,
					target: rt,
					replace: clearFirst,
					width: renderW,
					height: renderH,
					allowMsaa: !nativeSticker,
				});
				restoreCameraModeUI(built.camera);
			}
			this.renderPackUIOverlay({
				built,
				width: renderW,
				height: renderH,
				target: rt,
				allowMsaa: !nativeSticker,
			});
		};

		const stickerRT = nativeSticker
			? this.ensureStickerTarget(renderW, renderH)
			: null;
		const packTarget = stickerRT ?? target;
		const packClear = nativeSticker ? false : clearFirst;
		if (nativeSticker && stickerRT) {
			renderer.getClearColor(this.clearScratch);
			const prevAlpha = renderer.getClearAlpha();
			renderer.setRenderTarget(stickerRT);
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
			renderer.setClearColor(this.clearScratch, prevAlpha);
		}
		const packScene = built.root as THREE.Scene;
		const prevPackBackground = nativeSticker ? packScene.background : null;
		if (nativeSticker) packScene.background = null;

		if (!nativeSticker && samplesBelow && packRT && target === accumRT) {
			// Mesh-UV path: snapshot full below stack, bind uInput, keep composite under the mesh.
			const belowTex = this.snapshotBelowSource();
			if (belowTex) {
				this.bindBelowInputTexture({ built, texture: belowTex });
			}

			// Backdrop = full below composite (all layers). Do NOT clear to black.
			this.blitTextureToTarget({
				source: accumRT.texture,
				target: packRT,
				flipY: false,
				clear: true,
			});

			drawPackTo(packRT, { clearFirst: false, keepDepth: true });

			this.blitTextureToTarget({
				source: packRT.texture,
				target: accumRT,
				flipY: false,
				clear: true,
			});
		} else if (needsBelow && samplesBelow) {
			const belowTex = this.snapshotBelowSource();
			if (belowTex) {
				this.bindBelowInputTexture({ built, texture: belowTex });
			}
			if (clearFirst && !nativeSticker) {
				renderer.setClearColor(0x000000, 1);
			}
			drawPackTo(packTarget, { clearFirst: packClear, keepDepth: !packClear });
		} else if (needsBelow && !samplesBelow) {
			const belowTex = this.snapshotBelowSource();
			if (belowTex) {
				this.bindBelowInputTexture({ built, texture: belowTex });
			}
			drawPackTo(packTarget, { clearFirst: packClear, keepDepth: !packClear });
		} else if (packClear) {
			drawPackTo(packTarget, { clearFirst: true });
		} else {
			drawPackTo(packTarget, { clearFirst: false, keepDepth: true });
		}

		if (nativeSticker) packScene.background = prevPackBackground;
		if (nativeSticker && stickerRT && target) {
			const placement = readStickerPlacement(liveParams);
			let stickerOpacity = 1;
			if (stickerAnims) {
				const pose = resolveAppliedStickerPose({
					stickerAnims,
					localTimeSec: clipLocalTime,
					clipDurationSec,
					motionForPack: (packId) => {
						const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
						return pack?.manifest.motion ?? null;
					},
				});
				const pixel = Math.min(width / renderW, height / renderH);
				const placedW = renderW * pixel * placement.scaleX;
				const placedH = renderH * pixel * placement.scaleY;
				placement.scaleX *= pose.scale;
				placement.scaleY *= pose.scale;
				placement.rotate += pose.rotate;
				placement.positionX += pose.positionX * placedW;
				// User positionY is screen-down. Animation +Y is up.
				placement.positionY -= pose.positionY * placedH;
				stickerOpacity = pose.opacity;
			}
			this.blitTextureToTarget({
				source: stickerRT.texture,
				target,
				flipY: false,
				clear: clearFirst,
				clearAlpha: 1,
				blend: "alpha",
				opacity: stickerOpacity,
				contain: {
					sourceWidth: renderW,
					sourceHeight: renderH,
					destWidth: width,
					destHeight: height,
				},
				placement,
			});
		}

		renderer.toneMapping = prevTone;
		renderer.toneMappingExposure = prevExposure;
		renderer.autoClear = false;
	}

	


	/**
	 * Ortho beauty cam for timeline flowerText pack-PP.
	 * Synthetic flower packs have no authored camera — scene-builder falls back to
	 * PerspectiveCamera(50, 16/9), which letterboxes/squashes via placeCanvasInFrontOfCamera.
	 * Match canvas pixel aspect (same plane as overlay) so SS layout matches the overlay path.
	 */
	private ensureFlowerPpOrtho(resW: number, resH: number): THREE.OrthographicCamera {
		const w = Math.max(1, resW);
		const h = Math.max(1, resH);
		const dist = 100; // DEFAULT_PLANE_DISTANCE
		if (!this.flowerPpOrtho) {
			this.flowerPpOrtho = new THREE.OrthographicCamera(
				-w / 2,
				w / 2,
				h / 2,
				-h / 2,
				0.1,
				2000,
			);
		} else {
			this.flowerPpOrtho.left = -w / 2;
			this.flowerPpOrtho.right = w / 2;
			this.flowerPpOrtho.top = h / 2;
			this.flowerPpOrtho.bottom = -h / 2;
			this.flowerPpOrtho.updateProjectionMatrix();
		}
		this.flowerPpOrtho.position.set(0, 0, dist);
		this.flowerPpOrtho.lookAt(0, 0, 0);
		this.flowerPpOrtho.up.set(0, 1, 0);
		this.flowerPpOrtho.updateMatrixWorld(true);
		this.flowerPpOrtho.layers.disableAll();
		this.flowerPpOrtho.layers.enable(UI_CAMERA_LAYER);
		return this.flowerPpOrtho;
	}

	private ensureUIOverlayCamera(): THREE.OrthographicCamera {
		if (!this.uiOverlayCamera) {
			this.uiOverlayCamera = createUIOverlayCamera();
		}
		return this.uiOverlayCamera;
	}

	/** Screen-Space UI after 3D / post-process color is already in target. */
	private renderPackUIOverlay({
		built,
		width,
		height,
		target,
		allowMsaa = true,
	}: {
		built: BuiltPackScene;
		width: number;
		height: number;
		target: THREE.WebGLRenderTarget | null;
		allowMsaa?: boolean;
	}) {
		const renderer = this.renderer;
		if (!renderer || !built.hasUI || !target) return;
		if (!packHasUIMode(built.root, RENDER_MODE_OVERLAY)) return;
		const resW = Math.max(1, built.resolution?.width || width);
		const resH = Math.max(1, built.resolution?.height || height);
		const msaa = allowMsaa ? this.ensureMsaaTarget(width, height) : null;
		if (msaa) {
			const prevAuto = renderer.autoClear;
			renderer.getClearColor(this.clearScratch);
			const prevAlpha = renderer.getClearAlpha();
			renderer.setRenderTarget(msaa);
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
			const drew = renderUIOverlay({
				renderer,
				root: built.root,
				uiCamera: this.ensureUIOverlayCamera(),
				resW,
				resH,
				target: msaa,
			});
			renderer.autoClear = prevAuto;
			renderer.setClearColor(this.clearScratch, prevAlpha);
			if (drew) {
				this.blitTextureToTarget({
					source: msaa.texture,
					target,
					flipY: false,
					clear: false,
					blend: "alpha",
				});
			}
			return;
		}
		renderUIOverlay({
			renderer,
			root: built.root,
			uiCamera: this.ensureUIOverlayCamera(),
			resW,
			resH,
			target,
		});
	}

	private renderPackWithPostProcess({
		packId,
		built,
		width,
		height,
		target,
		liveParams,
		clearFirst,
		keepDepthClear = false,
		transitionInputs = null,
		allowMsaa = true,
		cameraOverride = null,
		transparentClear = false,
		beautyClearColor = null,
		outputToneMapping,
		outputExposure,
	}: {
		packId: string;
		built: BuiltPackScene;
		width: number;
		height: number;
		target: THREE.WebGLRenderTarget | null;
		liveParams?: ParamValues | null;
		clearFirst: boolean;
		keepDepthClear?: boolean;
		transitionInputs?: {
			texFrom: THREE.Texture;
			texTo: THREE.Texture;
		} | null;
		allowMsaa?: boolean;
		/** When set (timeline text pack-PP), use this beauty cam instead of built.camera. */
		cameraOverride?: THREE.Camera | null;
		/** Default/transparent beauty: clear alpha 0 so empty pixels stay see-through (editor BeautyClear). */
		transparentClear?: boolean;
		/** Color background plate (editor Color bg). Ignored when transparentClear. */
		beautyClearColor?: THREE.Color | null;
		/** OutputPass tone mapping override (UI text: NoToneMapping = sRGB only). */
		outputToneMapping?: THREE.ToneMapping;
		outputExposure?: number;
	}) {
		const renderer = this.renderer;
		if (!renderer || !built.postProcess) return;

		const beautyCam = cameraOverride || built.camera;
		if (!beautyCam) return;

		const outputTM =
			outputToneMapping !== undefined
				? outputToneMapping
				: renderer.toneMapping;
		const outputExp =
			outputExposure !== undefined
				? outputExposure
				: renderer.toneMappingExposure > 0
					? renderer.toneMappingExposure
					: 1;
		const nextSig = packComposerSignature({
			stack: built.postProcess,
			width,
			height,
			outputToneMapping: outputTM,
			outputExposure: outputExp,
			transparentClear,
		});
		let builtPp = this.packComposers.get(packId) ?? null;
		if (!builtPp || builtPp.signature !== nextSig) {
			builtPp?.dispose();
			builtPp = buildPackComposer({
				renderer,
				scene: built.root,
				camera: beautyCam,
				width,
				height,
				stack: built.postProcess,
				exposed: built.exposedParams ?? [],
				liveParams,
				outputToneMapping,
				outputExposure,
				transparentClear,
			});
			if (builtPp) this.packComposers.set(packId, builtPp);
		} else {
			// Params (bloom strength etc.) change every K-frame sample; update in place.
			applyPackComposerParams({
				built: builtPp,
				stack: built.postProcess,
				exposed: built.exposedParams ?? [],
				liveParams,
				scene: built.root,
				camera: beautyCam,
			});
		}
		if (!builtPp) {
			if (target) {
				this.renderObjectAntialiased({
					root: built.root,
					camera: beautyCam,
					target,
					replace: clearFirst || !keepDepthClear,
					width,
					height,
					allowMsaa,
				});
			}
			return;
		}

		const prevAuto = renderer.autoClear;
		// HDR contract (Editor Viewport presentComposerToLetterbox):
		// UnrealBloom must sample linear HDR. Force NoToneMapping for the full
		// composer.render(); OutputPass wrap restores pack/project tone mapping.
		const prevTmForPp = renderer.toneMapping;
		const prevExpForPp = renderer.toneMappingExposure;
		renderer.toneMapping = THREE.NoToneMapping;
		// Re-bind below composite right before beauty/bloom so PP rebuild cannot
		// leave uInput on a stale placeholder (white 1x1 / null).
		const wantsBelow =
			built.belowInputUniformNames.length > 0 || built.needsBelowInput;
		if (wantsBelow && this.lastBelowTexture) {
			this.bindBelowInputTexture({ built, texture: this.lastBelowTexture });
		}
		this.bindCutTransitionInputs({ built, transitionInputs });
		const resW = Math.max(1, built.resolution?.width || width);
		const resH = Math.max(1, built.resolution?.height || height);

		const sceneRoot = built.root as THREE.Scene;
		const prevBg =
			sceneRoot && "background" in sceneRoot ? sceneRoot.background : undefined;
		renderer.getClearColor(this.clearScratch);
		const prevClearAlpha = renderer.getClearAlpha();
		if (transparentClear) {
			// Match editor applyBeautyClear(Default): see-through empty pixels.
			if (sceneRoot && "background" in sceneRoot) sceneRoot.background = null;
			renderer.setClearColor(0x000000, 0);
		} else {
			// Match editor applyBeautyClear(Color): opaque plate + scene.background.
			const plate = beautyClearColor ?? new THREE.Color(0x000000);
			if (sceneRoot && "background" in sceneRoot) {
				sceneRoot.background = plate;
			}
			renderer.setClearColor(plate, 1);
		}

		prepareCameraModeUI({
			root: built.root,
			beautyCam,
			resW,
			resH,
		});
		renderer.getViewport(this.viewportScratch);
		renderer.getScissor(this.scissorScratch);
		const prevScissorTestPp = renderer.getScissorTest();
		renderer.autoClear = true;
		builtPp.composer.render();
		// EffectComposer sets viewport to its FBO size (tight text RT); restore so
		// following video/image layers and present use the full compose buffer.
		renderer.setViewport(this.viewportScratch);
		renderer.setScissor(this.scissorScratch);
		renderer.setScissorTest(prevScissorTestPp);
		restoreCameraModeUI(beautyCam);
		renderer.autoClear = prevAuto;
		renderer.toneMapping = prevTmForPp;
		renderer.toneMappingExposure = prevExpForPp;
		if (sceneRoot && "background" in sceneRoot) {
			sceneRoot.background = prevBg as THREE.Scene["background"];
		}
		renderer.setClearColor(this.clearScratch, prevClearAlpha);

		const readBuf = (
			builtPp.composer as unknown as { readBuffer: THREE.WebGLRenderTarget }
		).readBuffer;
		if (target && readBuf?.texture) {
			// OutputPass wrote final pack bytes (none: working-space / no sRGB transfer;
			// Neutral/ACES: display-encoded). Mark sRGB so MeshBasic present round-trips;
			// raw ShaderMaterial blit copies bytes without an extra encode.
			const prevCS = readBuf.texture.colorSpace;
			readBuf.texture.colorSpace = THREE.SRGBColorSpace;
			this.blitTextureToTarget({
				source: readBuf.texture,
				target,
				flipY: false,
				clear: clearFirst || !keepDepthClear,
				clearColor: 0x000000,
				clearAlpha: transparentClear ? 0 : 1,
				blend: "replace",
				// Editor Viewport presentComposerToLetterbox: straight-alpha from
				// additive bloom (rgb may exceed a). Needed when beauty clear is transparent.
				straightAlphaFromPremul: transparentClear,
			});
			readBuf.texture.colorSpace = prevCS;
			// Keep display tag on the destination text/pack RT for presentAccum.
			if (target.texture) target.texture.colorSpace = THREE.SRGBColorSpace;
		}
	}

private renderForcedOverlays({
		width,
		height,
		skipIds,
		target,
	}: {
		width: number;
		height: number;
		skipIds: Set<string>;
		target: THREE.WebGLRenderTarget | null;
	}) {
		const renderer = this.renderer;
		if (!renderer) return;

		const { activeOverlayIds } = getPackRegistrySnapshot();
		const toDraw = activeOverlayIds.filter((id) => !skipIds.has(id));
		if (toDraw.length === 0) return;

		renderer.autoClear = false;
		for (const packId of toDraw) {
			this.renderOnePack({
				packId,
				width,
				height,
				clearFirst: false,
				target,
			});
		}
		renderer.autoClear = true;
	}


	/** Authored project pixels only (no supersample-as-contentScale). */
	/**
	 * Preview quality scale for text RT: compose buffer / authored canvas.
	 * Layout + fontSize stay in authored pixels; RT undersamples into fewer pixels.
	 * Export / Full Quality => 1.
	 */
	private flowerTextPreviewScale(authoredW: number, composeW: number): number {
		const a = Math.max(1, authoredW);
		const c = Math.max(1, composeW);
		const s = c / a;
		if (!Number.isFinite(s) || s <= 0) return 1;
		return Math.min(1, s);
	}

	private ensureTextLayerTarget(
		width: number,
		height: number,
		opts?: { fit?: boolean },
	): THREE.WebGLRenderTarget {
		this.textLayerRT = ensureTextLayerRenderTarget(this.textLayerRT, width, height, {
			stencilBuffer: true,
			depthBuffer: true,
			fit: opts?.fit === true,
		});
		return this.textLayerRT;
	}

	/** Drop flower-text scene + any cached pack PP composers bound to its root. */
	private disposeFlowerTextEntry(elementId: string) {
		const entry = this.flowerTextScenes.get(elementId);
		if (entry) {
			disposeBuiltPackScene({ built: entry.built });
			this.flowerTextScenes.delete(elementId);
		}
		const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + elementId;
		for (const key of [packId, packId + ":textanim-pp"]) {
			const pp = this.packComposers.get(key);
			if (pp) {
				pp.dispose();
				this.packComposers.delete(key);
			}
		}
	}

	private pruneFlowerTextScenes() {
		for (const id of [...this.flowerTextScenes.keys()]) {
			if (!this.lastFrameFlowerTextIds.has(id)) {
				this.disposeFlowerTextEntry(id);
			}
		}
	}

	private ensureFlowerTextBuilt({
		elementId,
		contentHash,
		props,
	}: {
		elementId: string;
		contentHash: string;
		props: TimelineFlowerTextProps;
	}) {
		const existing = this.flowerTextScenes.get(elementId);
		if (existing && existing.hash === contentHash) return;
		if (existing) {
			// Also drop stale :textanim-pp composers (RenderPass still holds old root).
			this.disposeFlowerTextEntry(elementId);
		}
		if (this.flowerTextBuildInFlight.has(elementId)) return;
		const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + elementId;
		const pack = buildSyntheticFlowerTextPack({ packId, props });
		this.flowerTextBuildInFlight.add(elementId);
		void buildPackScene({ pack })
			.then((built) => {
				this.flowerTextBuildInFlight.delete(elementId);
				if (!built) return;
				// Replace any prior root and drop composers still bound to it.
				this.disposeFlowerTextEntry(elementId);
				this.flowerTextScenes.set(elementId, { built, hash: contentHash, pack });
				// Preview skips same-frame redraws; wake it now that Troika scene exists.
				bumpFlowerTextFrameEpoch();
			})
			.catch((err) => {
				this.flowerTextBuildInFlight.delete(elementId);
				console.error("[FreeFilmCut] flower text scene build failed", err);
			});
	}

	/**
	 * Timeline text layer (plain Default + flower) → TextLayer RT → alpha blit onto accum.
	 * Frame type stays "flowerText"; plain uses solid-face default FlowerStyle
	 * (resolveTimelineFlowerTextProps). Step-2 per-text FX hooks after RT rasterization.
	 */
	private renderOneFlowerText({
		item,
		width,
		height,
		clearFirst,
		target,
	}: {
		item: Extract<FrameItemDescriptor, { type: "flowerText" }>;
		width: number;
		height: number;
		clearFirst: boolean;
		target: THREE.WebGLRenderTarget;
	}): boolean {
		const renderer = this.renderer;
		if (!renderer) return false;

		this.ensureFlowerTextBuilt({
			elementId: item.elementId,
			contentHash: item.contentHash,
			props: item.props,
		});
		const entry = this.flowerTextScenes.get(item.elementId);
		if (!entry) return false;

		const { built } = entry;
		let props = item.props;
		const textAnimPayloadForPack = (packId: string) => {
			const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
			if (!pack) return null;
			const ta = (pack.manifest.textAnim || null) as
				| import("@/vfxpack/text-anim-motion").TextAnimPackPayload
				| null;
			if (!ta) return null;
			const manifestBg = (
				pack.manifest as { background?: { type?: string; color?: string }; postProcess?: unknown }
			).background;
			let out = ta;
			// Prefer textAnim.postProcess; fall back to top-level manifest.postProcess.
			if (!out.postProcess && pack.manifest.postProcess) {
				out = { ...out, postProcess: pack.manifest.postProcess as typeof out.postProcess };
			}
			if (!out.background && manifestBg) {
				out = { ...out, background: manifestBg };
			}
			const manifestOut = (
				pack.manifest as { output?: { toneMapping?: string | number; toneMappingExposure?: number } }
			).output;
			if (!out.output && manifestOut) {
				out = { ...out, output: manifestOut };
			}
			return out;
		};
		// Authored project pixels — FlowerStyle / fontSize stay here (not scaled by preview quality).
		const resW = Math.max(1, Math.round(props.canvasWidth));
		const resH = Math.max(1, Math.round(props.canvasHeight));
		// Compose buffer is already quality-scaled (CanvasRenderer contentScale). Undersample
		// the text RT to that size so preview quality actually saves fill-rate / PP cost.
		const previewScale = this.flowerTextPreviewScale(resW, width);

		// Refresh fccUI + bake NLE transform into RectTransform so a single layout pass wins.
		// When text-anim char-split is active, skip parent __fccSyncText here — applyActiveTextAnimPack
		// hides originals; a parent rebuild/Troika callback would draw a second layer (rest + offset chars).
		const activePack = item.textAnims
			? resolveActiveTextAnimPack({
					textAnims: item.textAnims,
					localTimeSec: item.clipLocalTime ?? 0,
					clipDurationSec: item.clipDurationSec ?? 0,
					payloadForPack: textAnimPayloadForPack,
				})
			: null;
		// Only skip parent Troika sync while a phase is actively driving char-split.
		const willDriveTextAnim = !!activePack;
		built.root.traverse((obj) => {
			if (!isUIText(obj)) return;
			const ui = getFccUI(obj);
			if (!ui) return;
			ui.text = props.content;
			ui.fontSize = props.scaledFontSize;
			ui.color = props.color;
			ui.align =
				props.textAlign === "left" || props.textAlign === "right"
					? props.textAlign
					: "center";
			ui.bold = props.fontWeight === "bold";
			ui.letterSpacing = props.letterSpacing;
			ui.lineHeight = props.lineHeight;
			ui.flowerStyle = props.flowerStyle;
			ui.flowerBaseFontSize = props.flowerBaseFontSize ?? undefined;
			(ui as { textFxStack?: unknown }).textFxStack = props.textFxStack ?? null;
			// Canvas2D Y-down → overlay Y-up
			ui.anchoredPosition = [props.positionX, -props.positionY];
			ui.localScale = [props.scaleX, props.scaleY, 1];
			ui.localEulerAngles = [0, 0, -props.rotate];
			if (willDriveTextAnim) return;
			const sync = (
				obj.userData as { __fccSyncText?: (r: { w: number; h: number }) => void }
			).__fccSyncText;
			if (sync) {
				sync({
					w: Math.max(1, props.canvasWidth * 0.9),
					h: Math.max(1, props.scaledFontSize * 3),
				});
			}
		});

		// Char-split + wipe/bend AFTER fccUI sync (needs final text + flower meshes).
		// Pack may carry postProcess; never overwrite clip flowerStyle (already on props).
		let packPostProcess: import("@/vfxpack/text-anim-motion").TextAnimPackPayload["postProcess"] | null =
			null;
		if (item.textAnims) {
			packPostProcess = activePack
				? samplePackPostProcess(
						activePack.payload,
						activePack.phaseLocalTime,
						activePack.loop,
					)
				: null;
			const uiPose = applyActiveTextAnimPack({
				root: built.root,
				textAnims: item.textAnims,
				localTimeSec: item.clipLocalTime ?? 0,
				clipDurationSec: item.clipDurationSec ?? 0,
				payloadForPack: textAnimPayloadForPack,
				rect: {
					w: Math.max(1, props.canvasWidth * 0.9),
					h: Math.max(1, props.scaledFontSize * 3),
				},
			});
			// ui.* tracks only (sampleUiOnlyPose). Char offsets stay on char groups —
			// never shift the whole clip from charIn far-pose params (that caused a rest+offset double).
			props = applyTextPoseToFlowerProps(props, uiPose);
			built.root.traverse((obj) => {
				if (!isUIText(obj)) return;
				if ((obj.userData as { __fccTextAnimChar?: boolean }).__fccTextAnimChar) return;
				const ui = getFccUI(obj);
				if (!ui) return;
				ui.anchoredPosition = [props.positionX, -props.positionY];
				ui.localScale = [props.scaleX, props.scaleY, 1];
				ui.localEulerAngles = [0, 0, -props.rotate];
				assertTextAnimOriginalsHidden(obj);
			});
		}

		// Safety net: originals must stay hidden while char preview is live (overlay or PP).
		if (activePack) {
			built.root.traverse((obj) => {
				if (!isUIText(obj)) return;
				if ((obj.userData as { __fccTextAnimChar?: boolean }).__fccTextAnimChar) return;
				assertTextAnimOriginalsHidden(obj);
			});
		}

		// When the text-anim pack carries camera postProcess, render like editor
		// SS-camera text: canvas renderMode=camera + beauty cam EffectComposer.
				const packPpStack = packPostProcess as import("@/vfxpack/postprocess").PostProcessStackData | null;
		// Keep full Bloom+OutputPass stack even at strength=0. Color-space fix lives in
		// buildPackComposer OutputPass wrap (none => no sRGB transfer) so PP luma matches overlay.
		const useCameraPp =
			!!packPpStack &&
			packPpStack.enabled !== false &&
			stackHasEnabledEffects(packPpStack);


		// Tight AABB + bloom pad in authored project pixels (shared helper).
		// Layout uses full canvas; RT / PP FBO / blit destRect use the padded rect.
		// Pad from pack-max track peaks (not live K-frame strength) so RT/composer
		// signature stays stable while Bloom intensity animates.
		const padPx = bloomPadPxFromPackTracks({
			stack: packPpStack,
			tracks: activePack?.payload?.tracks ?? null,
			canvasW: resW,
			canvasH: resH,
			inkMaxSide: Math.max(
				1,
				(Number(props.scaledFontSize) || 48) *
					Math.max(4, String(props.content || "").length),
			),
		});
		const rtKey = [
			item.contentHash,
			resW,
			resH,
			padPx,
			String(props.scaledFontSize),
			String(props.letterSpacing ?? ""),
			String(props.lineHeight ?? ""),
			String(props.scaleX ?? 1),
			String(props.scaleY ?? 1),
		].join("|");
		let rtRect: TextLayerAabb;
		const cached = entry.rtCache;
		if (cached && cached.key === rtKey) {
			// Hit: reuse padded rect. Do NOT layout+measure every frame (was a
			// major play-path cost). Char travel is covered by motionPad below.
			rtRect = cached.rect;
		} else {
			const propsFallback = {
				content: props.content,
				positionX: props.positionX,
				positionY: props.positionY,
				scaledFontSize: props.scaledFontSize,
				letterSpacing: props.letterSpacing,
				lineHeight: props.lineHeight,
				scaleX: props.scaleX,
				scaleY: props.scaleY,
				flowerStyle: props.flowerStyle,
			};
			let ink =
				measureOverlayTextInkAabb(built.root, resW, resH) ||
				null;
			// Char-in travel can leave the rest ink; keep a motion skirt so we
			// don't remeasure every tick.
			if (ink && activePack) {
				const travel = Math.max(48, (Number(props.scaledFontSize) || 48) * 2.75);
				ink = {
					x: ink.x - travel,
					y: ink.y - travel,
					w: ink.w + travel * 2,
					h: ink.h + travel * 2,
				};
			}
			rtRect = resolveTextLayerRtRect({
				root: built.root,
				resW,
				resH,
				stack: packPpStack,
				padOverridePx: padPx,
				inkOverride: ink,
				propsFallback,
			});
			entry.rtCache = {
				key: rtKey,
				ink: ink || { x: rtRect.x, y: rtRect.y, w: rtRect.w, h: rtRect.h },
				rect: rtRect,
				padPx,
			};
		}
		const destRect = mapAabbToDestRect(
			rtRect,
			resW,
			resH,
			target.width || width,
			target.height || height,
		);
		const opacityMul = item.opacity * (props.opacity > 0 ? props.opacity : 1);

		if (useCameraPp && built.camera) {
			type CanvasUi = { type?: string; renderMode?: string };
			const canvases: Array<{ obj: THREE.Object3D; ui: CanvasUi }> = [];
			built.root.traverse((obj) => {
				const ui = getFccUI(obj) as CanvasUi | null;
				if (ui?.type === "canvas") canvases.push({ obj, ui });
			});
			const prevModes = canvases.map(({ ui }) => ui.renderMode);
			for (const { ui } of canvases) ui.renderMode = "camera";

			const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + item.elementId;
			// Bloom kernels are texel-sized. Keep 1:1 authored density on the tight
			// FBO (not preview undersample) so radius matches full-canvas authoring;
			// pad grows with radius so large blooms naturally approach full canvas.
			const ppRT = this.ensureTextLayerTarget(
				Math.max(1, Math.round(rtRect.w)),
				Math.max(1, Math.round(rtRect.h)),
				{ fit: true },
			);
			// Composer signature uses actual RT size (hysteresis), not breathing AABB.
			const ppW = ppRT.width;
			const ppH = ppRT.height;
			const packBg = (activePack?.payload as { background?: { type?: string; color?: string } } | null)
				?.background;
			const bgType = String(packBg?.type || "Default");
			const isTransparentBg =
				bgType === "Default" || bgType === "default" || !packBg?.type;
			const beautyClearColor = isTransparentBg
				? null
				: new THREE.Color(packBg?.color || "#000000");
			const ortho = this.ensureFlowerPpOrtho(resW, resH);
			const view = aabbToCenteredOrthoView(rtRect, resW, resH);
			try {
				// Full frustum for placeCanvas; viewOffset crops to padded AABB.
				ortho.setViewOffset(
					view.fullW,
					view.fullH,
					view.offsetX,
					view.offsetY,
					view.width,
					view.height,
				);
				ortho.updateProjectionMatrix();
				this.renderPackWithPostProcess({
					packId: packId + ":textanim-pp",
					built: {
						...built,
						postProcess: packPpStack,
						// placeCanvas still authored full res; composer FBO = tight RT.
						resolution: { width: resW, height: resH },
						camera: ortho,
					},
					width: Math.max(1, ppW),
					height: Math.max(1, ppH),
					target: ppRT,
					clearFirst: true,
					keepDepthClear: false,
					allowMsaa: true,
					cameraOverride: ortho,
					transparentClear: isTransparentBg,
					beautyClearColor,
					outputToneMapping: resolvePackOutputToneMapping(activePack?.payload),
					outputExposure: resolvePackOutputExposure(activePack?.payload),
				});
			} finally {
				ortho.clearViewOffset();
				ortho.updateProjectionMatrix();
				canvases.forEach(({ ui }, i) => {
					const prev = prevModes[i];
					ui.renderMode = prev === "camera" || prev === "overlay" ? prev : "overlay";
				});
			}
			if (clearFirst) {
				renderer.setRenderTarget(target);
				renderer.setClearColor(0x000000, 0);
				renderer.clear(true, true, true);
			}
			ppRT.texture.colorSpace = THREE.SRGBColorSpace;
			this.blitTextureToTarget({
				source: ppRT.texture,
				target,
				flipY: false,
				clear: false,
				blend: "alpha",
				destRect,
				opacity: opacityMul,
				straightAlphaFromPremul: false,
			});
			return true;
		}

		// Overlay UI camera → tight text RT → offset blit (no pack PP).
		const ovW = Math.max(1, Math.round(rtRect.w * previewScale));
		const ovH = Math.max(1, Math.round(rtRect.h * previewScale));
		const textRT = this.ensureTextLayerTarget(ovW, ovH, { fit: true });
		const drew = renderTextLayerToTarget({
			renderer,
			root: built.root,
			uiCamera: this.ensureUIOverlayCamera(),
			resW,
			resH,
			target: textRT,
			viewRect: rtRect,
		});
		if (!drew) return false;

		if (clearFirst) {
			renderer.setRenderTarget(target);
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
		}

		this.blitTextureToTarget({
			source: textRT.texture,
			target,
			flipY: false,
			clear: false,
			blend: "alpha",
			destRect,
			opacity: opacityMul,
		});
		return true;
	}


	private ensurePackBuilt(packId: string) {
		const { packs } = getPackRegistrySnapshot();
		const pack = packs.find((p) => p.id === packId);
		if (!pack?.scene) return;

		// Re-import (same id, new object) must rebuild so uInput shaders refresh.
		// Also rebuild when PACK_SCENE_BUILD_REV advances (anim uuid binding, etc.).
		const existing = this.packScenes.get(packId);
		const revOk =
			existing &&
			(existing as BuiltPackScene & { buildRev?: number }).buildRev ===
				PACK_SCENE_BUILD_REV;
		if (existing && revOk && this.packSource.get(packId) === pack) {
			return;
		}
		if (existing) {
			disposeBuiltPackScene({ built: existing });
			this.packScenes.delete(packId);
			this.packSource.delete(packId);
		}
		if (this.packBuildInFlight.has(packId)) return;

		this.packBuildInFlight.add(packId);
		void buildPackScene({ pack })
			.then((built) => {
				this.packBuildInFlight.delete(packId);
				if (!built) return;
				const stillNeeded =
					this.lastFramePackIds.has(packId) ||
					getPackRegistrySnapshot().activeOverlayIds.includes(packId) ||
					getPackRegistrySnapshot().packs.some((p) => p.id === packId);
				if (!stillNeeded) {
					disposeBuiltPackScene({ built });
					return;
				}
				const previous = this.packScenes.get(packId);
				if (previous) disposeBuiltPackScene({ built: previous });
				this.packScenes.set(packId, built);
				this.packSource.set(packId, pack);
				if (this.initializedSize) {
					this.updatePackCameraAspects(
						this.initializedSize.width,
						this.initializedSize.height,
					);
				}
			})
			.catch((error) => {
				this.packBuildInFlight.delete(packId);
				console.error("[FreeFilmCut] failed to build vfxpack scene", error);
			});
	}

	private syncPackScenes() {
		const { packs, activeOverlayIds } = getPackRegistrySnapshot();
		const keep = new Set<string>([
			...activeOverlayIds,
			...this.lastFramePackIds,
		]);

		for (const [packId, built] of this.packScenes) {
			if (!keep.has(packId)) {
				disposeBuiltPackScene({ built });
				this.packScenes.delete(packId);
				this.packSource.delete(packId);
				const pp = this.packComposers.get(packId);
				if (pp) {
					pp.dispose();
					this.packComposers.delete(packId);
				}
			}
		}

		for (const packId of keep) {
			this.ensurePackBuilt(packId);
		}

		// Also prebuild any registered pack that has a scene (first timeline drop is snappy).
		for (const pack of packs) {
			if (pack.scene) this.ensurePackBuilt(pack.id);
		}
	}

	private updatePackCameraAspects(width: number, height: number) {
		for (const built of this.packScenes.values()) {
			if (built.camera instanceof THREE.PerspectiveCamera) {
				built.camera.aspect = width / Math.max(1, height);
				built.camera.updateProjectionMatrix();
			}
		}
	}

	private clearLayerMeshes() {
		const scene = this.scene;
		if (!scene) return;
		for (const mesh of this.layerMeshes) {
			scene.remove(mesh);
			this.layerPool.push(mesh);
		}
		this.layerMeshes.length = 0;
	}

	private acquireMesh(): THREE.Mesh {
		const pooled = this.layerPool.pop();
		if (pooled) return pooled;
		const geometry = new THREE.PlaneGeometry(1, 1);
		const material = new THREE.MeshBasicMaterial({
			transparent: true,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		return new THREE.Mesh(geometry, material);
	}

	private addLayerMesh(
		item: Extract<FrameItemDescriptor, { type: "layer" }>,
		z: number,
	) {
		const scene = this.scene;
		if (!scene) return;

		const entry = this.cache.get(item.textureId);
		if (!entry) {
			return;
		}

		// Keep video / canvas textures fresh each frame.
		entry.texture.needsUpdate = true;

		const mesh = this.acquireMesh();
		const material = mesh.material as THREE.MeshBasicMaterial;
		material.map = entry.texture;
		material.opacity = item.opacity;
		material.transparent = true;
		material.needsUpdate = true;

		if (item.mask) {
			const maskEntry = this.cache.get(item.mask.textureId);
			if (maskEntry) {
				maskEntry.texture.needsUpdate = true;
				material.alphaMap = maskEntry.texture;
			} else {
				material.alphaMap = null;
			}
		} else {
			material.alphaMap = null;
		}

		applyQuadTransform(mesh, item.transform, z);
		scene.add(mesh);
		this.layerMeshes.push(mesh);
	}

	private syncExternalTexture(texture: ExternalTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "external" &&
			previous.source === texture.source &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			previous.texture.flipY = false;
			previous.texture.needsUpdate = true;
			return;
		}

		if (previous) {
			previous.texture.dispose();
		}

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});

		const threeTexture = createTextureFromSource(texture.source);
		threeTexture.colorSpace = THREE.SRGBColorSpace;
		threeTexture.flipY = false;
		threeTexture.needsUpdate = true;

		this.cache.set(texture.id, {
			kind: "external",
			source: texture.source,
			texture: threeTexture,
			width: texture.width,
			height: texture.height,
		});
	}

	private syncRenderedTexture(texture: RenderedTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "rendered" &&
			previous.contentHash === texture.contentHash &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		const canvas =
			previous?.kind === "rendered" &&
			previous.width === texture.width &&
			previous.height === texture.height
				? previous.canvas
				: createBackingCanvas({
						width: texture.width,
						height: texture.height,
					});

		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error(`Failed to get 2d context for texture ${texture.id}`);
		}
		ctx.clearRect(0, 0, texture.width, texture.height);
		texture.draw(ctx);

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});

		let threeTexture: THREE.CanvasTexture;
		if (previous?.kind === "rendered" && previous.canvas === canvas) {
			threeTexture = previous.texture;
			threeTexture.flipY = false;
			threeTexture.needsUpdate = true;
		} else {
			previous?.texture.dispose();
			threeTexture = new THREE.CanvasTexture(
				canvas as unknown as HTMLCanvasElement,
			);
			threeTexture.colorSpace = THREE.SRGBColorSpace;
			threeTexture.flipY = false;
			threeTexture.needsUpdate = true;
		}

		this.cache.set(texture.id, {
			kind: "rendered",
			canvas,
			texture: threeTexture,
			contentHash: texture.contentHash,
			width: texture.width,
			height: texture.height,
		});
	}

	/** Longest built-pack timeline, in seconds. Null when the scene is not built yet. */
	timelineDurationFor(packId: string): number | null {
		const built = this.packScenes.get(packId);
		if (!built?.timelines?.length) return null;
		let max = 0;
		for (const timeline of built.timelines) {
			const duration = Number(timeline?.duration);
			if (Number.isFinite(duration) && duration > max) max = duration;
		}
		return max > 0 ? max : null;
	}
}

function applyQuadTransform(
	mesh: THREE.Mesh,
	transform: QuadTransformDescriptor,
	z: number,
) {
	const flipX = transform.flipX ? -1 : 1;
	const flipY = transform.flipY ? -1 : 1;
	mesh.position.set(transform.centerX, transform.centerY, z);
	mesh.renderOrder = z;
	mesh.rotation.set(0, 0, (transform.rotationDegrees * Math.PI) / 180);
	mesh.scale.set(transform.width * flipX, transform.height * flipY, 1);
}

function createTextureFromSource(source: CanvasImageSource): THREE.Texture {
	if (
		typeof HTMLVideoElement !== "undefined" &&
		source instanceof HTMLVideoElement
	) {
		return new THREE.VideoTexture(source);
	}
	if (
		typeof HTMLCanvasElement !== "undefined" &&
		source instanceof HTMLCanvasElement
	) {
		return new THREE.CanvasTexture(source);
	}
	if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
		return new THREE.Texture(source as unknown as HTMLImageElement);
	}
	if (
		typeof OffscreenCanvas !== "undefined" &&
		source instanceof OffscreenCanvas
	) {
		return new THREE.CanvasTexture(source as unknown as HTMLCanvasElement);
	}
	if (
		typeof HTMLImageElement !== "undefined" &&
		source instanceof HTMLImageElement
	) {
		return new THREE.Texture(source);
	}

	const width = readSourceWidth(source);
	const height = readSourceHeight(source);
	const canvas = createBackingCanvas({
		width: Math.max(1, width),
		height: Math.max(1, height),
	});
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to create fallback texture canvas");
	}
	ctx.drawImage(source, 0, 0);
	return new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
}

function readSourceWidth(source: CanvasImageSource): number {
	if ("videoWidth" in source && typeof source.videoWidth === "number") {
		return source.videoWidth || 1;
	}
	if ("width" in source && typeof source.width === "number") {
		return source.width || 1;
	}
	return 1;
}

function readSourceHeight(source: CanvasImageSource): number {
	if ("videoHeight" in source && typeof source.videoHeight === "number") {
		return source.videoHeight || 1;
	}
	if ("height" in source && typeof source.height === "number") {
		return source.height || 1;
	}
	return 1;
}

function createBackingCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): OffscreenCanvas {
	if (typeof OffscreenCanvas === "undefined") {
		throw new Error("OffscreenCanvas is not supported in this environment");
	}
	return new OffscreenCanvas(width, height);
}

export const threeCompositor = new ThreeCompositor();

/** Author timeline T from a built pack scene, when that scene already exists. */
export function builtPackTimelineDurationSec(packId: string): number | null {
	return threeCompositor.timelineDurationFor(packId);
}

