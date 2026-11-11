import "@/vfxpack/troika-preconfig";
import * as THREE from "three";
import {
	applyChromaKeyToMaterial,
	installChromaKeyPatch,
} from "./chroma-key-material";
import {
	applyColorCorrectionToMaterial,
	applyColorGradeToMaterial,
	installColorGradePatch,
} from "./color-grade-material";
import {
	applyMaskInvertToMaterial,
	installMaskInvertPatch,
} from "./mask-invert-material";
import {
	incrementCounter,
	isRenderPerfEnabled,
	recordSpan,
} from "@/diagnostics/render-perf";
import type {
	ExternalTextureDescriptor,
	FrameDescriptor,
	FrameItemDescriptor,
	QuadTransformDescriptor,
	RenderedTextureDescriptor,
	TextureUploadDescriptor,
	TransitionSideDescriptor,
} from "./types";
import {
	buildPackScene,
	disposeBuiltPackScene,
	ensureBuiltPackDefaultEnvironment,
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
	materialWantsSamplerUvFlip,
	TRANSITION_FROM_UNIFORM_NAMES,
	TRANSITION_TO_UNIFORM_NAMES,
	normalizeVfxPackType,
	normalizeTransitionFitMode,
	authoredAspectFromResolution,
	type BuiltPackScene,
	type BuiltPostProcess,
} from "@/vfxpack";
import {
	getPackVideoPreviewPlaying,
	getPackVideoPreviewMediaTimeBiasSec,
	pausePackSceneVideos,
	seekPackTimelineVideo,
	syncPackVideos,
	rebindPackRenderTextures,
	settlePackVideosForCapture,
} from "@/vfxpack/pack-video";
import {
	applyTextStickersInScene,
	restampTextStickerLayersInScene,
	sceneHasFrontTextStickers,
	normalizeTextSticker,
	setTextStickerPackLookup,
	setTextStickerFrontRootsVisible,
	withTextContentHiddenExceptFrontStickers,
} from "@/vfxpack/text-stickers.js"; // fcc-tl-flower-44: sprite RT texture
import {
	prepareTextTemplateMediaOnRoot,
	driveTextTemplateMedia,
	driveTextTemplateMediaForExport,
	bindLiveMediaToStickers,
	disposeTextTemplateMedia,
} from "@/vfxpack/text-template-media";
import {
	graftTextTemplateSceneProps,
	materialsMapFromUuidMap,
	sceneHasTextTemplatePropMeshes,
	FCC_TEXT_TEMPLATE_PROPS,
} from "@/vfxpack/text-template-scene-props";
import type { ParamValues } from "@/params";
import { resolveAppliedStickerPose } from "@/vfxpack/sticker-motion";
import {
	activeMediaAnimAtTime,
	mediaAnimPackNativeDuration,
	mediaAnimPackTime,
} from "@/vfxpack/media-anim";
import {
	applyActiveTextAnimPack,
	applyTextPoseToFlowerProps,
	assertTextAnimOriginalsHidden,
	resolveActiveTextAnimPack,
	samplePackPostProcess,
} from "@/vfxpack/textanim/apply-pack";
import { samplePackAnimPostProcess } from "@/vfxpack/text-template-textanim";
import { ensureEmbeddedTextAnimFromTemplatePack } from "@/vfxpack/apply-text-template";
import {
	resolveStickerPackRenderSize,
	scaleStickerPlacementToBuffer,
} from "@/vfxpack/sticker-pack-blit";
import { getLiveDragTransform } from "@/preview/live-drag-transform";
import {
	applyBeautyPass,
	BeautyAnalysisRequester,
	isBeautyParamsActive,
	trimBeautyPass,
	type BeautyAnalysisRequest,
} from "@/beauty";
import { TICKS_PER_SECOND } from "@/wasm";

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

/** Overlay live-drag absolute position onto effectParams for sticker pack blit. */
function mergeSceneEffectLiveParams({
	elementId,
	effectParams,
}: {
	elementId?: string;
	effectParams?: ParamValues | null;
}): ParamValues | null {
	const base = effectParams ? { ...effectParams } : {};
	if (!elementId) {
		return Object.keys(base).length > 0 ? base : null;
	}
	const live = getLiveDragTransform(elementId);
	if (!live) {
		return Object.keys(base).length > 0 ? base : null;
	}
	base["transform.positionX"] = live.x;
	base["transform.positionY"] = live.y;
	return base;
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
	resolveTroikaFontUrl,
	looksLikeFontUrlOrPackPath,
} from "@/vfxpack/timeline-flower-text";
import { bumpFlowerTextFrameEpoch } from "@/vfxpack/flower-text-epoch";
import { loadFlowerPackCatalog } from "@/vfxpack/flower-pack-catalog";
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
import { isCompositorAntialiasEnabled } from "./antialias-setting";
import {
	applyBlendModeToMaterial,
	installBlendModePatch,
} from "./blend-mode-material";

// fcc-tl-flower-25: ensure pose pack lookup is registered (after all imports).
(function registerFccStickerPackLookup() {
	setTextStickerPackLookup((packId: string, stickerId: string) => {
		const pack =
			getPackRegistrySnapshot().packs.find((e) => e.id === packId) || null;
		if (!pack?.scene || !Array.isArray((pack.scene as { nodes?: unknown[] }).nodes)) {
			return null;
		}
		for (const node of (
			pack.scene as {
				nodes: Array<{
					userData?: { fccUI?: { textStickers?: unknown } };
					ui?: { textStickers?: unknown };
				}>;
			}
		).nodes) {
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
	});
})();

function resolveActiveMediaAnimForLayer(
	item: Extract<FrameItemDescriptor, { type: "layer" }>,
): {
	packId: string;
	packTimeSec: number;
	packNativeDurationSec: number;
} | null {
	if (!item.mediaAnims) return null;
	const clipDurationSec = item.clipDurationSec ?? 0;
	const localTimeSec = item.clipLocalTime ?? 0;
	const active = activeMediaAnimAtTime({
		assignment: item.mediaAnims,
		localTimeSec,
		clipDurationSec,
	});
	if (!active) return null;
	const pack = getPackRegistrySnapshot().packs.find(
		(entry) => entry.id === active.slot.packId,
	);
	const packNativeDurationSec = mediaAnimPackNativeDuration({ pack });
	return {
		packId: active.slot.packId,
		packTimeSec: mediaAnimPackTime({
			localTimeSec,
			span: active.span,
			packNativeDurationSec,
		}),
		packNativeDurationSec,
	};
}

/**
 * FreeFilmCut Three.js blit compositor (MVP).
 * - Orthographic textured-quad blit for FrameDescriptor layers
 * - Timeline .vfxpack sceneEffect clips rendered in track order
 * - filter/effect + scope below: snapshot accum → bind uInput/belowInput/iChannel0
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
	/** Last uploaded frame version; see `ExternalTextureDescriptor.frameKey`. */
	frameKey?: string;
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
	/**
	 * Face analysis for beauty layers. Preview reads the latest result without
	 * blocking; export awaits the exact frame (see `ensureFrameBeauty`).
	 */
	private beautyRequester = new BeautyAnalysisRequester({
		// A finished analysis must repaint a paused preview.
		onReady: () => bumpFlowerTextFrameEpoch(),
	});
	private packScenes = new Map<string, BuiltPackScene>();
	/** Synthetic Troika flower-text scenes for timeline TextElements. */
	private flowerTextScenes = new Map<
		string,
		{
			built: BuiltPackScene;
			hash: string;
			pack: LoadedVfxPack;
			/** Shader sticker materials + prop meshes from source text-template pack. */
			tplMaterialsByUuid?: Map<string, THREE.Material>;
			tplPropCamera?: THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
			hasTplProps?: boolean;
			disposeTplProps?: () => void;
		}
	>();
	/** In-flight builds keyed by elementId::contentHash (export must await). */
	private flowerTextBuildPromises = new Map<string, Promise<void>>();
	/** Latest requested contentHash per element (drop superseded builds). */
	private flowerTextDesiredHash = new Map<string, string>();
	/**
	 * While set, ensureInitialized always uses this size (export lock).
	 * Preview must not shrink the shared WebGL canvas mid-encode.
	 */
	private exportSizeLock: { width: number; height: number } | null = null;
	/** Current render pass: force flower/text-anim RTs at project res (export). */
	private flowerTextFullRes = false;
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
	/**
	 * Media-only layer for clip-anim uInput (fill stays on accum, never sampled).
	 * Also used when baking clip-anim into transition uFrom/uTo.
	 */
	private mediaOnlyRT: THREE.WebGLRenderTarget | null = null;
	/** Cut sides composited on the GPU; sampled by the pack as uFrom / uTo. */
	private transitionFromRT: THREE.WebGLRenderTarget | null = null;
	private transitionToRT: THREE.WebGLRenderTarget | null = null;
	/** Optional V-flip copies when pack materials export flipY=false for samplers. */
	private inputFlipFromRT: THREE.WebGLRenderTarget | null = null;
	private inputFlipToRT: THREE.WebGLRenderTarget | null = null;
	private inputFlipBelowRT: THREE.WebGLRenderTarget | null = null;
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
	/** Save/restore around text RT / pack PP so video layers keep full viewport. */
	private viewportScratch = new THREE.Vector4();
	private scissorScratch = new THREE.Vector4();

	/** Pin shared canvas/accum to export project size; null clears. */
	setExportSizeLock(size: { width: number; height: number } | null) {
		this.exportSizeLock = size
			? {
					width: Math.max(1, Math.round(size.width)),
					height: Math.max(1, Math.round(size.height)),
			  }
			: null;
		if (this.exportSizeLock) {
			this.ensureInitialized(this.exportSizeLock);
		}
	}

	isExportSizeLocked(): boolean {
		return this.exportSizeLock != null;
	}

	ensureInitialized({ width, height }: { width: number; height: number }) {
		// Export owns the singleton canvas — ignore preview downscale requests.
		if (this.exportSizeLock) {
			width = this.exportSizeLock.width;
			height = this.exportSizeLock.height;
		}
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

	async render(
		frame: FrameDescriptor,
		opts?: { waitForFlowerText?: boolean },
	) {
		const waitText = !!opts?.waitForFlowerText;
		// Export: text-anim / flower RT at project res (never preview 0.5x).
		this.flowerTextFullRes = waitText;
		/**
		 * `renderFrame` starts counting before `ensureInitialized` + `clear`, but
		 * the per-pass spans only start after them. Without this mark the residual
		 * between the two is invisible — and clearing a composed HalfFloat target
		 * is real fill rate, not bookkeeping.
		 */
		const setupMark = isRenderPerfEnabled() ? performance.now() : 0;
		try {
			this.ensureInitialized({ width: frame.width, height: frame.height });
			// Export must await Troika ready (one encode per frame). Preview stays
			// fire-and-forget + bumpFlowerTextFrameEpoch so RAF is not blocked.
			if (waitText) {
				await this.ensureFrameFlowerTexts(frame);
				// Export: beauty must be present in every encoded frame, so wait
				// for exact face analysis before any layer is drawn.
				await this.ensureFrameBeauty(frame);
				// Await yielded to preview RAF — re-pin size before compositing.
				this.ensureInitialized({ width: frame.width, height: frame.height });
			} else {
				void this.ensureFrameFlowerTexts(frame);
			}
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

		// Sub-spans for `renderFrame`. The outer span only says "24ms"; these say
		// whether it went into the layer/pack pass chain, the force-overlay pass,
		// or the present blit. They measure submission time — WebGL queues work
		// asynchronously — so a big `present` means the driver stalled *there*,
		// which is a different fix from a big `composite`.
		const perfMarks = isRenderPerfEnabled();
		let perfMark = perfMarks ? performance.now() : 0;
		if (perfMarks) {
			// Initialize, viewport/camera update, target clear, mesh teardown.
			recordSpan({ name: "three:setup", durationMs: perfMark - setupMark });
		}

		/**
		 * `three:composite` is still one bucket, so it cannot say whether the
		 * 9ms belongs to plain layer draws, a vfx pack (which is not one draw but
		 * a chain of full-screen blits), or a text layer. These three split it.
		 */
		let layerMs = 0;
		let packMs = 0;
		let textMs = 0;

		/** Composite one media layer onto accum (bottom → top), so uInput sees full stack. */
		const compositeOneLayer = (
			item: Extract<FrameItemDescriptor, { type: "layer" }>,
		) => {
			const layerT0 = perfMarks ? performance.now() : 0;
			try {
				this.clearLayerMeshes();
				// Non-normal blend modes need "everything below" as a texture:
				// accum holds exactly that right now, before this layer draws.
				// The blend shader evaluates the CSS composite against it and
				// writes with blending disabled.
				const blendBackdrop =
					item.blendMode && item.blendMode !== "normal"
						? this.snapshotBelowSource()
						: null;
				this.addLayerMesh(item, z, blendBackdrop);
				z += 1;
				if (this.layerMeshes.length === 0) return;
				renderer.setRenderTarget(accumRT);
				// Text / pack PP must not leave a non-full viewport; video/image need full accum.
				renderer.setViewport(0, 0, accumRT.width, accumRT.height);
				renderer.setScissorTest(false);
				renderer.autoClear = false;
				renderer.render(scene, camera);
				didDraw = true;
				layersBelow += 1;
				this.clearLayerMeshes();
			} finally {
				if (perfMarks) layerMs += performance.now() - layerT0;
			}
		};

		for (const item of frame.items) {
			if (item.type === "sceneEffect") {
				const packId = parseVfxPackIdFromEffectType({
					effectType: item.effectType,
				});
				if (packId) {
					framePackIds.add(packId);
					// accum holds the FULL blend of every layer below this pack
					const packT0 = perfMarks ? performance.now() : 0;
					await this.renderOnePack({
						packId,
						width: frame.width,
						height: frame.height,
						contentScale: frame.contentScale || 1,
						clearFirst: !didDraw,
						target: accumRT,
						layersBelowCount: layersBelow,
						liveParams: mergeSceneEffectLiveParams({
							elementId: item.elementId,
							effectParams: item.effectParams,
						}),
						clipLocalTime: item.clipLocalTime ?? 0,
						clipDurationSec: item.clipDurationSec ?? 0,
						stickerAnims: item.stickerAnims,
					});
					if (perfMarks) packMs += performance.now() - packT0;
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
				const transT0 = perfMarks ? performance.now() : 0;
				const fromRT = this.transitionFromRT;
				const toRT = this.transitionToRT;
				const texFrom = fromRT
					? await this.renderTransitionSide({
							side: item.from,
							target: fromRT,
							width: frame.width,
							height: frame.height,
						})
					: null;
				const texTo = toRT
					? await this.renderTransitionSide({
							side: item.to,
							target: toRT,
							width: frame.width,
							height: frame.height,
						})
					: null;
				if (perfMarks) {
					recordSpan({
						name: "transition:sides",
						durationMs: performance.now() - transT0,
					});
				}
				// Always replace: uFrom/uTo already include fill+media. Alpha-blending
				// over a leftover sibling fill makes letterbox look "stuck" while media fades.
				await this.renderOnePack({
					packId: item.packId,
					width: frame.width,
					height: frame.height,
					clearFirst: true,
					target: accumRT,
					layersBelowCount: layersBelow,
					clipLocalTime: item.packTimelineTimeSec,
					transitionInputs: texFrom && texTo ? { texFrom, texTo } : null,
				});
				if (perfMarks) packMs += performance.now() - transT0;
				didDraw = true;
				renderer.autoClear = false;
				layersBelow += 1;
				continue;
			}

			// "flowerText" covers all timeline TextNode (plain + flower) via Text→RT→blit.
			if (item.type === "flowerText") {
				this.lastFrameFlowerTextIds.add(item.elementId);
				const textT0 = perfMarks ? performance.now() : 0;
				const drew = await this.renderOneFlowerText({
					item,
					width: frame.width,
					height: frame.height,
					clearFirst: !didDraw,
					target: accumRT,
				});
				if (perfMarks) textMs += performance.now() - textT0;
				if (drew) {
					didDraw = true;
					renderer.autoClear = false;
					layersBelow += 1;
				}
				continue;
			}

			const mediaAnim = resolveActiveMediaAnimForLayer(item);
			if (mediaAnim) {
				framePackIds.add(mediaAnim.packId);
				// Fill (sibling layer) is already on accum. Sample media alone so
				// clip-anim never moves the fill; pack composites over fill.
				const mediaTex = this.renderLayerToIsolatedTexture({ item, z });
				z += 1;
				const packT0 = perfMarks ? performance.now() : 0;
				await this.renderOnePack({
					packId: mediaAnim.packId,
					width: frame.width,
					height: frame.height,
					clearFirst: false,
					target: accumRT,
					layersBelowCount: layersBelow,
					clipLocalTime: mediaAnim.packTimeSec,
					clipDurationSec: mediaAnim.packNativeDurationSec,
					belowInputOverride: mediaTex,
				});
				if (perfMarks) packMs += performance.now() - packT0;
				didDraw = true;
				renderer.autoClear = false;
				layersBelow += 1;
				continue;
			}

			compositeOneLayer(item);
		}
		if (perfMarks) {
			const now = performance.now();
			recordSpan({ name: "three:composite", durationMs: now - perfMark });
			recordSpan({ name: "composite:layers", durationMs: layerMs });
			recordSpan({ name: "composite:packs", durationMs: packMs });
			recordSpan({ name: "composite:texts", durationMs: textMs });
			// Packs the descriptor actually referenced this frame. If this alternates
			// frame to frame, pack scenes are being torn down and rebuilt every other
			// frame — which is exactly the shape a bimodal 30ms looks like.
			incrementCounter({ name: "framePackIds", by: framePackIds.size });
			perfMark = now;
		}
		if (!didDraw) {
			renderer.setRenderTarget(accumRT);
			renderer.clear();
		}

		this.lastFramePackIds = framePackIds;

		/**
		 * Three spans, not one. This region used to be reported as a single
		 * `three:forcedOverlays`, which was misleading: the forced-overlay peek is
		 * a no-op unless something populates `activeOverlayIds`, so the number was
		 * really measuring scene maintenance. Maintenance is also where a
		 * per-frame dispose/rebuild would hide, so it gets its own line.
		 */
		let maintMark = perfMarks ? performance.now() : 0;
		this.syncPackScenes();
		if (perfMarks) {
			const now = performance.now();
			recordSpan({ name: "three:syncPackScenes", durationMs: now - maintMark });
			maintMark = now;
		}

		this.pruneFlowerTextScenes();
		if (perfMarks) {
			const now = performance.now();
			recordSpan({ name: "three:pruneTextScenes", durationMs: now - maintMark });
			perfMark = now;
		}

		// Optional force-overlay peek (packs toggled On in Effects panel).
		await this.renderForcedOverlays({
			width: frame.width,
			height: frame.height,
			skipIds: framePackIds,
			target: accumRT,
		});

		if (perfMarks) {
			const now = performance.now();
			recordSpan({ name: "three:forcedOverlays", durationMs: now - perfMark });
			perfMark = now;
		}

		// Present accum 鈫?canvas
		this.presentAccum();
		// Release beauty RTs / mask once no beauty layer has drawn for a while.
		trimBeautyPass(renderer);

		if (perfMarks) {
			recordSpan({
				name: "three:present",
				durationMs: performance.now() - perfMark,
			});
			// Compose target area. Full-screen passes cost fill rate, so this is
			// the number that explains a `three:composite` that scales with the
			// project canvas rather than with the item count.
			incrementCounter({
				name: "threeAccumPixels",
				by: accumRT.width * accumRT.height,
			});
		}

		if (isRenderPerfEnabled()) {
			incrementCounter({ name: "threeBlitFrames" });
		}
		} finally {
			this.flowerTextFullRes = false;
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
		if (presentMaterial.map !== accumRT.texture) {
			// USE_MAP define only flips on null↔texture; swapping maps needs no recompile.
			if (presentMaterial.map === null) presentMaterial.needsUpdate = true;
			presentMaterial.map = accumRT.texture;
		}
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
			this.accumRT.texture.type !== THREE.HalfFloatType;
		if (!needNew) return;

		// Every rebuild reallocates accum/pack/below/sticker targets and wipes all
		// text scenes. Seeing this once per frame means the compose size is
		// oscillating between two values.
		incrementCounter({ name: "composeTargetRebuild" });

		this.accumRT?.dispose();
		this.belowSourceRT?.dispose();
		this.mediaOnlyRT?.dispose();
		this.transitionFromRT?.dispose();
		this.transitionToRT?.dispose();
		this.inputFlipFromRT?.dispose();
		this.inputFlipToRT?.dispose();
		this.inputFlipBelowRT?.dispose();
		this.mediaOnlyRT = null;
		this.transitionFromRT = null;
		this.transitionToRT = null;
		this.inputFlipFromRT = null;
		this.inputFlipToRT = null;
		this.inputFlipBelowRT = null;
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
		this.lastBelowTexture = null;
		// Pack PP composers keep EffectComposer RTs at the old size; drop them
		// so the next filter/effect frame rebuilds at the new quality scale.
		for (const pp of this.packComposers.values()) {
			try {
				pp.dispose();
			} catch {
				/* ignore */
			}
		}
		this.packComposers.clear();

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
		this.mediaOnlyRT = makeRT(true);
		// 8-bit sRGB like the canvas frames packs sampled before; depth for 3D clip-anim packs.
		this.transitionFromRT = makeRT(true, THREE.UnsignedByteType);
		this.transitionToRT = makeRT(true, THREE.UnsignedByteType);
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
		if (
			this.blitScene &&
			this.blitMaterial?.uniforms.uResolution &&
			this.blitMaterial.uniforms.uStraightAlpha
		) {
			return;
		}
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
				uStraightAlpha: { value: 0 },
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
				uniform float uStraightAlpha;
				varying vec2 vUv;
				void main() {
					vec2 uv = uFlipY > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
					vec4 c = texture2D(tDiffuse, uv);
					if (uStraightAlpha > 0.5) {
						// Editor Viewport _blitMat contract (display-encoded, straight alpha).
						vec3 rgb = clamp(c.rgb, 0.0, 1.0);
						float a = clamp(max(c.a, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
						c = vec4(a > 1e-5 ? rgb / a : vec3(0.0), a);
					}
					gl_FragColor = c * uOpacity;
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
		 * Place source as an axis-aligned quad covering destRect in destination
		 * pixels (bottom-left origin). Optional; text layers use full-frame blit.
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

		/**
		 * Every copy is a fill-rate event: read dst-sized pixels, write dst-sized
		 * pixels, on a HalfFloat target that is 8 bytes/px. `three:composite`
		 * tracks these almost linearly, which is why it does not care that a
		 * frame only has three items. `fullscreenPass` counts them; the pixel
		 * counter converts them to per-frame traffic.
		 */
		{
			const dstW = Math.max(1, target ? target.width : renderer.domElement.width);
			const dstH = Math.max(
				1,
				target ? target.height : renderer.domElement.height,
			);
			incrementCounter({ name: "fullscreenPass" });
			incrementCounter({
				name: "fullscreenPassPixels",
				by: destRect ? destRect.w * destRect.h : dstW * dstH,
			});
		}
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
		blitMaterial.uniforms.uStraightAlpha.value = straightAlphaFromPremul ? 1 : 0;
		blitMaterial.uniformsNeedUpdate = true;

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
		blitMaterial.uniforms.uStraightAlpha.value = 0;
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
			const bound = materialWantsSamplerUvFlip(mat, BELOW_INPUT_UNIFORM_NAMES)
				? this.ensureFlippedInputTexture({ source: texture, slot: "below" })
				: texture;
			let touched = false;
			for (const name of names) {
				if (!shader.uniforms[name]) {
					shader.uniforms[name] = { value: bound };
				} else {
					shader.uniforms[name].value = bound;
				}
				touched = true;
			}
			for (const name of BELOW_INPUT_UNIFORM_NAMES) {
				if (shader.uniforms[name]) {
					shader.uniforms[name].value = bound;
					touched = true;
				}
			}
			// Null sibling samplers (e.g. map) make uInput sample black on many GPUs.
			for (const [k, u] of Object.entries(shader.uniforms)) {
				if (!u || u.value) continue;
				if (/map|input|channel|tex|sampler/i.test(k)) {
					u.value = bound;
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
				mapU.value = bound;
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


	/** Resolve pack type/scope/fit from the registry for below-input + transition aspect. */
	private lookupPackMeta(packId: string): {
		type: string;
		scope: string;
		fitMode: "crop" | "stretch";
		resolution: { width?: number; height?: number } | null;
	} | null {
		const pack = getPackRegistrySnapshot().packs.find((p) => p.id === packId);
		if (!pack) return null;
		return {
			type: String(pack.type || ""),
			scope: String(pack.scope || ""),
			fitMode: normalizeTransitionFitMode(pack.manifest?.fitMode),
			resolution:
				pack.manifest?.resolution || pack.scene?.resolution || null,
		};
	}

	/**
	 * Transition stretch keeps pack design aspect while drawing into project
	 * pixels; crop (default) matches project W/H (current behavior).
	 */
	private resolvePackCameraAspect({
		packId,
		built,
		renderW,
		renderH,
	}: {
		packId: string;
		built: BuiltPackScene;
		renderW: number;
		renderH: number;
	}): number {
		const projectAspect = renderW / Math.max(1, renderH);
		const meta = this.lookupPackMeta(packId);
		const packType = normalizeVfxPackType(meta?.type || built.packType);
		if (
			packType === "transition" &&
			meta?.fitMode === "stretch"
		) {
			return authoredAspectFromResolution(
				meta.resolution || built.resolution,
				projectAspect,
			);
		}
		return projectAspect;
	}

	/**
	 * When Editor exported sampler flipY=false, blit a V-flipped copy.
	 * RT.texture.flipY does not change sampling of on-GPU attachments.
	 */
	private ensureFlippedInputTexture({
		source,
		slot,
	}: {
		source: THREE.Texture;
		slot: "from" | "to" | "below";
	}): THREE.Texture {
		const image = source.image as
			| { width?: number; height?: number }
			| undefined;
		const w = Math.max(
			1,
			Math.floor(
				Number(image?.width) ||
					this.initializedSize?.width ||
					this.accumRT?.width ||
					1,
			),
		);
		const h = Math.max(
			1,
			Math.floor(
				Number(image?.height) ||
					this.initializedSize?.height ||
					this.accumRT?.height ||
					1,
			),
		);
		const key =
			slot === "from"
				? "inputFlipFromRT"
				: slot === "to"
					? "inputFlipToRT"
					: "inputFlipBelowRT";
		let rt = this[key];
		if (!rt || rt.width !== w || rt.height !== h) {
			rt?.dispose();
			rt = new THREE.WebGLRenderTarget(w, h, {
				type: THREE.UnsignedByteType,
				depthBuffer: false,
				stencilBuffer: false,
			});
			rt.texture.colorSpace = THREE.SRGBColorSpace;
			rt.texture.flipY = false;
			rt.texture.generateMipmaps = false;
			this[key] = rt;
		}
		this.blitTextureToTarget({
			source,
			target: rt,
			flipY: true,
			clear: true,
			blend: "replace",
		});
		return rt.texture;
	}

	/**
	 * Bind outgoing/incoming cut sides (render-target textures). Their row
	 * order already matches the flipY uploads pack materials expect.
	 * Materials with exported flipY=false get a V-flipped copy.
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
		bindTransitionInputTextures({
			root: built.root,
			materialsByUuid: built.materialsByUuid,
			texFrom: transitionInputs.texFrom,
			texTo: transitionInputs.texTo,
			mapSlotTexture: (mat, slot, tex) => {
				const names =
					slot === "from"
						? TRANSITION_FROM_UNIFORM_NAMES
						: TRANSITION_TO_UNIFORM_NAMES;
				if (!materialWantsSamplerUvFlip(mat, names)) return tex;
				return this.ensureFlippedInputTexture({ source: tex, slot });
			},
		});
	}

	/**
	 * Draw one media layer into mediaOnlyRT (transparent clear). Used so
	 * clip-anim packs sample media without the fill sibling.
	 */
	private renderLayerToIsolatedTexture({
		item,
		z,
	}: {
		item: Extract<FrameItemDescriptor, { type: "layer" }>;
		z: number;
	}): THREE.Texture | null {
		const renderer = this.renderer;
		const scene = this.scene;
		const camera = this.camera;
		const mediaOnlyRT = this.mediaOnlyRT;
		if (!renderer || !scene || !camera || !mediaOnlyRT) return null;

		this.clearLayerMeshes();
		this.addLayerMesh(item, z, null);
		if (this.layerMeshes.length === 0) return null;

		renderer.setRenderTarget(mediaOnlyRT);
		renderer.setViewport(0, 0, mediaOnlyRT.width, mediaOnlyRT.height);
		renderer.setScissorTest(false);
		renderer.setClearColor(0x000000, 0);
		renderer.clear(true, true, true);
		renderer.autoClear = false;
		renderer.render(scene, camera);
		this.clearLayerMeshes();
		renderer.initTexture(mediaOnlyRT.texture);
		return mediaOnlyRT.texture;
	}

	/**
	 * Composite one cut side (fill, then placed media with grade / clip-anim)
	 * into its own target. That texture is the pack's uFrom / uTo, so the side
	 * never leaves the GPU.
	 */
	private async renderTransitionSide({
		side,
		target,
		width,
		height,
	}: {
		side: TransitionSideDescriptor;
		target: THREE.WebGLRenderTarget;
		width: number;
		height: number;
	}): Promise<THREE.Texture | null> {
		const renderer = this.renderer;
		const scene = this.scene;
		const camera = this.camera;
		if (!renderer || !scene || !camera) return null;

		renderer.getClearColor(this.clearScratch);
		const prevClearAlpha = renderer.getClearAlpha();
		renderer.setRenderTarget(target);
		renderer.setViewport(0, 0, target.width, target.height);
		renderer.setScissorTest(false);
		// Transparent outside the media, unless fill is on: then an opaque plate
		// so a crossfade cannot reveal anything through the letterbox.
		renderer.setClearColor(0x000000, side.opaqueBase ? 1 : 0);
		renderer.clear(true, true, true);
		renderer.setClearColor(this.clearScratch, prevClearAlpha);

		let z = 0;
		for (const layer of side.layers) {
			const mediaAnim = resolveActiveMediaAnimForLayer(layer);
			if (mediaAnim) {
				// Same as a normal clip: pack samples the media alone, over the fill.
				const mediaTex = this.renderLayerToIsolatedTexture({ item: layer, z });
				z += 1;
				await this.renderOnePack({
					packId: mediaAnim.packId,
					width,
					height,
					clearFirst: false,
					target,
					clipLocalTime: mediaAnim.packTimeSec,
					clipDurationSec: mediaAnim.packNativeDurationSec,
					belowInputOverride: mediaTex,
				});
				continue;
			}
			this.clearLayerMeshes();
			this.addLayerMesh(layer, z, null);
			z += 1;
			if (this.layerMeshes.length === 0) continue;
			renderer.setRenderTarget(target);
			renderer.setViewport(0, 0, target.width, target.height);
			renderer.setScissorTest(false);
			renderer.autoClear = false;
			renderer.render(scene, camera);
			this.clearLayerMeshes();
		}
		return target.texture;
	}

	private async renderOnePack({
		packId,
		width,
		height,
		contentScale = 1,
		clearFirst,
		target,
		layersBelowCount = 0,
		liveParams = null,
		clipLocalTime = 0,
		clipDurationSec = 0,
		stickerAnims = null,
		transitionInputs = null,
		belowInputOverride = null,
	}: {
		packId: string;
		width: number;
		height: number;
		/** buffer / logical — NLE positions are logical pixels. */
		contentScale?: number;
		clearFirst: boolean;
		target: THREE.WebGLRenderTarget | null;
		layersBelowCount?: number;
		liveParams?: ParamValues | null;
		/** Clip-local seconds for sampling pack .anim. */
		clipLocalTime?: number;
		clipDurationSec?: number;
		stickerAnims?: import("@/timeline").StickerAnimAssignment | null;
		/** Outgoing / incoming cut sides (render-target textures). */
		transitionInputs?: {
			texFrom: THREE.Texture;
			texTo: THREE.Texture;
		} | null;
		/** When set, bind this as uInput instead of snapshotting accum. */
		belowInputOverride?: THREE.Texture | null;
	}) {
		const renderer = this.renderer;
		const accumRT = this.accumRT;
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
		// Default IBL must be baked on this draw renderer (throwaway context = black).
		if (built.pendingDefaultEnvironment) {
			ensureBuiltPackDefaultEnvironment({ built, renderer });
		}
		const meta = this.lookupPackMeta(packId);
		const nativeSticker =
			normalizeVfxPackType(meta?.type || built.packType) === "sticker";
		// Stickers keep pack design resolution (e.g. 400×400) — same source as
		// selection bounds (stickerPackSourceSize). Never fall back to canvas size
		// or contain-fit / drag travel desyncs from the handle box.
		const packSize = nativeSticker
			? resolveStickerPackRenderSize({
					packId,
					builtResolution: built.resolution,
				})
			: null;
		const renderW = packSize ? packSize.width : width;
		const renderH = packSize ? packSize.height : height;
		if (built.camera instanceof THREE.PerspectiveCamera) {
			built.camera.aspect = this.resolvePackCameraAspect({
				packId,
				built,
				renderW,
				renderH,
			});
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
			// fcc-tl-flower-57: pass continuous local time while playing so
			// samplePackTimeline tVideo free-runs (anim still frame-snaps inside).
			const tlT =
				clipLocalTime +
				(nlePlaying ? getPackVideoPreviewMediaTimeBiasSec() : 0);
			for (const asset of timelines) {
				samplePackTimeline({
					root: built.root,
					asset,
					t: tlT,
					animByName,
					objectsByUuid: built.objectsByUuid,
					animOpts: {
						materialsByUuid: built.materialsByUuid,
						postProcess: built.postProcess,
						objectsByUuid: built.objectsByUuid,
					},
					timelinePlaying: nlePlaying,
					seekVideo: (obj, mediaTimeSec, opts) =>
						seekPackTimelineVideo(obj, mediaTimeSec, {
							...opts,
							// Export: force discrete seeks so settlePackVideos can blit.
							precise: !!this.exportSizeLock || opts?.precise,
						}),
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

		// fcc-tl-flower-29: export advances wall-clock-independent frames; HTMLVideo
		// seek is async (gif/seq sample sync). Await seeked then blit again so pack
		// VideoPlayers are not black/stale in the encoded file.
		if (this.exportSizeLock) {
			await settlePackVideosForCapture(renderer, built.root, clipLocalTime);
		}

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
				const resW = Math.max(1, renderW); // fcc-tl-flower-31: project (or pack for stickers)
				const resH = Math.max(1, renderH);
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
		const isClipAnim =
			normalizeVfxPackType(meta?.type || built.packType) === "clip-anim";
		// Clip-anim draws over an already-composited fill sibling. Authored packs
		// may still carry an opaque Color background — that would wipe the fill.
		const clearPackBackground = nativeSticker || isClipAnim;
		const prevPackBackground = clearPackBackground ? packScene.background : null;
		if (clearPackBackground) packScene.background = null;

		/** Pack-internal split: below snapshot vs the pack draw itself. */
		const packPerf = isRenderPerfEnabled();
		let packMark = 0;
		const startSlice = () => {
			if (packPerf) packMark = performance.now();
		};
		const endSlice = (name: string) => {
			if (packPerf) recordSpan({ name, durationMs: performance.now() - packMark });
		};

		const bindBelow = (texture: THREE.Texture | null) => {
			if (!texture) return;
			this.bindBelowInputTexture({ built, texture });
		};
		// Clip-anim must replace the media (slide/wipe). Keeping the below
		// composite under the mesh would double-draw the still frame.
		// belowInputOverride (media-only) also skips the keep-backdrop path.
		if (
			!nativeSticker &&
			samplesBelow &&
			target === accumRT &&
			!isClipAnim &&
			!belowInputOverride
		) {
			// Mesh-UV path: snapshot full below stack, bind uInput, keep composite under the mesh.
			startSlice();
			const belowTex = this.snapshotBelowSource();
			bindBelow(belowTex);
			endSlice("pack:belowSnapshot");

			// uInput samples the snapshot, so the pack can draw straight onto accum
			// (the backdrop) without a feedback loop. Fresh depth/stencil only.
			startSlice();
			renderer.setRenderTarget(accumRT);
			renderer.clear(false, true, true);
			drawPackTo(accumRT, { clearFirst: false, keepDepth: true });
			// Later layers expect the empty depth/stencil a copied-back accum had.
			renderer.setRenderTarget(accumRT);
			renderer.clear(false, true, true);
			endSlice("pack:draw");
		} else if (needsBelow && samplesBelow) {
			bindBelow(belowInputOverride ?? this.snapshotBelowSource());
			if (clearFirst && !nativeSticker) {
				renderer.setClearColor(0x000000, 1);
			}
			startSlice();
			drawPackTo(packTarget, { clearFirst: packClear, keepDepth: !packClear });
			endSlice("pack:draw");
		} else if (needsBelow && !samplesBelow) {
			bindBelow(belowInputOverride ?? this.snapshotBelowSource());
			startSlice();
			drawPackTo(packTarget, { clearFirst: packClear, keepDepth: !packClear });
			endSlice("pack:draw");
		} else if (belowInputOverride) {
			bindBelow(belowInputOverride);
			startSlice();
			drawPackTo(packTarget, { clearFirst: packClear, keepDepth: !packClear });
			endSlice("pack:draw");
		} else if (packClear) {
			startSlice();
			drawPackTo(packTarget, { clearFirst: true });
			endSlice("pack:draw");
		} else {
			startSlice();
			drawPackTo(packTarget, { clearFirst: false, keepDepth: true });
			endSlice("pack:draw");
		}

		if (clearPackBackground) packScene.background = prevPackBackground;
		if (nativeSticker && stickerRT && target) {
			const placement = scaleStickerPlacementToBuffer({
				placement: readStickerPlacement(liveParams),
				contentScale,
			});
			// Use the actual destination RT size so NDC offset matches the buffer
			// (same space as computeVisualTransform / contentScale).
			const destW = Math.max(1, target.width || width);
			const destH = Math.max(1, target.height || height);
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
				const pixel = Math.min(destW / renderW, destH / renderH);
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
					destWidth: destW,
					destHeight: destH,
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
		const resW = Math.max(1, width); // fcc-tl-flower-31: caller size (project or pack)
		const resH = Math.max(1, height);
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
		const wantsBelowEarly =
			built.belowInputUniformNames.length > 0 || built.needsBelowInput;
		// Filter/effect `$camera` inputs sample the below composite (editor beauty).
		const beautyForCustom =
			wantsBelowEarly && this.lastBelowTexture ? this.lastBelowTexture : null;
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
				resolveAssetUrl: built.resolveAssetUrl,
				beautyTexture: beautyForCustom,
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
				beautyTexture: beautyForCustom,
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
			// Keep `$camera` on the live below plate (createPasses closed over customCtx).
			if (builtPp?.customCtx) {
				builtPp.customCtx.__fccBeautyTexture = this.lastBelowTexture;
			}
		}
		this.bindCutTransitionInputs({ built, transitionInputs });
		const resW = Math.max(1, width); // fcc-tl-flower-31: not pack design resolution
		const resH = Math.max(1, height);

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
		// EffectComposer sets viewport to its FBO size; restore so
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

	private async renderForcedOverlays({
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
			await this.renderOnePack({
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
	): THREE.WebGLRenderTarget {
		this.textLayerRT = ensureTextLayerRenderTarget(this.textLayerRT, width, height, {
			stencilBuffer: true,
			depthBuffer: true,
		});
		return this.textLayerRT;
	}

	/** Drop flower-text scene + any cached pack PP composers bound to its root. */
	private disposeFlowerTextEntry(elementId: string) {
		const entry = this.flowerTextScenes.get(elementId);
		if (entry) {
			try {
				entry.disposeTplProps?.();
			} catch {
				/* ignore */
			}
			try {
				disposeTextTemplateMedia(entry.built.root);
			} catch {
				/* ignore */
			}
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

	private async ensureFrameFlowerTexts(frame: FrameDescriptor): Promise<void> {
		const waits: Promise<void>[] = [];
		for (const item of frame.items) {
			if (item.type !== "flowerText") continue;
			waits.push(
				this.ensureFlowerTextBuilt({
					elementId: item.elementId,
					contentHash: item.contentHash,
					props: item.props,
				}),
			);
		}
		if (waits.length) await Promise.all(waits);
	}

	/**
	 * Wait until Troika Text meshes under root have glyphs.
	 * IMPORTANT: Troika's sync(cb) only calls cb when _needsSync was true at
	 * call time. After buildPackScene's syncText already started/finished a
	 * sync, a naive sync(cb) never fires → Promise hangs → export/preview await
	 * never completes (preview renderingRef stuck → blank text forever).
	 */
	private syncTroikaTextsInRoot(root: THREE.Object3D): Promise<void> {
		const pending: Promise<void>[] = [];
		root.traverse((obj) => {
			const mesh = obj as {
				sync?: (cb?: () => void) => void;
				_needsSync?: boolean;
				_isSyncing?: boolean;
				textRenderInfo?: unknown;
				addEventListener?: (type: string, listener: () => void) => void;
				removeEventListener?: (type: string, listener: () => void) => void;
			};
			if (typeof mesh.sync !== "function") return;
			// Skip non-Troika objects that happen to expose .sync
			if (mesh._needsSync === undefined && !("textRenderInfo" in mesh)) return;

			pending.push(
				new Promise<void>((resolve) => {
					let settled = false;
					const done = () => {
						if (settled) return;
						settled = true;
						resolve();
					};
					try {
						// In-flight: sync(cb) would no-op (_needsSync already cleared).
						if (mesh._isSyncing) {
							if (typeof mesh.addEventListener !== "function") {
								done();
								return;
							}
							const onComplete = () => {
								mesh.removeEventListener?.("synccomplete", onComplete);
								done();
							};
							mesh.addEventListener("synccomplete", onComplete);
							// Race: completed between check and subscribe
							if (!mesh._isSyncing) {
								mesh.removeEventListener?.("synccomplete", onComplete);
								done();
							}
							return;
						}
						// Already have glyphs and nothing dirty
						if (mesh.textRenderInfo != null && !mesh._needsSync) {
							done();
							return;
						}
						// Needs (or force) a sync so the callback path runs
						if (!mesh._needsSync) {
							mesh._needsSync = true;
						}
						mesh.sync!(() => done());
					} catch {
						done();
					}
				}),
			);
		});
		return pending.length ? Promise.all(pending).then(() => undefined) : Promise.resolve();
	}

	/**
	 * Build (or reuse) the synthetic Troika flower-text scene.
	 * Preview used to fire-and-forget + bumpFlowerTextFrameEpoch; export encodes
	 * each frame once, so we MUST await buildPackScene + Troika sync or text is blank.
	 */
	private ensureFlowerTextBuilt({
		elementId,
		contentHash,
		props,
	}: {
		elementId: string;
		contentHash: string;
		props: TimelineFlowerTextProps;
	}): Promise<void> {
		const existing = this.flowerTextScenes.get(elementId);
		if (existing && existing.hash === contentHash) {
			// fcc-tl-flower-19: if clip has mediaPlayers but prepare never attached
			// caches (pack registered late / first build raced builtin load), rebuild.
			const needMedia = !!(props.textTemplateMediaPlayers && props.textTemplateMediaPlayers.length);
			if (needMedia) {
				let hasCache = false;
				existing.built.root.traverse((o) => {
					if ((o.userData as { __fccMediaCache?: unknown }).__fccMediaCache) hasCache = true;
				});
				if (hasCache) return Promise.resolve();
				// fall through to rebuild
			} else {
				return Promise.resolve();
			}
		}

		const key = `${elementId}::${contentHash}`;
		this.flowerTextDesiredHash.set(elementId, contentHash);
		const inflight = this.flowerTextBuildPromises.get(key);
		if (inflight) return inflight;

		if (existing) {
			// Also drop stale :textanim-pp composers (RenderPass still holds old root).
			this.disposeFlowerTextEntry(elementId);
		}

		const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + elementId;
		const pack = buildSyntheticFlowerTextPack({ packId, props });

		const promise = (async () => {
			try {
				// Merge art-text flower pack bytes so flowerStyle textures/… resolve.
				const srcId =
					props.textTemplatePackId || props.flowerTemplateId || null;
				if (srcId) {
					let sourcePack =
						getPackRegistrySnapshot().packs.find((e) => e.id === srcId) ||
						null;
					if (!sourcePack) {
						try {
							await loadFlowerPackCatalog();
						} catch {
							/* ignore */
						}
						sourcePack =
							getPackRegistrySnapshot().packs.find((e) => e.id === srcId) ||
							null;
					}
					if (sourcePack) {
						for (const [k, v] of sourcePack.files) {
							if (!pack.files.has(k)) pack.files.set(k, v);
						}
						for (const [k, v] of sourcePack.objectUrls) {
							if (!pack.objectUrls.has(k)) pack.objectUrls.set(k, v);
						}
					}
				}
				const built = await buildPackScene({
					pack,
					renderer: this.renderer,
				});
				if (!built) return;
				if (built.pendingDefaultEnvironment && this.renderer) {
					ensureBuiltPackDefaultEnvironment({
						built,
						renderer: this.renderer,
					});
				}
				// A newer contentHash may have started while we awaited — do not clobber it.
				if (this.flowerTextDesiredHash.get(elementId) !== contentHash) {
					disposeBuiltPackScene({ built });
					return;
				}
				// Replace any prior root and drop composers still bound to it.
				this.disposeFlowerTextEntry(elementId);
				let tplMaterialsByUuid: Map<string, THREE.Material> | undefined;
				let tplPropCamera:
					| THREE.PerspectiveCamera
					| THREE.OrthographicCamera
					| null
					| undefined;
				let hasTplProps = false;
				let disposeTplProps: (() => void) | undefined;
				await this.syncTroikaTextsInRoot(built.root);
				// Text-template gif/seq/video → RT (bytes from source pack in registry).
				const tplPackId = props.textTemplatePackId;
				const mediaPlayers = props.textTemplateMediaPlayers;
				let sourcePack =
					tplPackId
						? getPackRegistrySnapshot().packs.find((e) => e.id === tplPackId) ||
							null
						: null;
				// Flower Effects art-text packs register during catalog load; await if raced.
				if (
					!sourcePack &&
					tplPackId &&
					mediaPlayers &&
					mediaPlayers.length
				) {
					try {
						await loadFlowerPackCatalog();
					} catch {
						/* ignore */
					}
					sourcePack =
						getPackRegistrySnapshot().packs.find((e) => e.id === tplPackId) ||
						null;
				}
				if (sourcePack && mediaPlayers && mediaPlayers.length) {
					try {
						await prepareTextTemplateMediaOnRoot({
							root: built.root,
							pack: sourcePack,
							mediaPlayers: mediaPlayers as import("@/vfxpack/text-template-media").TextTemplateMediaPlayerSpec[],
						});
					} catch (err) {
						console.warn("[FreeFilmCut] text-template media prepare failed", err);
					}
					// Bind flowerStyle uFccTex / sticker maps to live RTs before first paint.
					rebindPackRenderTextures(built.root);
				}
				// Graft Box/Cube + materials map for shader stickers (fcc-tl-flower-16).
				// Skip for art-text flower Effects that only need MediaPlayer->RT (no props/stickers).
				const needTplPropsGraft =
					!!sourcePack &&
					!!sourcePack.scene &&
					(sceneHasTextTemplatePropMeshes(sourcePack) ||
						!!(props.textStickers && props.textStickers.length));
				if (needTplPropsGraft && sourcePack) {
					try {
						const grafted = await graftTextTemplateSceneProps({
							targetRoot: built.root,
							sourcePack,
						});
						tplMaterialsByUuid = grafted.materialsByUuid;
						tplPropCamera = grafted.camera;
						hasTplProps = grafted.hasProps;
						disposeTplProps = grafted.dispose;
						rebindPackRenderTextures(built.root);
					} catch (err) {
						console.warn("[FreeFilmCut] text-template scene props graft failed", err);
					}
				}
				this.flowerTextScenes.set(elementId, {
					built,
					hash: contentHash,
					pack,
					tplMaterialsByUuid,
					tplPropCamera,
					hasTplProps,
					disposeTplProps,
				});
				// Preview skips same-frame redraws; wake it now that Troika scene exists.
				bumpFlowerTextFrameEpoch();
			} catch (err) {
				console.error("[FreeFilmCut] flower text scene build failed", err);
			} finally {
				this.flowerTextBuildPromises.delete(key);
			}
		})();

		this.flowerTextBuildPromises.set(key, promise);
		return promise;
	}

	/**
	 * Timeline text layer (plain Default + flower) → TextLayer RT → alpha blit onto accum.
	 * Frame type stays "flowerText"; plain uses solid-face default FlowerStyle
	 * (resolveTimelineFlowerTextProps). Step-2 per-text FX hooks after RT rasterization.
	 */
	private async renderOneFlowerText({
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
	}): Promise<boolean> {
		const renderer = this.renderer;
		if (!renderer) return false;

		// Warm Local Font Access blob before Troika sync (family names need a file URL).
		{
			const family = String(item.props.fontFamily || "").trim();
			if (family && !looksLikeFontUrlOrPackPath(family)) {
				try {
					const { ensureLocalFontUrl } = await import("@/fonts/local-fonts");
					await ensureLocalFontUrl({ family });
				} catch {
					/* keep bundled Noto fallback */
				}
			}
		}

		this.ensureFlowerTextBuilt({
			elementId: item.elementId,
			contentHash: item.contentHash,
			props: item.props,
		});
		const entry = this.flowerTextScenes.get(item.elementId);
		if (!entry) return false;

		const { built } = entry;
		if (built.pendingDefaultEnvironment) {
			ensureBuiltPackDefaultEnvironment({ built, renderer });
		}
		let props = item.props;
		const textAnimPayloadForPack = (packId: string) => {
			let pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
			// fcc-tl-flower-61: revive ::embedded-textanim after refresh (virtual pack not persisted).
			if (!pack && typeof packId === "string" && packId.endsWith("::embedded-textanim")) {
				const parentId = packId.slice(0, -"::embedded-textanim".length);
				const parent = getPackRegistrySnapshot().packs.find((entry) => entry.id === parentId);
				if (parent && normalizeVfxPackType(parent.type) === "text-template") {
					ensureEmbeddedTextAnimFromTemplatePack(parent);
					pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
				}
			}
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
		// Export (flowerTextFullRes): always project/engineering pixels — never 0.5x preview.
		const previewScale = this.flowerTextFullRes
			? 1
			: this.flowerTextPreviewScale(resW, width);

		// Refresh fccUI + bake NLE transform into RectTransform so a single layout pass wins.
		// When text-anim char-split is active, skip parent __fccSyncText here — applyActiveTextAnimPack
		// hides originals; a parent rebuild/Troika callback would draw a second layer (rest + offset chars).
		// fcc-tl-flower-61: rehydrate textAnims if lost, or ensure virtual pack for saved assignment.
		let textAnimsForClip = item.textAnims;
		if (props.textTemplatePackId) {
			const tplPack = getPackRegistrySnapshot().packs.find(
				(e) => e.id === props.textTemplatePackId,
			);
			if (tplPack && normalizeVfxPackType(tplPack.type) === "text-template") {
				const ensured = ensureEmbeddedTextAnimFromTemplatePack(tplPack);
				const hasAssign =
					!!(
						textAnimsForClip?.in ||
						textAnimsForClip?.out ||
						textAnimsForClip?.loop
					);
				if (!hasAssign && ensured) textAnimsForClip = ensured;
			}
		}
		const activePack = textAnimsForClip
			? resolveActiveTextAnimPack({
					textAnims: textAnimsForClip,
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
			(ui as { italic?: boolean }).italic = props.fontStyle === "italic";
			(ui as { fontStyle?: string }).fontStyle =
				props.fontStyle === "italic" ? "italic" : "normal";
			ui.letterSpacing = props.letterSpacing;
			ui.lineHeight = props.lineHeight;
			// Stickers + textAnim read ui.fontUrl; scene-builder resolveFont(ui.font).
			// fcc-tl-flower-52: honor pack/custom font from params.fontFamily (blob / fonts/).
			{
				const fontUrl = resolveTroikaFontUrl(props.fontFamily, props.textTemplatePackId);
				(ui as { font?: string }).font = fontUrl;
				(ui as { fontUrl?: string }).fontUrl = fontUrl;
			}
			ui.flowerStyle = props.flowerStyle;
			ui.flowerBaseFontSize = props.flowerBaseFontSize ?? undefined;
			(ui as { textFxStack?: unknown }).textFxStack = props.textFxStack ?? null;
			// fcc-tl-flower-24: packId on ui so pose can read pack scene scale/offset SoT.
			(ui as { textTemplatePackId?: string | null }).textTemplatePackId =
				props.textTemplatePackId ?? null;
			(ui as { __fccTextTemplatePackId?: string | null }).__fccTextTemplatePackId =
				props.textTemplatePackId ?? null;
			(ui as { textStickers?: unknown }).textStickers = Array.isArray(
				props.textStickers,
			)
				? props.textStickers.map((s) =>
						normalizeTextSticker(
							(s && typeof s === "object"
								? s
								: null) as Record<string, unknown> | null,
						),
					)
				: null;
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
		// Payload that owns the PP stack (active phase, or hold-gap In/loop/out).
		// Must stay set in hold so OutputPass toneMapping/background match mid-anim
		// (activePack is null after In ends — falling back to Neutral looks like extra sRGB).
		let ppSourcePayload: import("@/vfxpack/text-anim-motion").TextAnimPackPayload | null =
			activePack?.payload ?? null;
		if (textAnimsForClip) {
			packPostProcess = activePack
				? samplePackPostProcess(
						activePack.payload,
						activePack.phaseLocalTime,
						activePack.loop,
					)
				: null;
			// fcc-tl-flower-21 hold-gap: after In ends resolveActiveTextAnimPack is null,
			// but template camera PP tracks (bloom strength etc.) must still sample.
			// fcc-tl-flower-30: also keep hold payload for toneMapping/exposure/bg.
			if (!packPostProcess) {
				const assign = textAnimsForClip;
				const holdId =
					assign.in?.packId ||
					assign.loop?.packId ||
					assign.out?.packId ||
					"";
				const holdPayload = holdId ? textAnimPayloadForPack(holdId) : null;
				if (holdPayload?.postProcess?.effects?.length) {
					const authored = Math.max(
						0.1,
						Number(holdPayload.duration) || 1,
					);
					const t = Math.min(
						Math.max(0, item.clipLocalTime ?? 0),
						authored,
					);
					packPostProcess = samplePackPostProcess(holdPayload, t, false);
					ppSourcePayload = holdPayload;
				}
			}
			const uiPose = applyActiveTextAnimPack({
				root: built.root,
				textAnims: textAnimsForClip,
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

		// Template camera PP may also live on props.textFxStack (no textAnims).
		if (
			!packPostProcess &&
			props.textFxStack &&
			typeof props.textFxStack === "object" &&
			Array.isArray((props.textFxStack as { effects?: unknown[] }).effects) &&
			(props.textFxStack as { effects: unknown[] }).effects.length > 0
		) {
			packPostProcess =
				props.textFxStack as import("@/vfxpack/text-anim-motion").TextAnimPackPayload["postProcess"];
			// Prefer template pack output contract when no textAnim phase is active.
			if (!ppSourcePayload && props.textTemplatePackId) {
				const tpl = getPackRegistrySnapshot().packs.find(
					(e) => e.id === props.textTemplatePackId,
				);
				const mo = tpl
					? (tpl.manifest as {
							output?: { toneMapping?: string | number; toneMappingExposure?: number };
							background?: { type?: string; color?: string };
					  })
					: null;
				if (mo) {
					ppSourcePayload = {
						duration: 1,
						tracks: [],
						postProcess: packPostProcess,
						output: mo.output,
						background: mo.background,
					} as import("@/vfxpack/text-anim-motion").TextAnimPackPayload;
				}
			}
		}

		// fcc-tl-flower-21: text-template camera PP tracks (PerspectiveCamera.anim)
		// sample against clip-local time so bloom matches editor without re-export.
		if (
			packPostProcess &&
			props.textTemplatePackId &&
			typeof props.textTemplatePackId === "string"
		) {
			const src =
				getPackRegistrySnapshot().packs.find(
					(e) => e.id === props.textTemplatePackId,
				) || null;
			if (src) {
				packPostProcess = samplePackAnimPostProcess(
					src,
					packPostProcess,
					item.clipLocalTime ?? 0,
				);
			}
		}

		// MediaFramePlayers → RT first so sticker shader map / fccRtSlots see a live frame.
		// Then stickers sample park-aware glyph AABB (fcc-tl-flower-21 / fcc-ui-198).
		if (props.textTemplateMediaPlayers?.length) {
			// Export: await HTMLVideo seeked before blit (gif/seq already sync).
			// Preview: keep fire-and-forget drive; seeked bumps frame epoch for RAF.
			if (this.flowerTextFullRes) {
				await driveTextTemplateMediaForExport({
					renderer,
					root: built.root,
					mediaTimeSec: item.clipLocalTime ?? 0,
					clipKey: item.elementId,
				});
			} else {
				// fcc-tl-flower-57: while NLE playing, bias media time with continuous
				// playhead (editor tVideo). TextAnim/PP keep frame-snapped clipLocalTime.
				const playing = getPackVideoPreviewPlaying();
				const mediaBias = playing ? getPackVideoPreviewMediaTimeBiasSec() : 0;
				driveTextTemplateMedia({
					renderer,
					root: built.root,
					mediaTimeSec: (item.clipLocalTime ?? 0) + mediaBias,
					playing,
					clipKey: item.elementId,
				});
			}
		}
		const matsMap = materialsMapFromUuidMap(entry.tplMaterialsByUuid);
		applyTextStickersInScene(built.root, matsMap);
		if (props.textTemplateMediaPlayers?.length) {
			// fcc-tl-flower-56: MUST run every frame. applyTextStickers resets rt:
			// sprite maps to whiteTexture(); this restores live GIF/video RTs.
			// Gating on didBlit (flower-55) left white opaque stickers.
			bindLiveMediaToStickers({ root: built.root });
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


		// Full project / engineering resolution text RT (preview-scaled for overlay).
		// Tight AABB sizing was reverted 2026-10-23 — too many seam/viewport issues.
		const opacityMul = item.opacity * (props.opacity > 0 ? props.opacity : 1);

		if (useCameraPp && built.camera) {
			type CanvasUi = { type?: string; renderMode?: string; planeDistance?: number };
			const canvases: Array<{ obj: THREE.Object3D; ui: CanvasUi }> = [];
			built.root.traverse((obj) => {
				const ui = getFccUI(obj) as CanvasUi | null;
				if (ui?.type === "canvas") canvases.push({ obj, ui });
			});
			const prevModes = canvases.map(({ ui }) => ui.renderMode);
			for (const { ui } of canvases) {
				ui.renderMode = "camera";
				// Editor text-template canvas uses planeDistance=100; synthetic flower
				// packs omit it — set so prepareCameraModeUI matches authored framing.
				if (ui.planeDistance == null || !(Number(ui.planeDistance) > 0)) {
					(ui as { planeDistance?: number }).planeDistance = 100;
				}
			}

			const packId = TIMELINE_FLOWER_TEXT_PACK_PREFIX + item.elementId;
			// Bloom kernels are texel-sized: keep 1:1 authored project density
			// (not preview undersample) so radius matches editor authoring.
			const ppRT = this.ensureTextLayerTarget(
				Math.max(1, Math.round(resW)),
				Math.max(1, Math.round(resH)),
			);
			const ppW = ppRT.width;
			const ppH = ppRT.height;
			const packBg = (ppSourcePayload as { background?: { type?: string; color?: string } } | null)
				?.background;
			const bgType = String(packBg?.type || "Default");
			const isTransparentBg =
				bgType === "Default" || bgType === "default" || !packBg?.type;
			const beautyClearColor = isTransparentBg
				? null
				: new THREE.Color(packBg?.color || "#000000");
			// fcc-tl-flower-21: text-template packs author a PerspectiveCamera + PP.
			// Synthetic flower packs have no camera — keep ortho pixel plane.
			// Using ortho for hello made perspective/Cube look wrong and ignored FOV.
			const authoredCam = entry.tplPropCamera;
			const useAuthoredPerspective = !!(
				authoredCam &&
				(authoredCam as THREE.PerspectiveCamera).isPerspectiveCamera
			);
			let beautyCam: THREE.Camera;
			if (useAuthoredPerspective) {
				const pCam = authoredCam as THREE.PerspectiveCamera;
				pCam.aspect = resW / Math.max(1, resH);
				pCam.updateProjectionMatrix();
				pCam.layers.enable(UI_CAMERA_LAYER);
				// Layer 0 keeps Cube/props; UI_CAMERA_LAYER keeps canvas-mode text.
				beautyCam = pCam;
			} else {
				beautyCam = this.ensureFlowerPpOrtho(resW, resH);
			}
			// fcc-tl-flower-27: applyTextStickers ran while canvas was still overlay
			// (stickers on UI_LAYER=1). Beauty only enables UI_CAMERA_LAYER=2, so
			// behind stickers never entered PP — visible result stayed AABB-flush.
			prepareCameraModeUI({
				root: built.root,
				beautyCam,
				resW,
				resH,
			});
			restampTextStickerLayersInScene(built.root);
			const hasFrontStickersPp = sceneHasFrontTextStickers(built.root);
			if (hasFrontStickersPp) setTextStickerFrontRootsVisible(built.root, false);
			try {
				this.renderPackWithPostProcess({
					packId: packId + ":textanim-pp",
					built: {
						...built,
						postProcess: packPpStack,
						resolution: { width: resW, height: resH },
						camera: beautyCam as THREE.PerspectiveCamera | THREE.OrthographicCamera,
					},
					width: Math.max(1, ppW),
					height: Math.max(1, ppH),
					target: ppRT,
					clearFirst: true,
					keepDepthClear: false,
					allowMsaa: true,
					cameraOverride: beautyCam,
					transparentClear: isTransparentBg,
					beautyClearColor,
					// fcc-tl-flower-30: use ppSourcePayload (hold pack when activePack null)
					// so none/NoToneMapping continues into hold — strength≈0 matches Bloom off.
					outputToneMapping: resolvePackOutputToneMapping(ppSourcePayload),
					outputExposure: resolvePackOutputExposure(ppSourcePayload),
				});
			} finally {
				restoreCameraModeUI(beautyCam);
				canvases.forEach(({ ui }, i) => {
					const prev = prevModes[i];
					ui.renderMode = prev === "camera" || prev === "overlay" ? prev : "overlay";
				});
				if (hasFrontStickersPp) setTextStickerFrontRootsVisible(built.root, true);
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
				opacity: opacityMul,
				straightAlphaFromPremul: false,
			});
			// Front stickers above bloom/PP composite (editor contract).
			if (hasFrontStickersPp) {
				for (const { ui } of canvases) ui.renderMode = "overlay";
				// Overlay cam only sees UI_LAYER — restamp after camera-mode PP.
				restampTextStickerLayersInScene(built.root);
				withTextContentHiddenExceptFrontStickers(built.root, () => {
					renderUIOverlay({
						renderer,
						root: built.root,
						uiCamera: this.ensureUIOverlayCamera(),
						resW,
						resH,
						target,
					});
				});
				canvases.forEach(({ ui }, i) => {
					const prev = prevModes[i];
					ui.renderMode = prev === "camera" || prev === "overlay" ? prev : "overlay";
				});
			}

			// Scene props (Box/Cube): only separate-blit when beauty used ortho
			// (authored perspective already saw layer-0 props in the PP pass).
			if (entry.hasTplProps && !useAuthoredPerspective) {
				const ppScale = previewScale;
				const propW = Math.max(1, Math.round(resW * ppScale));
				const propH = Math.max(1, Math.round(resH * ppScale));
				const propCam =
					entry.tplPropCamera ||
					(() => {
						const c = new THREE.PerspectiveCamera(50, propW / propH, 0.1, 2000);
						c.position.set(0, 0, 5);
						c.lookAt(0, 0, 0);
						c.updateProjectionMatrix();
						return c;
					})();
				const propsRT = this.ensureTextLayerTarget(propW, propH);
				const propsRoot = built.root.getObjectByName(FCC_TEXT_TEMPLATE_PROPS);
				if (propsRoot) {
					const prevVis: Array<{ obj: THREE.Object3D; v: boolean }> = [];
					built.root.traverse((o) => {
						if (o === propsRoot) return;
						let p: THREE.Object3D | null = o;
						let under = false;
						while (p) {
							if (p === propsRoot) {
								under = true;
								break;
							}
							p = p.parent;
						}
						if (!under && o !== built.root) {
							prevVis.push({ obj: o, v: o.visible });
							o.visible = false;
						}
					});
					const prevBg = (built.root as THREE.Scene).background;
					const prevAutoClear = renderer.autoClear;
					try {
						(built.root as THREE.Scene).background = null;
						renderer.setRenderTarget(propsRT);
						renderer.setClearColor(0x000000, 0);
						renderer.clear(true, true, true);
						renderer.autoClear = false;
						renderer.render(built.root as THREE.Scene, propCam);
					} finally {
						renderer.autoClear = prevAutoClear;
						(built.root as THREE.Scene).background = prevBg;
						for (const x of prevVis) x.obj.visible = x.v;
					}
					propsRT.texture.colorSpace = THREE.SRGBColorSpace;
					this.blitTextureToTarget({
						source: propsRT.texture,
						target,
						flipY: false,
						clear: false,
						blend: "alpha",
						opacity: opacityMul,
						straightAlphaFromPremul: false,
					});
				}
			}
			return true;
		}

		// Overlay UI camera → full-frame text RT → full blit (no pack PP).
		// Front stickers sit above text (+ TextFx when present); keep them out of
		// the first RT pass, then present after blit (editor Viewport contract).
		const ovW = Math.max(1, Math.round(resW * previewScale));
		const ovH = Math.max(1, Math.round(resH * previewScale));
		const textRT = this.ensureTextLayerTarget(ovW, ovH);
		const hasFrontStickers = sceneHasFrontTextStickers(built.root);
		if (hasFrontStickers) setTextStickerFrontRootsVisible(built.root, false);
		let drew = false;
		try {
			drew = renderTextLayerToTarget({
				renderer,
				root: built.root,
				uiCamera: this.ensureUIOverlayCamera(),
				resW,
				resH,
				target: textRT,
			});
			if (drew && hasFrontStickers) {
				setTextStickerFrontRootsVisible(built.root, true);
				withTextContentHiddenExceptFrontStickers(built.root, () => {
					renderUIOverlay({
						renderer,
						root: built.root,
						uiCamera: this.ensureUIOverlayCamera(),
						resW,
						resH,
						target: textRT,
					});
				});
			}
		} finally {
			if (hasFrontStickers) setTextStickerFrontRootsVisible(built.root, true);
		}
		if (!drew) return false;

		// Scene props (Box/Cube) behind text — perspective camera from template pack.
		if (entry.hasTplProps) {
			const propsRT = this.ensureTextLayerTarget(ovW, ovH);
			const propsRoot = built.root.getObjectByName(FCC_TEXT_TEMPLATE_PROPS);
			if (propsRoot) {
				const prevVis: Array<{ obj: THREE.Object3D; v: boolean }> = [];
				built.root.traverse((o) => {
					if (o === propsRoot) return;
					// Hide everything except props subtree for this pass.
					let p: THREE.Object3D | null = o;
					let under = false;
					while (p) {
						if (p === propsRoot) {
							under = true;
							break;
						}
						p = p.parent;
					}
					if (!under && o !== built.root) {
						prevVis.push({ obj: o, v: o.visible });
						o.visible = false;
					}
				});
				const prevBg = (built.root as THREE.Scene).background;
				const prevAutoClear = renderer.autoClear;
				try {
					(built.root as THREE.Scene).background = null;
					renderer.setRenderTarget(propsRT);
					renderer.setClearColor(0x000000, 0);
					renderer.clear(true, true, true);
					renderer.autoClear = false;
					const propCamOv =
						entry.tplPropCamera ||
						(() => {
							const c = new THREE.PerspectiveCamera(50, ovW / ovH, 0.1, 2000);
							c.position.set(0, 0, 5);
							c.lookAt(0, 0, 0);
							c.updateProjectionMatrix();
							return c;
						})();
					renderer.render(built.root as THREE.Scene, propCamOv);
				} finally {
					renderer.autoClear = prevAutoClear;
					(built.root as THREE.Scene).background = prevBg;
					for (const x of prevVis) x.obj.visible = x.v;
				}
				if (clearFirst) {
					renderer.setRenderTarget(target);
					renderer.setClearColor(0x000000, 0);
					renderer.clear(true, true, true);
				}
				propsRT.texture.colorSpace = THREE.SRGBColorSpace;
				this.blitTextureToTarget({
					source: propsRT.texture,
					target,
					flipY: false,
					clear: false,
					blend: "alpha",
					opacity: opacityMul,
					straightAlphaFromPremul: false,
				});
				// Text layer on top of props.
				this.blitTextureToTarget({
					source: textRT.texture,
					target,
					flipY: false,
					clear: false,
					blend: "alpha",
					opacity: opacityMul,
					straightAlphaFromPremul: false,
				});
				return true;
			}
		}

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
			// A dispose here frees geometries, materials, textures and render targets;
			// the driver may stall on it. Counted so a per-frame rebuild is visible.
			incrementCounter({ name: "packSceneDispose" });
			disposeBuiltPackScene({ built: existing });
			this.packScenes.delete(packId);
			this.packSource.delete(packId);
		}
		if (this.packBuildInFlight.has(packId)) return;

		this.packBuildInFlight.add(packId);
		// Paired with `packSceneDispose`: both climbing every frame means a
		// dispose/rebuild cycle, not a one-off rebuild after a pack re-import.
		incrementCounter({ name: "packSceneBuild" });
		const drawRenderer = this.renderer;
		void buildPackScene({ pack, renderer: drawRenderer })
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
				if (built.pendingDefaultEnvironment && this.renderer) {
					ensureBuiltPackDefaultEnvironment({
						built,
						renderer: this.renderer,
					});
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
		/**
		 * Registered packs keep their built scene.
		 *
		 * The prebuild loop at the bottom of this method rebuilds every registered
		 * pack that has a scene ("first timeline drop is snappy"). Pruning on
		 * `activeOverlayIds ∪ lastFramePackIds` alone therefore fought it: a pack
		 * that is registered but not on screen this frame was disposed here and
		 * rebuilt there, every single frame. Each cycle frees pack video elements,
		 * textures and render targets — the driver stalls on the deletes and the
		 * next frame has no scene at all, so the pack draws nothing.
		 *
		 * That is also why a pack clip only behaved while the playhead sat on it:
		 * inside the clip the pack is in `lastFramePackIds`, so it was never
		 * pruned. A pack is now torn down only when it leaves the registry.
		 */
		const registered = new Set<string>();
		for (const pack of packs) {
			if (pack.scene) registered.add(pack.id);
		}
		const keep = new Set<string>([
			...activeOverlayIds,
			...this.lastFramePackIds,
			...registered,
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
				continue;
			}
			/**
			 * fcc-tl-flower-68: a kept-alive pack that was NOT drawn this frame
			 * must not keep free-running its internal videos. `syncPackVideos`
			 * only visits packs renderOnePack drew (`lastFramePackIds` plus the
			 * always-on Effects-panel overlays), so once the playhead leaves a
			 * pack clip nothing pauses its `<video>` elements until the media
			 * runs out — audible past the clip, and the stale session would
			 * resume mid-media on re-entry instead of restarting from the clip.
			 * Parking is idempotent and cheap (paused elements are a no-op).
			 */
			if (
				!this.lastFramePackIds.has(packId) &&
				!activeOverlayIds.includes(packId)
			) {
				pausePackSceneVideos({ root: built.root });
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
		for (const [packId, built] of this.packScenes.entries()) {
			if (!(built.camera instanceof THREE.PerspectiveCamera)) continue;
			built.camera.aspect = this.resolvePackCameraAspect({
				packId,
				built,
				renderW: width,
				renderH: height,
			});
			built.camera.updateProjectionMatrix();
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
		/**
		 * Installed once per pooled material so the keyer can be toggled per
		 * layer with a uniform write — no recompile, no extra pass.
		 */
			installChromaKeyPatch({ material });
			// After keyer: Basic grade sees keyed RGB. Before blend (gl_FragColor).
			installColorGradePatch({ material });
			// Chained after the keyer patch: blend modes evaluate on gl_FragColor
			// *after* opaque_fragment, which is downstream of the keyer's edits.
			installBlendModePatch({ material });
			// Last: replace alphamap_fragment with rust-style `mix(mask, 1-mask, inverted)`.
			installMaskInvertPatch({ material });
			return new THREE.Mesh(geometry, material);
		}

	private addLayerMesh(
		item: Extract<FrameItemDescriptor, { type: "layer" }>,
		z: number,
		blendBackdrop: THREE.Texture | null = null,
	) {
		const scene = this.scene;
		if (!scene) return;

		const entry = this.cache.get(item.textureId);
		if (!entry) {
			return;
		}

		/**
		 * Do NOT flag every layer texture dirty here.
		 *
		 * `needsUpdate = true` bumps `texture.version`, and the renderer reacts
		 * by re-running the full `texImage2D` path (re-allocate + upload) instead
		 * of the cheap `updateMedia` path. At 1280x720 RGBA that is 3.7MB per
		 * texture, so three layers meant ~11MB of upload every frame.
		 *
		 * VideoTexture already self-updates inside the renderer (`updateMedia`),
		 * and CanvasTexture written by `syncRenderedTexture` flags itself. The
		 * only case that needs a nudge is a canvas someone else mutates in place.
		 */
		const layerSource =
			entry.kind === "external" && entry.frameKey === undefined
				? entry.source
				: null;
		if (isMutatedCanvasSource(layerSource)) {
			entry.texture.needsUpdate = true;
			incrementCounter({ name: "textureForceUpload" });
		}

		const mesh = this.acquireMesh();
		const material = mesh.material as THREE.MeshBasicMaterial;
		/**
		 * `material.needsUpdate` is not free: it forces `initMaterial`, which
		 * rebuilds the parameter set, re-hashes the program cache key and
		 * refreshes every uniform. Swapping `map` between two textures changes
		 * no define (`USE_MAP` stays on), so only the null/non-null transition
		 * actually requires it.
		 */
		let defineChanged = false;
		if (material.map === null) defineChanged = true;
		// Beauty is a pre-process (multi-pass RTs) of the layer map, not a material
		// patch: warp -> smooth -> whiten, then everything downstream (chroma,
		// correction, grade, mask, blend) sees the retouched pixels. Null keeps
		// the raw texture (inactive, or no analysis yet / unavailable).
		const beautyMap = this.applyBeautyToLayer(item, entry);
		material.map = beautyMap ?? entry.texture;
		material.opacity = item.opacity;
		material.transparent = true;

			if (item.mask) {
				const maskEntry = this.cache.get(item.mask.textureId);
				if (maskEntry) {
					const maskSource = maskEntry.kind === "external" ? maskEntry.source : null;
					if (isMutatedCanvasSource(maskSource)) {
						maskEntry.texture.needsUpdate = true;
						incrementCounter({ name: "textureForceUpload" });
					}
					// Mask coverage is linear 0..1 — sRGB decode would warp soft edges.
					if (maskEntry.texture.colorSpace !== THREE.NoColorSpace) {
						maskEntry.texture.colorSpace = THREE.NoColorSpace;
						maskEntry.texture.needsUpdate = true;
					}
					if (material.alphaMap === null) defineChanged = true;
					material.alphaMap = maskEntry.texture;
				} else {
					if (material.alphaMap !== null) defineChanged = true;
					material.alphaMap = null;
				}
			} else {
				if (material.alphaMap !== null) defineChanged = true;
				material.alphaMap = null;
			}
			if (defineChanged) material.needsUpdate = true;

			/**
			 * Must run before the draw and after `opacity`/`alphaMap` are set: the
			 * keyer multiplies the alpha those two already produced, so a keyed clip
			 * still respects its fade and its mask.
			 *
			 * A pooled mesh reused for an un-keyed layer is explicitly turned off
			 * here — otherwise the previous tenant's keyer would leak into it.
			 */
			applyChromaKeyToMaterial({
				material,
				chromaKey: item.chromaKey,
				// 边缘柔化 blurs the matte in texel space, so the keyer needs the
				// source texture's size. `entry` carries it for both the rendered
				// and the external path.
				texelSize:
					entry.width > 0 && entry.height > 0
						? [1 / entry.width, 1 / entry.height]
						: null,
			});
			// Always write (including null → off) so a pooled mesh does not keep the
			// previous clip's correction or grade.
			applyColorCorrectionToMaterial({
				material,
				colorCorrection: item.colorCorrection,
			});
			applyColorGradeToMaterial({
				material,
				colorGrade: item.colorGrade,
			});
			// Reset pooled meshes that previously had an inverted mask.
			applyMaskInvertToMaterial({
				material,
				inverted: Boolean(item.mask?.inverted),
			});

		/**
		 * Blend mode — must also reset pooled meshes that previously blended
		 * (the snapshot texture belongs to the *previous* layer otherwise).
		 * Backdrop texel size comes from accum, because the shader samples the
		 * backdrop by `gl_FragCoord`, not by the layer's own UVs.
		 */
		const accumForBlend = this.accumRT;
		applyBlendModeToMaterial({
			material,
			blendMode: item.blendMode,
			backdrop: blendBackdrop,
			backdropTexel: accumForBlend
				? [1 / accumForBlend.width, 1 / accumForBlend.height]
				: null,
		});

		applyQuadTransform(mesh, item.transform, z);
		scene.add(mesh);
		this.layerMeshes.push(mesh);
	}

	/** Analysis request for a beauty layer, or null when it has no beauty / key. */
	private beautyRequestFor(
		item: Extract<FrameItemDescriptor, { type: "layer" }>,
		entry: TextureCacheEntry,
	): BeautyAnalysisRequest | null {
		if (!item.beauty || !isBeautyParamsActive(item.beauty)) return null;
		if (!item.elementId || entry.width <= 0 || entry.height <= 0) return null;
		return {
			clipId: item.elementId,
			// Stills never change; video is keyed by clip-local time (quantized to
			// one 30 fps frame by the analysis cache).
			mediaTimeTicks: item.sourceIsStatic
				? 0
				: Math.max(0, Math.round((item.clipLocalTime ?? 0) * TICKS_PER_SECOND)),
			source: entry.kind === "external" ? entry.source : entry.canvas,
			width: entry.width,
			height: entry.height,
		};
	}

	/**
	 * Run the beauty pass for one layer. Preview uses the newest analysis it has
	 * (starting a background refresh), so the first frames may be unprocessed;
	 * export has already awaited the exact analysis in `ensureFrameBeauty`, so
	 * this is a cache hit there.
	 */
	private applyBeautyToLayer(
		item: Extract<FrameItemDescriptor, { type: "layer" }>,
		entry: TextureCacheEntry,
	): THREE.Texture | null {
		const renderer = this.renderer;
		if (!renderer) return null;
		const request = this.beautyRequestFor(item, entry);
		if (!request || !item.beauty) return null;
		const analysis = this.beautyRequester.request(request);
		if (!analysis) return null;
		const size = this.initializedSize;
		return applyBeautyPass({
			renderer,
			inputTexture: entry.texture,
			width: entry.width,
			height: entry.height,
			beauty: item.beauty,
			analysis,
			// Layers are drawn into the compose buffer; 2x covers zoomed clips.
			...(size ? { maxEdge: Math.min(4096, Math.max(size.width, size.height) * 2) } : {}),
		});
	}

	/**
	 * Export only: await exact face analysis for every beauty layer (including
	 * cut-transition sides) so no encoded frame is drawn unprocessed.
	 */
	private async ensureFrameBeauty(frame: FrameDescriptor): Promise<void> {
		const layers: Extract<FrameItemDescriptor, { type: "layer" }>[] = [];
		for (const item of frame.items) {
			if (item.type === "layer") layers.push(item);
			else if (item.type === "transition") {
				layers.push(...item.from.layers, ...item.to.layers);
			}
		}
		const pending: Promise<unknown>[] = [];
		for (const layer of layers) {
			const entry = this.cache.get(layer.textureId);
			if (!entry) continue;
			const request = this.beautyRequestFor(layer, entry);
			if (request) pending.push(this.beautyRequester.ensure(request));
		}
		if (pending.length > 0) await Promise.all(pending);
	}

	private syncExternalTexture(texture: ExternalTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		// fcc-tl-flower-66: static ImageBitmap/HTMLImageElement must NOT
		// needsUpdate every present — that re-uploads the whole still every RAF.
		// VideoTexture self-updates via Three texture.update() when rendered.
		if (
			previous?.kind === "external" &&
			previous.source === texture.source &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			// Scratch OffscreenCanvas for cut transitions mutates in place — must
			// re-upload or uFrom/uTo keep a stale frame (often media-only look).
			// Versioned sources (pooled video frames) only re-upload when the
			// decoded frame changed, so param scrubs on a paused frame stay cheap.
			if (isMutatedCanvasSource(texture.source)) {
				const unchangedFrame =
					texture.frameKey !== undefined &&
					previous.frameKey === texture.frameKey;
				if (unchangedFrame) {
					incrementCounter({ name: "textureFrameKeyHit" });
				} else {
					previous.texture.needsUpdate = true;
					previous.frameKey = texture.frameKey;
				}
			}
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		if (previous) {
			previous.texture.dispose();
		}

		incrementCounter({ name: "textureUpload" });
		// Split so a per-frame cache miss can be attributed: an external miss
		// means the descriptor's source identity moved (video wrapper rebuilt),
		// a rendered miss means contentHash changed and the canvas was redrawn.
		incrementCounter({ name: "texMissExternal" });
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
			frameKey: texture.frameKey,
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
		incrementCounter({ name: "texMissRendered" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});

		// Mask alphaMaps are linear coverage; sRGB would warp feathered edges and
		// break invert (`1 - g`). Stroke textures are fine as linear too.
		const isMaskTexture = texture.id.includes(":mask");
		const maskColorSpace = isMaskTexture
			? THREE.NoColorSpace
			: THREE.SRGBColorSpace;

		let threeTexture: THREE.CanvasTexture;
		if (previous?.kind === "rendered" && previous.canvas === canvas) {
			threeTexture = previous.texture;
			threeTexture.flipY = false;
			if (threeTexture.colorSpace !== maskColorSpace) {
				threeTexture.colorSpace = maskColorSpace;
			}
			threeTexture.needsUpdate = true;
		} else {
			previous?.texture.dispose();
			threeTexture = new THREE.CanvasTexture(
				canvas as unknown as HTMLCanvasElement,
			);
			threeTexture.colorSpace = maskColorSpace;
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

/**
 * True only for canvas-backed sources whose pixels may be repainted outside
 * the compositor. VideoTexture self-updates in the renderer and ImageBitmap is
 * immutable, so neither should be forced through a full upload each frame.
 */
function isMutatedCanvasSource(source: CanvasImageSource | null): boolean {
	if (!source) return false;
	if (
		typeof HTMLCanvasElement !== "undefined" &&
		source instanceof HTMLCanvasElement
	) {
		return true;
	}
	if (
		typeof OffscreenCanvas !== "undefined" &&
		source instanceof OffscreenCanvas
	) {
		return true;
	}
	return false;
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

