import "@/vfxpack/troika-preconfig";
import * as THREE from "three";
import { ColorEnvironment } from "three/addons/environments/ColorEnvironment.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Text as TroikaText } from "troika-three-text";
import { createDerivedMaterial } from "troika-three-utils";
import { FCC_TROIKA_SDF_GLYPH_SIZE } from "@/vfxpack/troika-preconfig";
import {
	FCC_FAKE_ITALIC_SHEAR_XY,
	fakeBoldExpandPx,
	isFccItalic,
} from "@/vfxpack/text-fake-style";

import type { LoadedVfxPack, VfxSceneNode } from "@/vfxpack/types";
import { getDefaultTroikaFont } from "@/fonts/default-troika-font";
import {
	ensureBelowInputUniforms,
	isBelowInputUniformName,
	packNeedsBelowInput,
	type BelowInputUniformName,
} from "@/vfxpack/below-input";
import { ensureGlobalScreenUniforms } from "@/vfxpack/global-screen-params";
import { ensureTransitionInputUniforms } from "@/vfxpack/transition-input";
import {
	normalizeExposedParams,
	type ExposedParam,
} from "@/vfxpack/exposed-params";
import {
	loadCustomDefinitions,
	registerCustomEffectsFromStack,
	type CustomEffectDefinition,
	type PostProcessStackData,
} from "@/vfxpack/postprocess";
import {
	UI_LAYER,
	UI_CAMERA_LAYER,
	applyUIObjectFlags,
	applyTroikaTextMeshLayers,
	getOwningCanvasRenderMode,
	type FccUIData,
} from "@/vfxpack/ui-overlay";
import {
	getEffectiveFlowerStyle,
	normalizeFillContent,
	contentPrimaryColor,
	contentUsesGradient,
	hexToRgb01,
	uvModeToPerCharUniform,
	type FlowerStyle,
} from "@/vfxpack/flower-style";
import { bumpFlowerTextFrameEpoch } from "@/vfxpack/flower-text-epoch";
import {
	normalizeAnim,
	type FreecapcutAnimClip,
} from "@/vfxpack/freecapcut-anim";
import type { TimelineAsset } from "@/vfxpack/timeline";
import {
	disposePackVideos,
	ensurePackRenderTargets,
	preparePackVideos,
	rebindPackRenderTextures,
} from "@/vfxpack/pack-video";

/** Baseline-anchored fake italic: x' = x + k*(y - yBottom) via makeShear(0,0,k,...). */
const _fccItalicShearMat = new THREE.Matrix4();
const _fccItalicT1 = new THREE.Matrix4();
const _fccItalicT2 = new THREE.Matrix4();
const _fccItalicLocal = new THREE.Matrix4();

function troikaLocalYBottom(troika: THREE.Object3D): number {
	const anyT = troika as THREE.Object3D & {
		textRenderInfo?: { blockBounds?: number[] };
		geometry?: THREE.BufferGeometry;
		fontSize?: number;
		anchorY?: string | number;
	};
	const bb = anyT.textRenderInfo?.blockBounds;
	if (bb && bb.length >= 4 && Number.isFinite(bb[1])) {
		return Number(bb[1]);
	}
	const g = anyT.geometry;
	if (g) {
		if (!g.boundingBox) g.computeBoundingBox();
		if (g.boundingBox && Number.isFinite(g.boundingBox.min.y)) {
			return g.boundingBox.min.y;
		}
	}
	// Pre-sync fallback (middle anchor ≈ half em below origin).
	const fs = Number(anyT.fontSize) > 0 ? Number(anyT.fontSize) : 48;
	const ay = anyT.anchorY;
	if (ay === "bottom" || ay === 0) return 0;
	if (ay === "top" || ay === "top-baseline") return -fs;
	return -fs * 0.5;
}

function applyTroikaItalicShear(
	troika: THREE.Object3D,
	italic: boolean,
): void {
	const k = italic ? FCC_FAKE_ITALIC_SHEAR_XY : 0;
	const ud = troika.userData as { __fccItalicK?: number };
	if (!italic && !ud.__fccItalicK) {
		if (troika.matrixAutoUpdate === false) {
			troika.matrixAutoUpdate = true;
			troika.updateMatrix();
		}
		return;
	}
	ud.__fccItalicK = k;
	troika.updateMatrix(); // TRS only
	if (k === 0) {
		troika.matrixAutoUpdate = true;
		return;
	}
	const yBottom = troikaLocalYBottom(troika);
	// T(yBottom) * Shear(k) * T(-yBottom)  =>  x' = x + k*(y - yBottom)
	_fccItalicT1.makeTranslation(0, -yBottom, 0);
	// Three.js makeShear(xy,xz,yx,...): first arg shears *Y by X* (stair-step!).
	// Third arg `yx` shears *X by Y*: x' = x + yx*y — correct italic lean.
	_fccItalicShearMat.makeShear(0, 0, k, 0, 0, 0);
	_fccItalicT2.makeTranslation(0, yBottom, 0);
	_fccItalicLocal.multiplyMatrices(_fccItalicT2, _fccItalicShearMat);
	_fccItalicLocal.multiply(_fccItalicT1);
	troika.matrix.multiply(_fccItalicLocal);
	troika.matrixAutoUpdate = false;
	troika.matrixWorldNeedsUpdate = true;
}

function boldExpandForUi(ui: { bold?: boolean; fontSize?: number }): number {
	return ui.bold ? fakeBoldExpandPx(ui.fontSize) : 0;
}

export type BuiltPackScene = {
	packId: string;
	/** Normalized / raw pack type from manifest (filter, effect, ...). */
	packType: string;
	/** Compose scope (below | stack | clip). */
	packScope: string;
	/** True when NLE should bind below-track composite to uInput etc. */
	needsBelowInput: boolean;
	/** Sampler names found on shaders that accept below input. */
	belowInputUniformNames: BelowInputUniformName[];
	root: THREE.Scene;
	camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
	disposables: Array<{ dispose: () => void }>;
	render?: {
		toneMapping?: number;
		toneMappingExposure?: number;
		shadows?: boolean;
		shadowType?: number;
		antialias?: boolean;
	};
	/** Camera post-process stack from Editor export. */
	postProcess?: PostProcessStackData | null;
	/** Resolve pack-relative asset paths (custom-effect textures, etc.). */
	resolveAssetUrl?: (path: string) => string | null;
	/** Materials keyed by exported uuid (for exposed uniform overrides). */
	materialsByUuid: Map<string, THREE.Material>;
	/** Params exposed to OpenCut properties / keyframes. */
	exposedParams: ExposedParam[];
	/** FreeFilmCut .anim clips packed with this scene (sampled by clip local time). */
	animClips: FreecapcutAnimClip[];
	/** FreeFilmCut NLE timelines packed with this scene. */
	timelines: TimelineAsset[];
	/** Object lookup by exported scene.json uuid (set at build; used by applyAnimToRoot). */
	objectsByUuid: Map<string, THREE.Object3D>;
	/** Bumped when build semantics change so compositor rebuilds cached scenes. */
	buildRev: number;
	/** Pack / project resolution used for Screen-Space UI layout. */
	resolution: { width: number; height: number };
	/** True when scene contains FreeFilmCut Canvas/Image nodes. */
	hasUI: boolean;
	/**
	 * Editor Default IBL not yet baked (needs the compositor WebGLRenderer).
	 * Call ensureBuiltPackDefaultEnvironment before first render.
	 */
	pendingDefaultEnvironment?: boolean;
};

/**
 * Build a Three.js scene from vfxpack scene.json:
 * Scene / Group / Bone / Object3D / Mesh / PerspectiveCamera + default lights.
 * Honors node.parent so Editor hierarchy (e.g. moved GLB root) survives in OpenCut.
 */
/** Bump when pack scene build / anim binding changes (forces compositor rebuild). */
export const PACK_SCENE_BUILD_REV = 24;

type StackEffectLike = {
	id?: string;
	type?: string;
	enabled?: boolean;
	params?: Record<string, number | boolean | string | number[]>;
	exposed?: Record<string, boolean>;
	definition?: CustomEffectDefinition;
	textureBindings?: Record<string, { rtUuid?: string }>;
};

/**
 * Prefer camera `postProcess` but pull `definition` / `textureBindings` from
 * userData.postProcessStack when the thin node stack omitted them (older packs).
 */
function resolveCameraPostProcessStack(
	nodePostProcess: PostProcessStackData | null | undefined,
	userDataStack: PostProcessStackData | null | undefined,
): PostProcessStackData | null {
	const primary = nodePostProcess || userDataStack || null;
	if (!primary || typeof primary !== "object") return null;
	const fallback = userDataStack && userDataStack !== primary ? userDataStack : null;
	const defById = new Map<string, CustomEffectDefinition>();
	const defByType = new Map<string, CustomEffectDefinition>();
	const bindById = new Map<string, Record<string, { rtUuid?: string }>>();
	const bindByType = new Map<string, Record<string, { rtUuid?: string }>>();
	for (const e of (fallback?.effects || []) as StackEffectLike[]) {
		if (e?.definition && typeof e.definition === "object") {
			const def = e.definition;
			if (e.id) defById.set(e.id, def);
			if (e.type) defByType.set(e.type, def);
			if (def.id) defByType.set(`custom:${def.id}`, def);
		}
		if (e?.textureBindings && typeof e.textureBindings === "object") {
			if (e.id) bindById.set(e.id, e.textureBindings);
			if (e.type) bindByType.set(e.type, e.textureBindings);
		}
	}
	return {
		enabled: primary.enabled !== false,
		effects: Array.isArray(primary.effects)
			? (primary.effects as StackEffectLike[]).map((e) => {
					const fromSelf =
						e.definition && typeof e.definition === "object"
							? e.definition
							: null;
					const fromFallback =
						fromSelf ||
						(e.id ? defById.get(e.id) : undefined) ||
						(e.type ? defByType.get(e.type) : undefined) ||
						null;
					const bindSelf =
						e.textureBindings && typeof e.textureBindings === "object"
							? e.textureBindings
							: null;
					const bindFallback =
						bindSelf ||
						(e.id ? bindById.get(e.id) : undefined) ||
						(e.type ? bindByType.get(e.type) : undefined) ||
						null;
					return {
						id: e.id || "",
						type: e.type || "",
						enabled: e.enabled !== false,
						params: { ...(e.params || {}) },
						exposed: { ...(e.exposed || {}) },
						...(fromFallback ? { definition: fromFallback } : {}),
						...(bindFallback ? { textureBindings: { ...bindFallback } } : {}),
					};
				})
			: [],
	};
}

export async function buildPackScene({
	pack,
	renderer,
}: {
	pack: LoadedVfxPack;
	/** Same WebGLRenderer that will draw the pack — required for valid Default PMREM. */
	renderer?: THREE.WebGLRenderer | null;
}): Promise<BuiltPackScene | null> {
	if (!pack.scene) return null;

	// Register custom post-effects before stackHasEnabledEffects / composer build.
	const manifestCustoms = (
		pack.manifest as { customEffects?: CustomEffectDefinition[] }
	).customEffects;
	loadCustomDefinitions(manifestCustoms);

	const sceneFile = pack.scene;
	const root = new THREE.Scene();
	root.name = sceneFile.name || pack.displayName;
	const sceneNode = sceneFile.nodes?.find(
		(n) => n.kind === "scene" || n.type === "Scene",
	);
	if (sceneNode?.uuid) root.uuid = sceneNode.uuid;

	const disposables: Array<{ dispose: () => void }> = [];
	const textureCache = new Map<string, THREE.Texture>();
	const belowInputUniformNames = new Set<BelowInputUniformName>();
	const materialsByUuid = new Map<string, THREE.Material>();
	const objectsByUuid = new Map<string, THREE.Object3D>();
	let postProcess: PostProcessStackData | null = null;
	const needsBelow = packNeedsBelowInput({ type: pack.type, scope: pack.scope });

	const loadTexture = async (relPath: string): Promise<THREE.Texture | null> => {
		const url = pack.objectUrls.get(relPath);
		if (!url) return null;
		if (textureCache.has(relPath)) return textureCache.get(relPath)!;

		const texture = await new Promise<THREE.Texture>((resolve, reject) => {
			const loader = new THREE.TextureLoader();
			loader.load(
				url,
				(tex) => {
					tex.colorSpace = THREE.SRGBColorSpace;
					tex.flipY = true;
					tex.needsUpdate = true;
					resolve(tex);
				},
				undefined,
				reject,
			);
		});
		textureCache.set(relPath, texture);
		disposables.push(texture);
		return texture;
	};

	const envApply = await applySceneRenderSettings({
		root,
		sceneFile,
		loadTexture,
		disposables,
		renderer: renderer ?? null,
	});

	// Fill lights when IBL missing/pending. Removed once Default PMREM bakes on the draw renderer.
	if (!root.environment) {
		const ambient = new THREE.AmbientLight(0xffffff, 0.85);
		ambient.userData.__fccFillLight = true;
		const dir = new THREE.DirectionalLight(0xffffff, 1.1);
		dir.userData.__fccFillLight = true;
		dir.position.set(2, 4, 3);
		root.add(ambient);
		root.add(dir);
	}

	let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;

	/** Created objects awaiting hierarchy attach (uuid -> object). */
	const pendingParents = new Map<string, string | null>();

	const registerObject = (obj: THREE.Object3D, node: VfxSceneNode) => {
		obj.name = node.name || "";
		obj.visible = node.visible !== false;
		applyTransform(obj, node);
		if (node.uuid) {
			obj.uuid = node.uuid;
			objectsByUuid.set(node.uuid, obj);
			pendingParents.set(
				node.uuid,
				node.parent && typeof node.parent === "string" ? node.parent : null,
			);
		} else {
			// No uuid cannot join parent map; keep under root.
			root.add(obj);
		}
	};

	for (const node of sceneFile.nodes) {
		if (node.kind === "scene" || node.type === "Scene") {
			continue;
		}

		if (
			node.kind === "camera" ||
			node.type === "PerspectiveCamera" ||
			node.type === "OrthographicCamera"
		) {
			const cam = new THREE.PerspectiveCamera(
				node.fov ?? 50,
				node.aspect ?? 16 / 9,
				node.near ?? 0.1,
				node.far ?? 2000,
			);
			registerObject(cam, node);
			const stackFromNode = resolveCameraPostProcessStack(
				node.postProcess as PostProcessStackData | null | undefined,
				(node.userData as { postProcessStack?: PostProcessStackData } | undefined)
					?.postProcessStack,
			);
			if (
				!camera ||
				(sceneFile.activeCamera && sceneFile.activeCamera === node.uuid)
			) {
				camera = cam;
				if (stackFromNode) postProcess = stackFromNode;
			}
			continue;
		}

		if (node.kind === "ui" || (node.userData as { fccUI?: { type?: string } } | undefined)?.fccUI?.type) {
			const fccFromNode = (node.ui ||
				(node.userData as { fccUI?: FccUIData } | undefined)?.fccUI ||
				{}) as FccUIData;
			const uiType = String(fccFromNode.type || node.ui?.type || "image");
			const fccUI: FccUIData = {
				type: uiType,
				anchorMin: (fccFromNode.anchorMin || node.ui?.anchorMin || [0.5, 0.5]) as [number, number],
				anchorMax: (fccFromNode.anchorMax || node.ui?.anchorMax || [0.5, 0.5]) as [number, number],
				pivot: (fccFromNode.pivot || node.ui?.pivot || [0.5, 0.5]) as [number, number],
				anchoredPosition: (fccFromNode.anchoredPosition ||
					node.ui?.anchoredPosition ||
					[0, 0]) as [number, number],
				sizeDelta: (fccFromNode.sizeDelta || node.ui?.sizeDelta || [200, 200]) as [
					number,
					number,
				],
				localEulerAngles: (fccFromNode.localEulerAngles ||
					node.ui?.localEulerAngles ||
					[0, 0, 0]) as [number, number, number],
				localScale: (fccFromNode.localScale || node.ui?.localScale || [1, 1, 1]) as [
					number,
					number,
					number,
				],
				renderMode:
					(fccFromNode.renderMode || node.ui?.renderMode) === "camera"
						? "camera"
						: "overlay",
				cameraUuid:
					(fccFromNode.cameraUuid ?? node.ui?.cameraUuid ?? null) as string | null,
				planeDistance: Number(
					fccFromNode.planeDistance ?? node.ui?.planeDistance ?? 100,
				),
				text: String(fccFromNode.text ?? node.ui?.text ?? ""),
				font: String(fccFromNode.font ?? node.ui?.font ?? ""),
				fontBold: String(fccFromNode.fontBold ?? node.ui?.fontBold ?? ""),
				fontFileName: String(fccFromNode.fontFileName ?? node.ui?.fontFileName ?? ""),
				fontSize: Number(fccFromNode.fontSize ?? node.ui?.fontSize ?? 48),
				bold: !!(fccFromNode.bold ?? node.ui?.bold),
				italic: !!(fccFromNode.italic ?? (node.ui as { italic?: boolean } | undefined)?.italic)
					|| String(fccFromNode.fontStyle ?? (node.ui as { fontStyle?: string } | undefined)?.fontStyle ?? "") === "italic",
				fontStyle: String(
					fccFromNode.fontStyle
						?? (node.ui as { fontStyle?: string } | undefined)?.fontStyle
						?? "",
				),
				color: String(fccFromNode.color ?? node.ui?.color ?? "#ffffff"),
				letterSpacing: Number(fccFromNode.letterSpacing ?? node.ui?.letterSpacing ?? 0),
				lineHeight: Number(fccFromNode.lineHeight ?? node.ui?.lineHeight ?? 1.2),
				align: String(fccFromNode.align ?? node.ui?.align ?? "center"),
				verticalAlign: String(fccFromNode.verticalAlign ?? node.ui?.verticalAlign ?? "middle"),
				outline: (fccFromNode.outline ?? node.ui?.outline ?? {
					enabled: false,
					width: 2,
					color: "#000000",
					opacity: 1,
				}) as FccUIData["outline"],
				shadow: (fccFromNode.shadow ?? node.ui?.shadow ?? {
					enabled: false,
					offsetX: 2,
					offsetY: -2,
					blur: 4,
					color: "#000000",
					opacity: 0.75,
				}) as FccUIData["shadow"],
				flowerStyle: (fccFromNode.flowerStyle ?? node.ui?.flowerStyle ?? null) as FccUIData["flowerStyle"],
				flowerBaseFontSize: (() => {
					const raw =
						fccFromNode.flowerBaseFontSize ??
						(node.ui as { flowerBaseFontSize?: number } | undefined)?.flowerBaseFontSize;
					const n = Number(raw);
					return n > 0 ? n : undefined;
				})(),
				// fcc-tl-flower-23: keep stickers / PP so clip pose sees authored scale/offset.
				...(((fccFromNode as { textStickers?: unknown }).textStickers != null ||
					(node.ui as { textStickers?: unknown } | undefined)?.textStickers != null)
					? {
							textStickers:
								(fccFromNode as { textStickers?: unknown }).textStickers ??
								(node.ui as { textStickers?: unknown }).textStickers,
						}
					: {}),
				...(((fccFromNode as { textFxStack?: unknown }).textFxStack != null ||
					(node.ui as { textFxStack?: unknown } | undefined)?.textFxStack != null)
					? {
							textFxStack:
								(fccFromNode as { textFxStack?: unknown }).textFxStack ??
								(node.ui as { textFxStack?: unknown }).textFxStack,
						}
					: {}),
			} as FccUIData;

			if (uiType === "canvas") {
				const group = new THREE.Group();
				group.userData = { ...(node.userData || {}), fccUI };
				registerObject(group, node);
				// Layout owns transform each frame 鈥?start identity.
				group.position.set(0, 0, 0);
				group.scale.set(1, 1, 1);
				group.rotation.set(0, 0, 0);
				applyUIObjectFlags(group);
				continue;
			}



			if (uiType === "text") {
				const group = new THREE.Group();
				group.userData = { ...(node.userData || {}), fccUI };
				// Local TTF (Troika: ttf/otf/woff). Avoid CDN so Default text glyphs still load offline.
				// Noto Sans SC is shipped; YaHei used when public/fonts/msyh.ttf exists.
				const FCC_FLOWER_PREFIX = "__fccFlower_";
				const FCC_FLOWER_FACE = "__fccFlower_face";

				const resolveFont = (fontPath: string): string => {
					if (!fontPath) return getDefaultTroikaFont();
					if (
						fontPath.startsWith("http") ||
						fontPath.startsWith("blob:") ||
						fontPath.startsWith("data:")
					) {
						return fontPath;
					}
					const fromUrl = pack.objectUrls.get(fontPath);
					if (fromUrl) return fromUrl;
					const bytes = pack.files.get(fontPath);
					if (bytes) {
						const copy = bytes.slice();
						const blob = new Blob([copy], { type: "font/ttf" });
						const url = URL.createObjectURL(blob);
						pack.objectUrls.set(fontPath, url);
						return url;
					}
					return fontPath;
				};

				const resolveFlowerTextureUrl = (texPath: string): string => {
					if (!texPath) return "";
					if (
						texPath.startsWith("http") ||
						texPath.startsWith("blob:") ||
						texPath.startsWith("data:")
					) {
						return texPath;
					}
					const fromUrl = pack.objectUrls.get(texPath);
					if (fromUrl) return fromUrl;
					const bytes = pack.files.get(texPath);
					if (bytes) {
						const copy = bytes.slice();
						const blob = new Blob([copy], { type: "image/png" });
						const url = URL.createObjectURL(blob);
						pack.objectUrls.set(texPath, url);
						return url;
					}
					return texPath;
				};

				const flowerTexLoader = new THREE.TextureLoader();
				const flowerTexCache = new Map<string, THREE.Texture>();
				const resolveFlowerRtTex = (rtPath: string): THREE.Texture | null => {
	if (!rtPath.startsWith("rt:")) return null;
	const uuid = rtPath.slice(3);
	if (!uuid) return null;
	const obj = objectsByUuid.get(uuid);
	if (!obj) return null;
	const rt = (obj.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
	return rt?.texture || null;
};

const stampFlowerTexRtSlot = (
	material: THREE.Material | null | undefined,
	texPath: string,
) => {
	if (!material) return;
	material.userData = material.userData || {};
	if (texPath.startsWith("rt:")) {
		(material.userData as { fccRtSlots?: Array<{ key: string; uuid: string }> }).fccRtSlots = [
			{ key: "uFccTex", uuid: texPath.slice(3) },
		];
	} else if ((material.userData as { fccRtSlots?: unknown }).fccRtSlots) {
		delete (material.userData as { fccRtSlots?: unknown }).fccRtSlots;
	}
};

const loadFlowerTex = (
	path: string,
	cb: (tex: THREE.Texture | null) => void,
) => {
	if (!path) {
		cb(null);
		return;
	}
	if (path.startsWith("rt:")) {
		const live = resolveFlowerRtTex(path);
		// RT wrap comes from fccRenderTexture.wrapMode (ensurePackRenderTargets); do not overwrite.
		cb(live);
		return;
	}
	const url = resolveFlowerTextureUrl(path);
	if (!url) {
		cb(null);
		return;
	}
	if (flowerTexCache.has(url)) {
		cb(flowerTexCache.get(url) || null);
		return;
	}
	flowerTexLoader.load(
		url,
		(tex) => {
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.wrapS = THREE.RepeatWrapping;
			tex.wrapT = THREE.RepeatWrapping;
			tex.needsUpdate = true;
			flowerTexCache.set(url, tex);
			cb(tex);
		},
		undefined,
		() => cb(null),
	);
};


const tuneMaterial = (troika: InstanceType<typeof TroikaText>) => {
					const mats = troika.material
						? Array.isArray(troika.material)
							? troika.material
							: [troika.material]
						: [];
					// Keep Troika soft SDF AA; overlap mitigated via smaller sdfMargin.
					for (const m of mats) {
						if (!m) continue;
						m.depthTest = false;
						m.depthWrite = false;
						m.toneMapped = false;
						m.transparent = true;
						m.alphaTest = 0;
					}
				};

								const resolveTroikaFaceMaterial = (
					troika: InstanceType<typeof TroikaText>,
				) => {
					const m = troika.material as THREE.Material | THREE.Material[] | null;
					if (Array.isArray(m))
						return (m.length ? m[m.length - 1] : null) as
							| (THREE.Material & {
									isTroikaTextMaterial?: boolean;
									userData: Record<string, unknown>;
							  })
							| null;
					return (m || null) as
						| (THREE.Material & {
								isTroikaTextMaterial?: boolean;
								userData: Record<string, unknown>;
						  })
						| null;
				};

				type TroikaUd = { fccHollowFill?: boolean };
				const setTroikaFillOpacity = (
					troika: InstanceType<typeof TroikaText>,
					opacity: number,
				) => {
					if ((troika.userData as TroikaUd).fccHollowFill) {
						troika.fillOpacity = 0;
						return;
					}
					troika.fillOpacity = Number.isFinite(opacity) ? opacity : 1;
				};
				const markTroikaHollowFill = (
					troika: InstanceType<typeof TroikaText>,
					hollow: boolean,
				) => {
					(troika.userData as TroikaUd).fccHollowFill = hollow;
					if (hollow) troika.fillOpacity = 0;
				};

				/** Pad outline quads by blur; width dilate is uFccStrokeExpand. */
				const FCC_SHADOW_BLUR_BOUNDS_SCALE = 1.0;

				/** Outer stroke: inflate glyph quads + SDF (no Troika outlineWidth dual-pass). */
				const hookStrokeExpandVertex = (vertexShader: string) => {
					const re =
						/vec4\s+outlineBounds\s*=\s*vec4\(\s*bounds\.xy\s*-\s*uTroikaEdgeOffset\s*-\s*uTroikaBlurRadius\s*,\s*bounds\.zw\s*\+\s*uTroikaEdgeOffset\s*\+\s*uTroikaBlurRadius\s*\)\s*;/;
					if (re.test(vertexShader)) {
						return vertexShader.replace(
							re,
							`vec4 outlineBounds = vec4(
  bounds.xy - uTroikaEdgeOffset - uTroikaBlurRadius * ${FCC_SHADOW_BLUR_BOUNDS_SCALE.toFixed(1)} - uFccStrokeExpand,
  bounds.zw + uTroikaEdgeOffset + uTroikaBlurRadius * ${FCC_SHADOW_BLUR_BOUNDS_SCALE.toFixed(1)} + uFccStrokeExpand
);`,
						);
					}
					console.warn("[FreeFilmCut] Troika outlineBounds expand hook missed");
					return vertexShader;
				};
				const hookStrokeExpandFragment = (fragmentShader: string) => {
					const re = /troikaGetEdgeAlpha\(\s*fragDistance\s*,\s*uTroikaEdgeOffset\s*,/;
					if (re.test(fragmentShader)) {
						return fragmentShader.replace(
							re,
							"troikaGetEdgeAlpha(fragDistance, uTroikaEdgeOffset + uFccStrokeExpand,",
						);
					}
					console.warn("[FreeFilmCut] Troika edgeAlpha expand hook missed");
					return fragmentShader;
				};
				/**
				 * Opaque through width (expand), then 1→0 over diffuse (blur).
				 * Troika default centers fade on the edge and eats the solid core.
				 */
				const hookGaussianBlurEdgeAlpha = (fragmentShader: string) => {
					const re =
						/float\s+edgeAlpha\s*=\s*uTroikaSDFDebug\s*\?\s*troikaGlyphUvToSdfValue\(\s*vTroikaGlyphUV\s*\)\s*:\s*troikaGetEdgeAlpha\(\s*fragDistance\s*,\s*uTroikaEdgeOffset(?:\s*\+\s*uFccStrokeExpand)?\s*,\s*max\(\s*aaDist\s*,\s*uTroikaBlurRadius\s*\)\s*\)\s*;/;
					if (!re.test(fragmentShader)) {
						console.warn("[FreeFilmCut] Troika gaussianBlurEdge hook missed");
						return fragmentShader;
					}
					return fragmentShader.replace(
						re,
						`float edgeAlpha = uTroikaSDFDebug ? troikaGlyphUvToSdfValue(vTroikaGlyphUV) : (
  uTroikaBlurRadius > 1e-5
    ? (1.0 - smoothstep(0.0, uTroikaBlurRadius, max(0.0, fragDistance - (uTroikaEdgeOffset + uFccStrokeExpand))))
    : troikaGetEdgeAlpha(fragDistance, uTroikaEdgeOffset + uFccStrokeExpand, aaDist)
);`,
					);
				};

				const hookLayerPlaneUv = (vertexShader: string) => {
					const injectPos = `
{
  vec4 fccTotal = uTroikaTotalBounds;
  fccTotal.xy -= uFccContentExpand;
  fccTotal.zw += uFccContentExpand;
  vec2 spanTotal = max( fccTotal.zw - fccTotal.xy, vec2( 1e-5 ) );
  vec2 uvWhole = ( position.xy - fccTotal.xy ) / spanTotal;
  vec4 fccB = aTroikaGlyphBounds;
  fccB.xz += uTroikaPositionOffset.x;
  fccB.yw -= uTroikaPositionOffset.y;
  fccB.xy -= uFccContentExpand;
  fccB.zw += uFccContentExpand;
  vec2 spanChar = max( fccB.zw - fccB.xy, vec2( 1e-5 ) );
  vec2 uvChar = ( position.xy - fccB.xy ) / spanChar;
  vFccGradUv = mix( uvWhole, uvChar, uFccUvPerChar );
  vFccInstanceId = float(gl_InstanceID) + uFccCharIndex;
}
`;
					const re =
						/uv\s*=\s*\(\s*position\.xy\s*-\s*uTroikaTotalBounds\.xy\s*\)\s*\/\s*\(\s*uTroikaTotalBounds\.zw\s*-\s*uTroikaTotalBounds\.xy\s*\)\s*;/;
					if (re.test(vertexShader))
						return vertexShader.replace(re, (m) => m + injectPos);
					const reGlyph = /vTroikaGlyphUV\s*=\s*clippedXY\.xy\s*;/;
					if (reGlyph.test(vertexShader)) {
						return vertexShader.replace(
							reGlyph,
							(m) =>
								m +
								`
{
  vec4 fccB = aTroikaGlyphBounds;
  fccB.xz += uTroikaPositionOffset.x;
  fccB.yw -= uTroikaPositionOffset.y;
  vec2 fccLocal = mix( fccB.xy, fccB.zw, clippedXY );
  vec4 fccTotal = uTroikaTotalBounds;
  fccTotal.xy -= uFccContentExpand;
  fccTotal.zw += uFccContentExpand;
  vec2 spanTotal = max( fccTotal.zw - fccTotal.xy, vec2( 1e-5 ) );
  vec2 uvWhole = ( fccLocal - fccTotal.xy ) / spanTotal;
  vec4 fccChar = fccB;
  fccChar.xy -= uFccContentExpand;
  fccChar.zw += uFccContentExpand;
  vec2 spanChar = max( fccChar.zw - fccChar.xy, vec2( 1e-5 ) );
  vec2 uvChar = ( fccLocal - fccChar.xy ) / spanChar;
  vFccGradUv = mix( uvWhole, uvChar, uFccUvPerChar );
  vFccInstanceId = float(gl_InstanceID) + uFccCharIndex;
}
`,
						);
					}
					return vertexShader;
				};


				const hookFillRGBA = (fragmentShader: string, contentGLSL: string) => {
					const re =
						/vec4\s+fillRGBA\s*=\s*gl_FragColor\s*;\s*fillRGBA\.a\s*\*=\s*uTroikaFillOpacity\s*;/;
					if (!re.test(fragmentShader)) return fragmentShader;
					let out = fragmentShader.replace(
						re,
						"vec4 fillRGBA = gl_FragColor;\nfillRGBA.a *= uTroikaFillOpacity;\n" +
							contentGLSL,
					);
					const reWipe =
						/if\s*\(\s*fillRGBA\.a\s*==\s*0\.0\s*\)\s*fillRGBA\.rgb\s*=\s*strokeRGBA\.rgb\s*;/;
					if (reWipe.test(out)) {
						out = out.replace(
							reWipe,
							"if (fillRGBA.a == 0.0) strokeRGBA.rgb = fillRGBA.rgb;",
						);
					}
					return out;
				};

				const createPlaneContentMaterial = (
					baseMat: THREE.Material,
					opts: {
						uniforms: Record<string, { value: unknown }>;
						fragmentDefs?: string;
						contentGLSL?: string;
						fragmentColorTransform?: string;
					},
				) => {
					const uniforms = Object.assign(
						{
							uFccContentExpand: { value: 0 },
							uFccStrokeExpand: { value: 0 },
							uFccUvPerChar: { value: 1 },
							uFccCharIndex: { value: 0 },
						},
						opts.uniforms || {},
					);
					// fragmentDefs inject before void main(), AFTER Troika's wrapped
					// troikaOrigMain. Rewriter hooks uFcc* into that earlier body =
					// use-before-declare (breaks per-glyph flower stacks on char-anim).
					// Prepend at file top; leave fragmentDefs empty so createDerivedMaterial
					// does not redefine them. (editor UIText createFccPlaneContentMaterial)
					const fragDefs =
						`
varying vec2 vFccGradUv;
varying float vFccInstanceId;
uniform float uFccContentExpand;
uniform float uFccStrokeExpand;
uniform float uFccUvPerChar;
` + (opts.fragmentDefs || "");
					return createDerivedMaterial(baseMat, {
						chained: true,
						uniforms,
						fragmentDefs: "",
						fragmentColorTransform: opts.fragmentColorTransform || "",
						customRewriter({
							vertexShader,
							fragmentShader,
						}: {
							vertexShader: string;
							fragmentShader: string;
						}) {
							if (vertexShader.indexOf("varying vec2 vFccGradUv") < 0) {
								vertexShader = "varying vec2 vFccGradUv;\n" + vertexShader;
							}
							if (vertexShader.indexOf("uniform float uFccContentExpand") < 0) {
								vertexShader =
									"uniform float uFccContentExpand;\n" + vertexShader;
							}
							if (vertexShader.indexOf("uniform float uFccStrokeExpand") < 0) {
								vertexShader =
									"uniform float uFccStrokeExpand;\n" + vertexShader;
							}
							if (vertexShader.indexOf("uniform float uFccUvPerChar") < 0) {
								vertexShader =
									"uniform float uFccUvPerChar;\n" + vertexShader;
							}
							if (vertexShader.indexOf("varying float vFccInstanceId") < 0) {
								vertexShader =
									"varying float vFccInstanceId;\n" + vertexShader;
							}
							if (vertexShader.indexOf("uniform float uFccCharIndex") < 0) {
								vertexShader =
									"uniform float uFccCharIndex;\n" + vertexShader;
							}
							if (fragmentShader.indexOf("uniform float uFccStrokeExpand") < 0) {
								fragmentShader = fragDefs + fragmentShader;
							}
							vertexShader = hookStrokeExpandVertex(vertexShader);
							vertexShader = hookLayerPlaneUv(vertexShader);
							fragmentShader = hookStrokeExpandFragment(fragmentShader);
							fragmentShader = hookGaussianBlurEdgeAlpha(fragmentShader);
							if (opts.contentGLSL) {
								fragmentShader = hookFillRGBA(fragmentShader, opts.contentGLSL);
							}
							return { vertexShader, fragmentShader };
						},
					});
				};

				const applySolidExpandMaterial = (
					troika: InstanceType<typeof TroikaText>,
					colorHex: string,
					opacity: number,
					expand: number,
				) => {
					const expandVal = Math.max(0, Number(expand) || 0);
					troika.color = colorHex || "#ffffff";
					setTroikaFillOpacity(troika, opacity > 0 ? opacity : 1);
					let baseMat = resolveTroikaFaceMaterial(troika);
					if (!baseMat || !baseMat.isTroikaTextMaterial) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
					}
					if (!baseMat || !baseMat.isTroikaTextMaterial) {
						tuneMaterial(troika);
						return;
					}
					if (
						baseMat.userData?.fccGradientMat ||
						baseMat.userData?.fccTextureMat
					) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
						if (!baseMat || !baseMat.isTroikaTextMaterial) {
							tuneMaterial(troika);
							return;
						}
					}
					const prevU = baseMat.userData?.fccSolidExpandUniforms as
						| {
								uFccContentExpand?: { value: number };
								uFccStrokeExpand?: { value: number };
						  }
						| undefined;
					if (
						baseMat.userData?.fccSolidExpandMat &&
						prevU?.uFccStrokeExpand &&
						prevU?.uFccContentExpand
					) {
						prevU.uFccStrokeExpand.value = expandVal;
						prevU.uFccContentExpand.value = expandVal;
						setTroikaFillOpacity(troika, opacity > 0 ? opacity : 1);
						tuneMaterial(troika);
						return;
					}
					const uniforms = {
						uFccContentExpand: { value: expandVal },
						uFccStrokeExpand: { value: expandVal },
					};
					try {
						const derived = createPlaneContentMaterial(baseMat, { uniforms });
						derived.userData = derived.userData || {};
						derived.userData.fccSolidExpandMat = true;
						derived.userData.fccSolidExpandUniforms = uniforms;
						derived.transparent = true;
						derived.depthWrite = false;
						derived.toneMapped = false;
						derived.depthTest = false;
						Object.defineProperty(derived, "isTroikaTextMaterial", {
							value: true,
						});
						if ((derived as { _outlineMtl?: unknown })._outlineMtl) {
							delete (derived as { _outlineMtl?: unknown })._outlineMtl;
						}
						troika.material = derived;
						tuneMaterial(troika);
					} catch (e) {
						console.warn("[FreeFilmCut] OpenCut solid expand material failed", e);
						troika.color = colorHex || "#ffffff";
						tuneMaterial(troika);
					}
				};

				const applyGradientMaterial = (
					troika: InstanceType<typeof TroikaText>,
					content: ReturnType<typeof normalizeFillContent>,
					opacity: number,
					contentExpand = 0,
				) => {
					const g = content.gradient;
					const rgbA = hexToRgb01(g.colors[0]);
					const rgbB = hexToRgb01(g.colors[1]);
					const angle = Number(g.angle);
					const stop0 = Number(g.stops[0]);
					const stop1 = Number(g.stops[1]);
					const angleVal = Number.isFinite(angle) ? angle : 90;
					const stop0Val = Number.isFinite(stop0) ? stop0 : 0;
					const stop1Val = Number.isFinite(stop1) ? stop1 : 1;
					const expandVal = Math.max(0, Number(contentExpand) || 0);
					const perCharVal = uvModeToPerCharUniform(content.uvMode);
					// White diffuse so a failed/disabled gradient frame is not stuck on color0 black.
					troika.color = "#ffffff";
					setTroikaFillOpacity(troika, opacity);

					let baseMat = resolveTroikaFaceMaterial(troika);
					if (!baseMat || !baseMat.isTroikaTextMaterial) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
					}
					if (!baseMat || !baseMat.isTroikaTextMaterial) {
						tuneMaterial(troika);
						return;
					}

					// Drop pre-fix wraps that sampled undeclared vUv.
					if (baseMat.userData?.fccGradientMat && !baseMat.userData?.fccGradUv) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
						if (!baseMat || !baseMat.isTroikaTextMaterial) {
							tuneMaterial(troika);
							return;
						}
					}

					if (
						baseMat.userData?.fccSolidExpandMat ||
						baseMat.userData?.fccTextureMat
					) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
						if (!baseMat || !baseMat.isTroikaTextMaterial) {
							tuneMaterial(troika);
							return;
						}
					}
					const prevU = baseMat.userData?.fccGradientUniforms as
						| {
								uFccGA: { value: THREE.Color };
								uFccGB: { value: THREE.Color };
								uFccGAngle: { value: number };
								uFccGStop0: { value: number };
								uFccGStop1: { value: number };
								uFccGUse: { value: number };
								uFccContentExpand?: { value: number };
								uFccStrokeExpand?: { value: number };
								uFccUvPerChar?: { value: number };
						  }
						| undefined;
					if (
						baseMat.userData?.fccGradientMat &&
						baseMat.userData?.fccGradUv &&
						prevU &&
						prevU.uFccUvPerChar &&
						((prevU.uFccContentExpand && prevU.uFccStrokeExpand) ||
							expandVal <= 0)
					) {
						prevU.uFccGA.value.setRGB(rgbA[0], rgbA[1], rgbA[2]);
						prevU.uFccGB.value.setRGB(rgbB[0], rgbB[1], rgbB[2]);
						prevU.uFccGAngle.value = angleVal;
						prevU.uFccGStop0.value = stop0Val;
						prevU.uFccGStop1.value = stop1Val;
						prevU.uFccGUse.value = 1;
						if (prevU.uFccContentExpand) prevU.uFccContentExpand.value = expandVal;
						if (prevU.uFccStrokeExpand) prevU.uFccStrokeExpand.value = expandVal;
						prevU.uFccUvPerChar.value = perCharVal;
						setTroikaFillOpacity(troika, opacity);
						tuneMaterial(troika);
						return;
					}
					if (baseMat.userData?.fccGradientMat) {
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
						baseMat = resolveTroikaFaceMaterial(troika);
						if (!baseMat || !baseMat.isTroikaTextMaterial) {
							tuneMaterial(troika);
							return;
						}
					}
					const uniforms = {
						uFccGA: { value: new THREE.Color().setRGB(rgbA[0], rgbA[1], rgbA[2]) },
						uFccGB: { value: new THREE.Color().setRGB(rgbB[0], rgbB[1], rgbB[2]) },
						uFccGAngle: { value: angleVal },
						uFccGStop0: { value: stop0Val },
						uFccGStop1: { value: stop1Val },
						uFccGUse: { value: 1 },
						uFccContentExpand: { value: expandVal },
						uFccStrokeExpand: { value: expandVal },
						uFccUvPerChar: { value: perCharVal },
					};
					try {
						const derived = createPlaneContentMaterial(baseMat, {
							uniforms,
							fragmentDefs: `
uniform vec3 uFccGA;
uniform vec3 uFccGB;
uniform float uFccGAngle;
uniform float uFccGStop0;
uniform float uFccGStop1;
uniform float uFccGUse;
`,
							contentGLSL: `
#if !defined(IS_DEPTH_MATERIAL) && !defined(IS_DISTANCE_MATERIAL)
if (uFccGUse > 0.5) {
  float rad = radians(uFccGAngle);
  vec2 dir = vec2(cos(rad), sin(rad));
  float t = dot(vFccGradUv - vec2(0.5), dir) + 0.5;
  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);
  t = clamp(t, 0.0, 1.0);
  fillRGBA.rgb = mix(uFccGA, uFccGB, t);
}
#endif
`,
							fragmentColorTransform: `
if (uFccGUse > 0.5) {
  float rad = radians(uFccGAngle);
  vec2 dir = vec2(cos(rad), sin(rad));
  float t = dot(vFccGradUv - vec2(0.5), dir) + 0.5;
  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);
  t = clamp(t, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFccGA, uFccGB, t);
}
`,
						});
						derived.userData = derived.userData || {};
						derived.userData.fccGradientMat = true;
						derived.userData.fccGradUv = true;
						derived.userData.fccGradientUniforms = uniforms;
						derived.transparent = true;
						derived.depthWrite = false;
						derived.toneMapped = false;
						derived.depthTest = false;
						Object.defineProperty(derived, "isTroikaTextMaterial", {
							value: true,
						});
						if ((derived as { _outlineMtl?: unknown })._outlineMtl) {
							delete (derived as { _outlineMtl?: unknown })._outlineMtl;
						}
						troika.material = derived;
						setTroikaFillOpacity(troika, opacity);
						tuneMaterial(troika);
					} catch (e) {
						console.warn("[FreeFilmCut] OpenCut gradient material failed", e);
						tuneMaterial(troika);
					}
				};

				
				const resolveFccCharIndex = (troika: THREE.Object3D) => {
					let o: THREE.Object3D | null = troika;
					while (o) {
						const n = o.name != null ? String(o.name) : "";
						if (n.indexOf("__fccChar_") === 0) {
							const ci = parseInt(n.slice(10), 10);
							if (Number.isFinite(ci) && ci >= 0) return ci;
						}
						o = o.parent;
					}
					return 0;
				};

const applyTextureMaterial = (
					troika: InstanceType<typeof TroikaText>,
					c: ReturnType<typeof normalizeFillContent>,
					opacity: number,
					contentExpand = 0,
				) => {
					const texInfo = c.texture || { path: "", alpha: 1 };
					const path = String(texInfo.path || "");
					const angleVal = Number.isFinite(Number(texInfo.angle))
						? Number(texInfo.angle)
						: 0;
					const scaleVal =
						Number.isFinite(Number(texInfo.scale)) && Number(texInfo.scale) > 0
							? Number(texInfo.scale)
							: 1;
					const texA =
						texInfo.alpha != null && Number.isFinite(Number(texInfo.alpha))
							? Number(texInfo.alpha)
							: 1;
					const op = Math.max(0, Math.min(1, opacity * texA));
					const expandVal = Math.max(0, Number(contentExpand) || 0);
					const perCharVal = uvModeToPerCharUniform(c.uvMode);
					const rangeVal = Math.max(1, Math.floor(Number((texInfo as { range?: number }).range)) || 1);
					const charIndexVal = resolveFccCharIndex(troika);
					troika.color = "#ffffff";
					setTroikaFillOpacity(troika, op > 0 ? op : 1);

					const applyWithMap = (map: THREE.Texture | null) => {
						setTroikaFillOpacity(troika, op > 0 ? op : 1);
						let baseMat = resolveTroikaFaceMaterial(troika);
						if (!baseMat || !baseMat.isTroikaTextMaterial) {
							troika.material = new THREE.MeshBasicMaterial({
								color: 0xffffff,
								transparent: true,
								depthWrite: false,
								toneMapped: false,
								side: THREE.DoubleSide,
							});
							baseMat = resolveTroikaFaceMaterial(troika);
						}
						if (!baseMat || !baseMat.isTroikaTextMaterial) {
							tuneMaterial(troika);
							return;
						}
						if (
							baseMat.userData?.fccGradientMat ||
							baseMat.userData?.fccSolidExpandMat ||
							(baseMat.userData?.fccTextureMat && !map)
						) {
							troika.material = new THREE.MeshBasicMaterial({
								color: 0xffffff,
								transparent: true,
								depthWrite: false,
								toneMapped: false,
								side: THREE.DoubleSide,
							});
							baseMat = resolveTroikaFaceMaterial(troika);
							if (!baseMat || !baseMat.isTroikaTextMaterial) {
								tuneMaterial(troika);
								return;
							}
						}
						const ud = baseMat.userData as {
							fccTextureMat?: boolean;
							fccTextureUniforms?: {
								uFccTex: { value: THREE.Texture | null };
								uFccTexUse: { value: number };
								uFccTexAngle: { value: number };
								uFccTexScale: { value: number };
								uFccTexRange?: { value: number };
								uFccCharIndex?: { value: number };
								uFccContentExpand?: { value: number };
								uFccStrokeExpand?: { value: number };
								uFccUvPerChar?: { value: number };
							};
						};
						if (
							ud.fccTextureMat &&
							ud.fccTextureUniforms &&
							ud.fccTextureUniforms.uFccUvPerChar &&
							ud.fccTextureUniforms.uFccTexRange &&
							ud.fccTextureUniforms.uFccCharIndex &&
							((ud.fccTextureUniforms.uFccContentExpand &&
								ud.fccTextureUniforms.uFccStrokeExpand) ||
								expandVal <= 0)
						) {
							if (map) ud.fccTextureUniforms.uFccTex.value = map;
							ud.fccTextureUniforms.uFccTexUse.value = map ? 1 : 0;
							ud.fccTextureUniforms.uFccTexAngle.value = angleVal;
							ud.fccTextureUniforms.uFccTexScale.value = scaleVal;
							if (ud.fccTextureUniforms.uFccTexRange) {
								ud.fccTextureUniforms.uFccTexRange.value = rangeVal;
							}
							if (ud.fccTextureUniforms.uFccCharIndex) {
								ud.fccTextureUniforms.uFccCharIndex.value = charIndexVal;
							}
							if (ud.fccTextureUniforms.uFccContentExpand) {
								ud.fccTextureUniforms.uFccContentExpand.value = expandVal;
							}
							if (ud.fccTextureUniforms.uFccStrokeExpand) {
								ud.fccTextureUniforms.uFccStrokeExpand.value = expandVal;
							}
							ud.fccTextureUniforms.uFccUvPerChar.value = perCharVal;
							setTroikaFillOpacity(troika, op > 0 ? op : 1);
							tuneMaterial(troika);
							return;
						}
						if (ud.fccTextureMat) {
							troika.material = new THREE.MeshBasicMaterial({
								color: 0xffffff,
								transparent: true,
								depthWrite: false,
								toneMapped: false,
								side: THREE.DoubleSide,
							});
							baseMat = resolveTroikaFaceMaterial(troika);
							if (!baseMat || !baseMat.isTroikaTextMaterial) {
								tuneMaterial(troika);
								return;
							}
						}
						if (!map) {
							troika.color = contentPrimaryColor(c);
							tuneMaterial(troika);
							return;
						}
						const uniforms = {
							uFccTex: { value: map },
							uFccTexUse: { value: 1 },
							uFccTexAngle: { value: angleVal },
							uFccTexScale: { value: scaleVal },
							uFccTexRange: { value: rangeVal },
							uFccCharIndex: { value: charIndexVal },
							uFccContentExpand: { value: expandVal },
							uFccStrokeExpand: { value: expandVal },
							uFccUvPerChar: { value: perCharVal },
						};
						try {
							const derived = createPlaneContentMaterial(baseMat, {
								uniforms,
								fragmentDefs: `
uniform sampler2D uFccTex;
uniform float uFccTexUse;
uniform float uFccTexAngle;
uniform float uFccTexScale;
uniform float uFccTexRange;
uniform float uFccCharIndex;
`,
								contentGLSL: `
#if !defined(IS_DEPTH_MATERIAL) && !defined(IS_DISTANCE_MATERIAL)
if (uFccTexUse > 0.5) {
  float rad = radians(uFccTexAngle);
  vec2 uv = vFccGradUv - vec2(0.5);
  float cs = cos(rad); float sn = sin(rad);
  uv = mat2(cs, -sn, sn, cs) * uv;
  uv = uv / max(uFccTexScale, 1e-5) + vec2(0.5);
  float n = max(uFccTexRange, 1.0);
  if (n > 1.5) {
    // Integer-style mod: GPU mod(k*n, n) can return n (not 0); with ClampToEdge RT
    // that sticks the next glyph on the last strip. File textures used RepeatWrapping
    // so the same bad UV wrapped back to strip 0 and hid the bug.
    float slot = vFccInstanceId - n * floor(vFccInstanceId / n + 1e-6);
    if (slot >= n - 1e-4) slot = 0.0;
    slot = floor(slot + 1e-4);
    float uLocal = clamp(uv.x, 0.0, 1.0);
    float eps = 5e-4;
    uv.x = (slot + mix(eps, 1.0 - eps, uLocal)) / n;
  }
  vec4 tc = texture2D(uFccTex, uv);
  fillRGBA.rgb = tc.rgb;
  fillRGBA.a *= tc.a;
}
#endif
`,
								fragmentColorTransform: `
if (uFccTexUse > 0.5) {
  float rad = radians(uFccTexAngle);
  vec2 uv = vFccGradUv - vec2(0.5);
  float cs = cos(rad); float sn = sin(rad);
  uv = mat2(cs, -sn, sn, cs) * uv;
  uv = uv / max(uFccTexScale, 1e-5) + vec2(0.5);
  float n = max(uFccTexRange, 1.0);
  if (n > 1.5) {
    // Integer-style mod: GPU mod(k*n, n) can return n (not 0); with ClampToEdge RT
    // that sticks the next glyph on the last strip. File textures used RepeatWrapping
    // so the same bad UV wrapped back to strip 0 and hid the bug.
    float slot = vFccInstanceId - n * floor(vFccInstanceId / n + 1e-6);
    if (slot >= n - 1e-4) slot = 0.0;
    slot = floor(slot + 1e-4);
    float uLocal = clamp(uv.x, 0.0, 1.0);
    float eps = 5e-4;
    uv.x = (slot + mix(eps, 1.0 - eps, uLocal)) / n;
  }
  vec4 tc = texture2D(uFccTex, uv);
  gl_FragColor.rgb = tc.rgb;
  gl_FragColor.a *= tc.a;
}
`,
							});
							derived.userData = derived.userData || {};
							derived.userData.fccTextureMat = true;
							derived.userData.fccTextureUniforms = uniforms;
							derived.transparent = true;
							derived.depthWrite = false;
							derived.toneMapped = false;
							derived.depthTest = false;
							Object.defineProperty(derived, "isTroikaTextMaterial", {
								value: true,
							});
							if ((derived as { _outlineMtl?: unknown })._outlineMtl) {
								delete (derived as { _outlineMtl?: unknown })._outlineMtl;
							}
							troika.material = derived;
							setTroikaFillOpacity(troika, op > 0 ? op : 1);
							tuneMaterial(troika);
						} catch (e) {
							console.warn("[FreeFilmCut] OpenCut texture material failed", e);
							troika.color = contentPrimaryColor(c);
							tuneMaterial(troika);
						}
					};

					const finishTex = (map: THREE.Texture | null) => {
						if (!map && path.startsWith("rt:")) {
							const ph = new THREE.DataTexture(
								new Uint8Array([255, 255, 255, 255]),
								1,
								1,
							);
							ph.needsUpdate = true;
							ph.colorSpace = THREE.SRGBColorSpace;
							applyWithMap(ph);
							const face = resolveTroikaFaceMaterial(troika);
							stampFlowerTexRtSlot(face, path);
							const ud = face?.userData as
								| { fccTextureUniforms?: { uFccTexUse: { value: number } } }
								| undefined;
							if (ud?.fccTextureUniforms) ud.fccTextureUniforms.uFccTexUse.value = 0;
							return;
						}
						applyWithMap(map);
						stampFlowerTexRtSlot(resolveTroikaFaceMaterial(troika), path);
					};

					if (!path) {
						applyWithMap(null);
						return;
					}
					loadFlowerTex(path, (map) => finishTex(map));
				};

				const applyContent = (
					troika: InstanceType<typeof TroikaText>,
					contentRaw: unknown,
					layerAlpha: number,
					contentExpand = 0,
				) => {
					const c = normalizeFillContent(contentRaw);
					const solidA = c.solid.alpha != null ? Number(c.solid.alpha) : 1;
					const opacity = Math.max(
						0,
						Math.min(1, (Number(layerAlpha) || 1) * solidA),
					);
					const expand = Math.max(0, Number(contentExpand) || 0);
					if (c.renderType === "gradient") {
						applyGradientMaterial(troika, c, opacity, expand);
						return;
					}
					if (c.renderType === "texture") {
						applyTextureMaterial(troika, c, opacity, expand);
						return;
					}
					markTroikaHollowFill(troika, false);
					if (expand > 0) {
						applySolidExpandMaterial(
							troika,
							contentPrimaryColor(c),
							opacity,
							expand,
						);
						return;
					}
					{
						const face = resolveTroikaFaceMaterial(troika);
						if (
							face?.userData?.fccGradientMat ||
							face?.userData?.fccTextureMat ||
							face?.userData?.fccSolidExpandMat
						) {
							troika.material = new THREE.MeshBasicMaterial({
								color: 0xffffff,
								transparent: true,
								depthWrite: false,
								toneMapped: false,
								side: THREE.DoubleSide,
							});
						}
					}
					troika.color = contentPrimaryColor(c);
					setTroikaFillOpacity(troika, opacity);
					tuneMaterial(troika);
				};

				// Must take `ui` (not closed-over parent fccUI): char-split calls
				// syncText(rect, { group: charGroup, ui: charUI }) with one glyph.
				// Using parent fccUI.text painted the full string on every char clone
				// -> two animated full copies at caret offsets (stacked double text).
				const baseLayout = (
					troika: InstanceType<typeof TroikaText>,
					ui: typeof fccUI,
					rectW: number,
				) => {
					const fontSize = Number(ui.fontSize) > 0 ? Number(ui.fontSize) : 48;
					const align = String(ui.align || "center");
					const vAlign = String(ui.verticalAlign || "middle");
					// Fake bold uses SDF expand (uFccStrokeExpand), not a bold font file.
					const fontUrl = resolveFont(String(ui.font || ""));
					troika.font = fontUrl;
					troika.fontSize = fontSize;
					troika.sdfGlyphSize = Math.max(
						Number(troika.sdfGlyphSize) || 0,
						FCC_TROIKA_SDF_GLYPH_SIZE,
					);
					troika.anchorX =
						align === "left" ? "left" : align === "right" ? "right" : "center";
					troika.anchorY =
						vAlign === "top" ? "top" : vAlign === "bottom" ? "bottom" : "middle";
					troika.textAlign =
						align === "left" || align === "right" || align === "justify"
							? align
							: "center";
					troika.letterSpacing = Number(ui.letterSpacing) || 0;
					troika.lineHeight =
						Number(ui.lineHeight) > 0 ? Number(ui.lineHeight) : 1.2;
					troika.maxWidth = rectW > 0 ? rectW : Number(ui.sizeDelta?.[0]) || 400;
					troika.overflowWrap = "break-word";
					troika.frustumCulled = false;
					troika.text = String(ui.text ?? "");
					troika.outlineWidth = 0;
					troika.outlineOpacity = 0;
					troika.outlineBlur = 0;
					troika.outlineOffsetX = 0;
					troika.outlineOffsetY = 0;
					troika.strokeWidth = 0;
					troika.strokeOpacity = 0;
					troika.position.set(0, 0, 0);
				};

				type Pass = {
					kind: "shadow" | "stroke" | "face" | "inner";
					name: string;
					shadowParent?: { offsetX: number; offsetY: number };
					layer: {
						alpha?: number;
						width?: number;
						side?: string;
						offsetX?: number;
						offsetY?: number;
						diffuse?: number;
						content?: unknown;
						visible?: boolean;
					};
				};

				
				const pushShadowPasses = (
					passes: Pass[],
					sh: FlowerStyle["shadows"][number],
					nameBase: string,
				) => {
					const nested = Array.isArray(sh.strokes) ? sh.strokes : [];
					const enabled = nested.filter((st) => st && st.enable !== false);
					const parent = {
						offsetX: Number(sh.offsetX) || 0,
						offsetY: Number(sh.offsetY) || 0,
					};
					for (let i = enabled.length - 1; i >= 0; i--) {
						const st = enabled[i]!;
						passes.push({
							kind: "stroke",
							name: nameBase + "_nst_" + i,
							layer: st,
							shadowParent: parent,
						});
					}
					passes.push({ kind: "shadow", name: nameBase, layer: sh });
				};

				const buildPasses = (style: FlowerStyle): Pass[] => {
					const passes: Pass[] = [];
					const stack =
						style.stack && style.stack.length > 0 ? style.stack : null;
					if (!stack) {
						const shadows = (style.shadows || []).filter((s) => s && s.enable);
						const strokes = (style.strokes || []).filter((s) => s && s.enable);
						const outerStrokes = strokes.filter((s) => s.side !== "inner");
						const innerStrokes = strokes.filter((s) => s.side === "inner");
						const inners = (style.innerShadows || []).filter(
							(s) => s && s.enable,
						);
						shadows.forEach((s, i) =>
							pushShadowPasses(
								passes,
								s,
								FCC_FLOWER_PREFIX + "shadow_" + i,
							),
						);
						outerStrokes.forEach((s, i) =>
							passes.push({
								kind: "stroke",
								name: FCC_FLOWER_PREFIX + "stroke_o_" + i,
								layer: s,
							}),
						);
						passes.push({
							kind: "face",
							name: FCC_FLOWER_FACE,
							layer: style.fill,
						});
						innerStrokes.forEach((s, i) =>
							passes.push({
								kind: "stroke",
								name: FCC_FLOWER_PREFIX + "stroke_i_" + i,
								layer: s,
							}),
						);
						inners.forEach((s, i) =>
							passes.push({
								kind: "inner",
								name: FCC_FLOWER_PREFIX + "inner_" + i,
								layer: s,
							}),
						);
						return passes;
					}
					// Canonical: style.stack order is back → front.
					stack.forEach((e, i) => {
						if (!e || !e.kind) return;
						if (e.kind === "face") {
							passes.push({
								kind: "face",
								name: FCC_FLOWER_FACE,
								layer: style.fill,
							});
							return;
						}
						if ("enable" in e && e.enable === false) return;
						const id =
							typeof e.id === "string" && e.id ? e.id : "i" + i;
						if (e.kind === "stroke") {
							passes.push({
								kind: "stroke",
								name: FCC_FLOWER_PREFIX + "fx_" + id,
								layer: e,
							});
						} else if (e.kind === "shadow") {
							pushShadowPasses(
								passes,
								e,
								FCC_FLOWER_PREFIX + "fx_" + id,
							);
						} else if (e.kind === "inner") {
							passes.push({
								kind: "inner",
								name: FCC_FLOWER_PREFIX + "fx_" + id,
								layer: e,
							});
						}
					});
					return passes;
				};



				const FCC_STENCIL_REF = 1;

				const eachTroikaMaterial = (
					troika: InstanceType<typeof TroikaText> | THREE.Object3D | null | undefined,
					fn: (m: THREE.Material) => void,
				) => {
					if (!troika || !("material" in troika)) return;
					const mat = (troika as InstanceType<typeof TroikaText>).material;
					const mats = mat ? (Array.isArray(mat) ? mat : [mat]) : [];
					for (const m of mats) {
						if (m) fn(m);
					}
				};

				const applyStencilWriteToMaterial = (m: THREE.Material) => {
					m.stencilWrite = true;
					m.stencilWriteMask = 0xff;
					m.stencilRef = FCC_STENCIL_REF;
					m.stencilFunc = THREE.AlwaysStencilFunc;
					m.stencilFuncMask = 0xff;
					m.stencilFail = THREE.KeepStencilOp;
					m.stencilZFail = THREE.KeepStencilOp;
					m.stencilZPass = THREE.ReplaceStencilOp;
				};

				const applyStencilTestToMaterial = (m: THREE.Material) => {
					m.stencilWrite = false;
					m.stencilWriteMask = 0x00;
					m.stencilRef = FCC_STENCIL_REF;
					m.stencilFunc = THREE.EqualStencilFunc;
					m.stencilFuncMask = 0xff;
					m.stencilFail = THREE.KeepStencilOp;
					m.stencilZFail = THREE.KeepStencilOp;
					m.stencilZPass = THREE.KeepStencilOp;
				};

				/**
				 * CRITICAL (Editor fcc-ui-71): chain Text.prototype.onBeforeRender.
				 * Replacing onBeforeRender outright breaks Troika multi-pass / material
				 * sync and makes inner shadow draw empty or vanish.
				 */
				const chainTroikaBeforeRender = (
					troika: InstanceType<typeof TroikaText>,
					extraFn: (
						t: InstanceType<typeof TroikaText>,
						renderer: THREE.WebGLRenderer,
						material: THREE.Material,
					) => void,
				) => {
					const ud = troika.userData as {
						fccExtraBeforeRender?: typeof extraFn | null;
						fccChainedBeforeRender?: boolean;
					};
					ud.fccExtraBeforeRender = extraFn;
					if (ud.fccChainedBeforeRender) return;
					ud.fccChainedBeforeRender = true;
					troika.onBeforeRender = function fccChainedBeforeRender(
						this: InstanceType<typeof TroikaText>,
						renderer,
						scene,
						camera,
						geometry,
						material,
						groupArg,
					) {
						TroikaText.prototype.onBeforeRender.call(
							this,
							renderer,
							scene,
							camera,
							geometry,
							material,
							groupArg,
						);
						const extra = (
							this.userData as {
								fccExtraBeforeRender?: typeof extraFn | null;
							}
						).fccExtraBeforeRender;
						if (typeof extra === "function") {
							try {
								extra(this, renderer, material as THREE.Material);
							} catch (e) {
								console.warn(
									"[FreeFilmCut][FlowerStroke] troika beforeRender hook",
									e,
								);
							}
						}
					};
				};

				const ensureFaceStencilWrite = (faceMesh: THREE.Object3D) => {
					eachTroikaMaterial(
						faceMesh as InstanceType<typeof TroikaText>,
						applyStencilWriteToMaterial,
					);
					chainTroikaBeforeRender(
						faceMesh as InstanceType<typeof TroikaText>,
						(_t, _renderer, material) => {
							applyStencilWriteToMaterial(material);
						},
					);
				};

				const clearStencilState = (
					troika: InstanceType<typeof TroikaText>,
				) => {
					eachTroikaMaterial(troika, (m) => {
						m.stencilWrite = false;
						m.stencilFunc = THREE.AlwaysStencilFunc;
						m.stencilFail = THREE.KeepStencilOp;
						m.stencilZFail = THREE.KeepStencilOp;
						m.stencilZPass = THREE.KeepStencilOp;
					});
					if (troika.userData) {
						(
							troika.userData as {
								fccExtraBeforeRender?: unknown;
							}
						).fccExtraBeforeRender = null;
					}
				};

				/** Clip inner-shadow to Face via stencil (Editor Path1). */
				const applyInnerShadowFaceMask = (
					troika: InstanceType<typeof TroikaText>,
				) => {
					troika.userData = {
						...(troika.userData || {}),
						fccHadInnerMask: true,
						fccInnerStencil: true,
					};
					let baseMat = troika.material as
						| THREE.Material
						| THREE.Material[]
						| null;
					if (Array.isArray(baseMat)) {
						baseMat = baseMat.length ? baseMat[baseMat.length - 1] : null;
					}
					const faceMat = baseMat as
						| (THREE.Material & { userData: Record<string, unknown> })
						| null;
					if (faceMat?.userData?.fccFaceMaskRT) {
						delete faceMat.userData.fccFaceMaskRT;
						delete faceMat.userData.fccFaceMaskUniforms;
						troika.material = new THREE.MeshBasicMaterial({
							color: 0xffffff,
							transparent: true,
							depthWrite: false,
							toneMapped: false,
							side: THREE.DoubleSide,
						});
					}
					const faceMesh = group.getObjectByName(FCC_FLOWER_FACE);
					if (faceMesh) ensureFaceStencilWrite(faceMesh);
					eachTroikaMaterial(troika, applyStencilTestToMaterial);
					chainTroikaBeforeRender(troika, (_t, _renderer, material) => {
						applyStencilTestToMaterial(material);
						const face = group.getObjectByName(FCC_FLOWER_FACE);
						if (face) ensureFaceStencilWrite(face);
					});
					tuneMaterial(troika);
					eachTroikaMaterial(troika, applyStencilTestToMaterial);
				};

				const applyPass = (
					troika: InstanceType<typeof TroikaText>,
					pass: Pass,
					rectW: number,
					z: number,
					ui: typeof fccUI,
				) => {
					baseLayout(troika, ui, rectW);
					troika.position.set(0, 0, z);
					if (pass.kind === "shadow") {
						const w =
							Math.max(0, Number(pass.layer.width) || 0) + boldExpandForUi(ui);
						const shAlpha =
							pass.layer.alpha != null ? Number(pass.layer.alpha) : 1;
						const shContent = normalizeFillContent(pass.layer.content);
						const shDerived =
							shContent.renderType === "gradient" ||
							shContent.renderType === "texture";
						const blur = Math.max(0, Number(pass.layer.diffuse) || 0);
						troika.position.set(
							Number(pass.layer.offsetX) || 0,
							Number(pass.layer.offsetY) || 0,
							z,
						);
						troika.outlineBlur = blur;
						// Soft silhouette: width on outline dilate; fill hollow so no hard seam.
						troika.outlineWidth = blur > 1e-5 ? w : 0;
						// Soft edge uses outline channel — match solid fill (was default white).
						troika.outlineColor = shDerived
							? "#ffffff"
							: contentPrimaryColor(shContent);
						troika.outlineOpacity = shAlpha;
						if (blur > 1e-5) {
							if (shDerived) {
								// Texture/gradient on face mat (outline inherits uniforms).
								applyContent(troika, pass.layer.content, shAlpha, 0);
							} else {
								markTroikaHollowFill(troika, false);
								applySolidExpandMaterial(
									troika,
									contentPrimaryColor(shContent) || "#ffffff",
									shAlpha,
									0,
								);
							}
							markTroikaHollowFill(troika, true);
						} else {
							applyContent(troika, pass.layer.content, shAlpha, w);
						}
						applyTroikaItalicShear(troika, isFccItalic(ui));
						troika.visible = shAlpha > 1e-4;
						return;
					}
					// Inner shadow: offset+blur then Face-SDF mask (no halo outside contour).
					if (pass.kind === "inner") {
						const w =
							Math.max(0, Number(pass.layer.width) || 0) + boldExpandForUi(ui);
						const ox = Number(pass.layer.offsetX) || 0;
						const oy = Number(pass.layer.offsetY) || 0;
						const blur = Math.max(0, Number(pass.layer.diffuse) || 0);
						const innerContent = normalizeFillContent(pass.layer.content);
						const innerDerived =
							innerContent.renderType === "gradient" ||
							innerContent.renderType === "texture";
						troika.position.set(ox, oy, z);
						troika.outlineBlur = blur;
						troika.outlineWidth = blur > 1e-5 ? w : 0;
						const col = contentPrimaryColor(innerContent);
						troika.outlineColor = col;
						troika.outlineOpacity =
							pass.layer.alpha != null ? Number(pass.layer.alpha) : 1;
						if (blur > 1e-5) {
							if (innerDerived) {
								applyContent(
									troika,
									pass.layer.content,
									Number(pass.layer.alpha) || 1,
									0,
								);
							} else {
								markTroikaHollowFill(troika, false);
								applySolidExpandMaterial(
									troika,
									col || "#ffffff",
									troika.outlineOpacity,
									0,
								);
							}
							markTroikaHollowFill(troika, true);
						} else {
							applyContent(
								troika,
								pass.layer.content,
								Number(pass.layer.alpha) || 1,
								w,
							);
						}
						(
							troika.userData as {
								fccInnerShadow?: { ox: number; oy: number };
							}
						).fccInnerShadow = { ox, oy };
						applyTroikaItalicShear(troika, isFccItalic(ui));
						return;
					}
					if (pass.kind === "stroke") {
						const w = Math.max(0, Number(pass.layer.width) || 0);
						if (pass.shadowParent) {
							troika.position.set(
								Number(pass.shadowParent.offsetX) || 0,
								Number(pass.shadowParent.offsetY) || 0,
								troika.position.z,
							);
						}
						const stContent = normalizeFillContent(pass.layer.content);
						const col = contentPrimaryColor(stContent);
						const side = pass.layer.side === "inner" ? "inner" : "outer";
						const stDerived =
							stContent.renderType === "gradient" ||
							stContent.renderType === "texture";
						if (side === "inner") {
							// Troika strokeWidth = true inner rim. Negative outlineWidth inverts look.
							troika.outlineWidth = 0;
							troika.outlineOpacity = 0;
							troika.strokeWidth = w;
							troika.strokeColor = stDerived ? "#ffffff" : col;
							troika.strokeOpacity =
								pass.layer.alpha != null ? Number(pass.layer.alpha) : 1;
							if (stDerived) markTroikaHollowFill(troika, true);
							applyContent(
								troika,
								pass.layer.content,
								Number(pass.layer.alpha) || 1,
							);
							markTroikaHollowFill(troika, true);
							applyTroikaItalicShear(troika, isFccItalic(ui));
							return;
						}
						// Outer stroke: single face mat + SDF/geometry expand (no outlineWidth).
						troika.outlineWidth = 0;
						troika.outlineOpacity = 0;
						troika.outlineBlur = 0;
						markTroikaHollowFill(troika, false);
						applyContent(
							troika,
							pass.layer.content,
							Number(pass.layer.alpha) || 1,
							w + boldExpandForUi(ui),
						);
						if (stDerived) troika.color = "#ffffff";
						applyTroikaItalicShear(troika, isFccItalic(ui));
						return;
					}
					// Face fill: fake bold = SDF expand (same path as outer stroke).
					applyContent(
						troika,
						pass.layer.content,
						pass.layer.alpha != null ? Number(pass.layer.alpha) : 1,
						boldExpandForUi(ui),
					);
					applyTroikaItalicShear(troika, isFccItalic(ui));
				};

				let textSyncToken = 0;
				const syncText = (
					rect?: { w: number; h: number },
					target?: { group: THREE.Object3D; ui: typeof fccUI },
				) => {
					const g = target?.group ?? group;
					const ui = target?.ui ?? fccUI;
					const w = rect?.w ?? Number(ui.sizeDelta?.[0]) ?? 400;
					// Char-split owns drawing: never rebuild/re-show parent Effect stack.
					// (layoutAllCanvases / compositor sync used to race Troika callbacks → double text)
					const hideOrig = !!(g.userData as { __fccTextAnimHideOriginals?: boolean })
						.__fccTextAnimHideOriginals;
					if (hideOrig && !target) {
						// Originals are parked under __fccTextAnimPark by TextAnimRuntime.
						// Never rebuild parent Effect stack while char-split owns drawing.
						return;
					}
					const style = getEffectiveFlowerStyle(ui);
					// Do NOT put derived `style` in the sig: normalizeFlowerStyle may mint
					// new stack ids, which forced a Troika rebuild every frame for plain text.
					const sig = JSON.stringify({
						text: ui.text ?? "",
						fontSize: ui.fontSize,
						bold: ui.bold,
						italic: isFccItalic(ui),
						color: ui.color,
						letterSpacing: ui.letterSpacing,
						lineHeight: ui.lineHeight,
						align: ui.align,
						verticalAlign: ui.verticalAlign,
						font: ui.font,
						fontBold: ui.fontBold,
						outline: ui.outline,
						shadow: ui.shadow,
						flowerStyle: ui.flowerStyle ?? null,
						flowerBaseFontSize: ui.flowerBaseFontSize ?? null,
						w,
						innerFaceMask: 4, // fcc-ui-70 stencil Face clip
						strokeContentPaint: 5, // fcc-ui-81 SDF expand underlay
						effectStack: 1, // fcc-ui-84 free-order stack
						shadowWidth: 1, // fcc-ui-85 shadow dilate/width
						sigRev: 56, // fcc-tl-flower-67: idle preview RAF sleep + light FPS meter
					});
					const ud = g.userData as { __fccTextSig?: string };
					if (ud.__fccTextSig === sig) return;
					ud.__fccTextSig = sig;
					const token = ++textSyncToken;

					const passes = buildPasses(style);
					const keep = new Set(passes.map((p) => p.name));
					const toRemove: THREE.Object3D[] = [];
					for (const child of [...g.children]) {
						if (
							child.name === "__fccText" ||
							child.name === "__fccTextShadow" ||
							(child.name.startsWith(FCC_FLOWER_PREFIX) && !keep.has(child.name))
						) {
							toRemove.push(child);
						}
					}
					for (const child of toRemove) {
						g.remove(child);
						const t = child as InstanceType<typeof TroikaText> & {
							dispose?: () => void;
						};
						try {
							t.dispose?.();
						} catch {
							/* ignore */
						}
					}

					const zStep = 0.001;
					passes.forEach((pass, i) => {
						// Prefer direct child — do not reclaim Troika parked under __fccTextAnimPark.
						let mesh = g.children.find((c) => c.name === pass.name) as
							| InstanceType<typeof TroikaText>
							| undefined;
						if (!mesh || typeof (mesh as { sync?: unknown }).sync !== "function") {
							if (mesh) g.remove(mesh);
							mesh = new TroikaText();
							mesh.name = pass.name;
							mesh.frustumCulled = false;
							mesh.castShadow = false;
							mesh.receiveShadow = false;
							// Overlay camera is UI_LAYER-only; default layer 0 = invisible glyphs.
							const uiMode = getOwningCanvasRenderMode(g);
							mesh.layers.set(
								uiMode === "camera" ? UI_CAMERA_LAYER : UI_LAYER,
							);
						}
						if (mesh.parent === g) g.remove(mesh);
						g.add(mesh);
						const hideOrigNow = !!(g.userData as { __fccTextAnimHideOriginals?: boolean })
							.__fccTextAnimHideOriginals;
						// Editor UIText contract: apply hideOrig synchronously before Troika sync.
						mesh.visible = !hideOrigNow;
						if (hideOrigNow) mesh.layers.disableAll();
						const z = (i - passes.length) * zStep;
						applyPass(mesh, pass, w, z, ui);
						const m = mesh;
						const p = pass;
						m.sync(() => {
							if (token !== textSyncToken) return;
							if (p.layer.content) {
								const nc = normalizeFillContent(p.layer.content);
								const stDerived =
									nc.renderType === "gradient" || nc.renderType === "texture";
								if (
									contentUsesGradient(nc) ||
									nc.renderType === "texture" ||
									p.kind === "stroke" ||
									p.kind === "face" ||
									p.kind === "inner" ||
									p.kind === "shadow"
								) {
									const authoredExpand =
										(p.kind === "stroke" && p.layer.side !== "inner") ||
										p.kind === "shadow" ||
										p.kind === "inner"
											? Math.max(0, Number(p.layer.width) || 0)
											: 0;
									// Blurred shadow: width lives in outlineWidth, not SDF expand.
									const softShadowSync =
										(p.kind === "shadow" || p.kind === "inner") &&
										Math.max(0, Number(p.layer.diffuse) || 0) > 1e-5;
									// Face gets boldExpand only; stroke/shadow get authored + bold.
									const syncExpand = softShadowSync
										? 0
										: authoredExpand + boldExpandForUi(ui);
									if (
										p.kind === "stroke" &&
										p.layer.side === "inner" &&
										stDerived
									) {
										markTroikaHollowFill(m, true);
									}
									if (p.kind === "stroke" && p.layer.side !== "inner") {
										m.outlineWidth = 0;
										m.outlineOpacity = 0;
										m.outlineBlur = 0;
									}
									applyContent(
										m,
										p.layer.content,
										p.layer.alpha != null ? Number(p.layer.alpha) : 1,
										syncExpand,
									);
									applyTroikaItalicShear(m, isFccItalic(ui));
									if (p.kind === "stroke" && p.layer.side === "inner") {
										const w = Math.max(0, Number(p.layer.width) || 0);
										m.outlineWidth = 0;
										m.outlineOpacity = 0;
										m.strokeWidth = w;
										m.strokeColor = stDerived
											? "#ffffff"
											: contentPrimaryColor(nc);
										m.strokeOpacity =
											p.layer.alpha != null ? Number(p.layer.alpha) : 1;
										markTroikaHollowFill(m, true);
									} else if (p.kind === "stroke" && p.layer.side !== "inner") {
										m.outlineWidth = 0;
										m.outlineOpacity = 0;
										m.outlineBlur = 0;
										if (stDerived) m.color = "#ffffff";
										markTroikaHollowFill(m, false);
										if (p.shadowParent) {
											m.position.set(
												Number(p.shadowParent.offsetX) || 0,
												Number(p.shadowParent.offsetY) || 0,
												m.position.z,
											);
										}
									} else if (p.kind === "shadow") {
										const blurSync = Math.max(
											0,
											Number(p.layer.diffuse) || 0,
										);
										m.outlineWidth = blurSync > 1e-5
											? Math.max(0, Number(p.layer.width) || 0) +
												boldExpandForUi(ui)
											: 0;
										m.outlineBlur = blurSync;
										m.outlineOpacity =
											p.layer.alpha != null ? Number(p.layer.alpha) : 1;
										m.outlineColor = stDerived
											? "#ffffff"
											: contentPrimaryColor(nc);
										markTroikaHollowFill(m, blurSync > 1e-5);
									}
									if (p.kind === "face") {
										ensureFaceStencilWrite(m);
										m.visible = !(
											p.layer &&
											(p.layer as { visible?: boolean }).visible === false
										);
									} else if (p.kind !== "inner") {
										clearStencilState(m);
									}
									if (p.kind === "inner") {
										const ox = Number(p.layer.offsetX) || 0;
										const oy = Number(p.layer.offsetY) || 0;
										const blurSync = Math.max(
											0,
											Number(p.layer.diffuse) || 0,
										);
										m.outlineColor = contentPrimaryColor(nc);
										m.outlineOpacity =
											p.layer.alpha != null ? Number(p.layer.alpha) : 1;
										m.outlineBlur = blurSync;
										m.outlineWidth = blurSync > 1e-5
											? Math.max(0, Number(p.layer.width) || 0) +
												boldExpandForUi(ui)
											: 0;
										markTroikaHollowFill(m, blurSync > 1e-5);
										m.position.set(ox, oy, m.position.z);
										applyInnerShadowFaceMask(m);
									}
								} else {
									tuneMaterial(m);
									applyTroikaItalicShear(m, isFccItalic(ui));
								}
							} else {
								tuneMaterial(m);
								applyTroikaItalicShear(m, isFccItalic(ui));
							}
							const faceHidden =
								p.kind === "face" &&
								p.layer &&
								(p.layer as { visible?: boolean }).visible === false;
							const shadowCarrierHidden =
								p.kind === "shadow" &&
								p.layer &&
								(p.layer.alpha != null ? Number(p.layer.alpha) : 1) <= 1e-4;
							const hideOrigCb = !!(g.userData as { __fccTextAnimHideOriginals?: boolean })
								.__fccTextAnimHideOriginals;
							m.visible =
								!faceHidden && !shadowCarrierHidden && !hideOrigCb;
							if (hideOrigCb) {
								m.layers.disableAll();
							} else {
								applyTroikaTextMeshLayers(
									g,
									getOwningCanvasRenderMode(g),
								);
							}
							// Glyphs ready — wake OpenCut preview (same-frame skip otherwise).
							bumpFlowerTextFrameEpoch();
						});
					});
				};

				(
					group.userData as {
						__fccSyncText?: (r: { w: number; h: number }) => void;
						__fccSyncCharFlower?: (
							charGroup: THREE.Object3D,
							charUI: typeof fccUI,
							rect?: { w: number; h: number },
						) => void;
					}
				).__fccSyncText = syncText;
				(
					group.userData as {
						__fccSyncCharFlower?: (
							charGroup: THREE.Object3D,
							charUI: typeof fccUI,
							rect?: { w: number; h: number },
						) => void;
					}
				).__fccSyncCharFlower = (charGroup, charUI, rect) => {
					syncText(rect, { group: charGroup, ui: charUI });
				};
				syncText();
				registerObject(group, node);
				group.position.set(0, 0, 0);
				group.scale.set(1, 1, 1);
				group.rotation.set(0, 0, 0);
				applyUIObjectFlags(group);
				continue;
			}

			// Image: Group (fccUI + Euler) + __fccImageMesh (pixel size via scale).
			const geometry = new THREE.PlaneGeometry(1, 1);
			disposables.push(geometry);
			const material = await createMaterial(node, loadTexture, pack, disposables);
			disposables.push(material);
			const matUuid = node.materials?.[0]?.uuid;
			if (matUuid) materialsByUuid.set(matUuid, material);
			collectBelowInputNames(material, belowInputUniformNames);
			const group = new THREE.Group();
			group.userData = { ...(node.userData || {}), fccUI };
			const mesh = new THREE.Mesh(geometry, material);
			mesh.name = "__fccImageMesh";
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			group.add(mesh);
			registerObject(group, node);
			applyUIObjectFlags(group);
			continue;
		}
		if (node.kind === "mesh" || node.type === "Mesh" || node.type === "SkinnedMesh") {
			const geometry = await createGeometry(node, pack);
			disposables.push(geometry);
			const material = await createMaterial(node, loadTexture, pack, disposables);
			disposables.push(material);
			const matUuid = node.materials?.[0]?.uuid;
			if (matUuid) materialsByUuid.set(matUuid, material);
			collectBelowInputNames(material, belowInputUniformNames);
			const mesh = new THREE.Mesh(geometry, material);
			registerObject(mesh, node);
			continue;
		}

		if (node.kind === "bone" || node.type === "Bone") {
			const bone = new THREE.Bone();
			registerObject(bone, node);
			continue;
		}

		if (
			node.kind === "group" ||
			node.type === "Group" ||
			node.kind === "object" ||
			node.type === "Object3D" ||
			node.kind === "videoPlayer" ||
			node.kind === "renderTexture"
		) {
			const group = new THREE.Group();
			group.userData = { ...(node.userData || {}) };
			const prevVp = (group.userData.fccVideoPlayer || {}) as Record<string, unknown>;
			if (node.video || node.kind === "videoPlayer" || prevVp.targetUuid || prevVp.fileName) {
				group.userData.fccVideoPlayer = { ...prevVp, ...(node.video || {}) };
			}
			registerObject(group, node);
			continue;
		}

		if (node.kind === "light" || (node.type && /Light$/.test(node.type))) {
			const lightType = String(
				(node as VfxSceneNode & { lightType?: string }).lightType || node.type || "",
			);
			let light: THREE.Light | null = null;
			const colorHex =
				typeof (node as { color?: string }).color === "string"
					? (node as { color?: string }).color!
					: "#ffffff";
			const intensity =
				typeof (node as { intensity?: number }).intensity === "number"
					? (node as { intensity?: number }).intensity!
					: 1;
			if (lightType === "AmbientLight") {
				light = new THREE.AmbientLight(colorHex, intensity);
			} else if (lightType === "DirectionalLight") {
				light = new THREE.DirectionalLight(colorHex, intensity);
			} else if (lightType === "PointLight") {
				light = new THREE.PointLight(colorHex, intensity);
			} else if (lightType === "HemisphereLight") {
				const ground =
					typeof (node as { groundColor?: string }).groundColor === "string"
						? (node as { groundColor?: string }).groundColor!
						: "#444444";
				light = new THREE.HemisphereLight(colorHex, ground, intensity);
			} else if (lightType === "SpotLight") {
				light = new THREE.SpotLight(colorHex, intensity);
			}
			if (light) {
				registerObject(light, node);
			}
			continue;
		}
	}

	// Attach hierarchy: Editor parent uuid -> OpenCut object. Missing parent -> root.
	for (const [uuid, parentUuid] of pendingParents) {
		const obj = objectsByUuid.get(uuid);
		if (!obj) continue;
		const parent =
			parentUuid && objectsByUuid.get(parentUuid)
				? objectsByUuid.get(parentUuid)!
				: root;
		if (obj.parent !== parent) {
			parent.add(obj);
		}
	}

	// Re-apply UI layers AFTER parenting. Image flags run before Canvas is
	// parented, so getOwningCanvasRenderMode would wrongly pick Overlay and
	// Camera-mode beauty would skip the Image (overlay pass also skips).
	root.traverse((o) => {
		const ud = o.userData as { fccUI?: { type?: string } } | undefined;
		if (ud?.fccUI?.type) applyUIObjectFlags(o);
	});

	ensurePackRenderTargets(root);
	rebindPackRenderTextures(root);
	await preparePackVideos({ root, pack, nodes: sceneFile.nodes });

	if (!camera) {
		camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
		camera.position.set(0, 1.5, 4);
		camera.lookAt(0, 0, 0);
		root.add(camera);
	}

	// Keep Screen-Space UI off the beauty / EffectComposer camera (layer 0 only).
	camera.layers.disable(UI_LAYER);
	camera.layers.disable(UI_CAMERA_LAYER);
	camera.layers.enable(0);

	const belowNames = Array.from(belowInputUniformNames);
	const exposedParams = normalizeExposedParams({
		manifest: pack.manifest,
		scene: sceneFile,
	});


	// Load FreeFilmCut .anim clips listed in manifest (or assets.animations)
	const animClips: FreecapcutAnimClip[] = [];
	const animPaths = new Set<string>();
	for (const entry of pack.manifest.animations || []) {
		if (entry?.path) animPaths.add(String(entry.path).replace(/^pack\//, ""));
	}
	for (const p of pack.manifest.assets?.animations || []) {
		if (p) animPaths.add(String(p).replace(/^pack\//, ""));
	}
	// Also pick up any *.anim under animations/
	for (const key of pack.files.keys()) {
		if (/^animations\/.*\.anim$/i.test(key)) animPaths.add(key);
	}
	const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
	for (const rel of animPaths) {
		const bytes = pack.files.get(rel) || pack.files.get(`pack/${rel}`);
		if (!bytes) continue;
		try {
			const raw = JSON.parse(decodeText(bytes));
			const clip = normalizeAnim(raw);
			if (clip) animClips.push(clip);
		} catch (err) {
			console.warn("[FreeFilmCut] failed to parse .anim", rel, err);
		}
	}

	// Load FreeFilmCut timelines (manifest list, fallback to scene.assets.timelines)
	const timelines: TimelineAsset[] = [];
	const timelinePaths: string[] = [];
	for (const entry of pack.manifest.timelines || []) {
		if (entry?.path) timelinePaths.push(String(entry.path));
	}
	if (timelinePaths.length === 0) {
		for (const p of sceneFile.assets?.timelines || []) {
			if (p) timelinePaths.push(String(p));
		}
	}
	for (const rawPath of timelinePaths) {
		const rel = rawPath.replace(/^pack\//, "");
		const bytes = pack.files.get(rel) || pack.files.get(`pack/${rel}`);
		if (!bytes) continue;
		try {
			const asset = JSON.parse(decodeText(bytes)) as TimelineAsset;
			if (asset) timelines.push(asset);
		} catch (err) {
			console.warn("[FreeFilmCut] failed to parse timeline", rel, err);
		}
	}

	if (postProcess) registerCustomEffectsFromStack(postProcess);

	const resolveAssetUrl = (path: string): string | null => {
		if (!path) return null;
		const clean = path.replace(/^pack\//, "").replace(/^\.\//, "");
		return (
			pack.objectUrls.get(clean) ||
			pack.objectUrls.get("pack/" + clean) ||
			pack.objectUrls.get(path) ||
			null
		);
	};

	return {
		packId: pack.id,
		packType: String(pack.type || "effect"),
		packScope: String(pack.scope || (needsBelow ? "below" : "stack")),
		needsBelowInput: needsBelow,
		belowInputUniformNames: belowNames,
		root,
		camera,
		disposables,
		postProcess,
		resolveAssetUrl,
		materialsByUuid,
		animClips,
		timelines,
		objectsByUuid,
		buildRev: PACK_SCENE_BUILD_REV,
		resolution: {
			width: Math.max(1, sceneFile.resolution?.width || pack.manifest.resolution?.width || 1920),
			height: Math.max(1, sceneFile.resolution?.height || pack.manifest.resolution?.height || 1080),
		},
		hasUI: (() => {
			let found = false;
			root.traverse((o) => {
				if (found) return;
				const ud = o.userData as { fccUI?: { type?: string } };
				if (ud?.fccUI?.type) found = true;
			});
			return found;
		})(),
		exposedParams,
		pendingDefaultEnvironment: envApply.pendingDefaultEnvironment,
		render: sceneFile.render
			? {
					toneMapping: sceneFile.render.toneMapping,
					toneMappingExposure: sceneFile.render.toneMappingExposure,
					shadows: sceneFile.render.shadows,
					shadowType: sceneFile.render.shadowType,
					antialias: sceneFile.render.antialias,
			  }
			: undefined,
	};
}

/** Bake editor Default IBL on the same WebGLRenderer that draws the pack. */
export function ensureBuiltPackDefaultEnvironment({
	built,
	renderer,
}: {
	built: BuiltPackScene;
	renderer: THREE.WebGLRenderer;
}): boolean {
	if (!built.pendingDefaultEnvironment) return !!built.root.environment;
	const bg = built.root.background;
	const baked = bakeDefaultEnvironmentMap(
		renderer,
		bg instanceof THREE.Color || (bg as THREE.Texture | null)?.isTexture
			? (bg as THREE.Color | THREE.Texture)
			: null,
	);
	if (!baked) return false;
	built.root.environment = baked.texture;
	built.disposables.push(baked);
	built.pendingDefaultEnvironment = false;
	removeFccFillLights(built.root);
	return true;
}

function removeFccFillLights(root: THREE.Object3D) {
	const doomed: THREE.Object3D[] = [];
	root.traverse((o) => {
		if (o.userData?.__fccFillLight) doomed.push(o);
	});
	for (const o of doomed) {
		o.parent?.remove(o);
		const light = o as THREE.Light;
		if (typeof light.dispose === "function") light.dispose();
	}
}

export function disposeBuiltPackScene({ built }: { built: BuiltPackScene }) {
	disposePackVideos(built.root);
	for (const d of built.disposables) {
		d.dispose();
	}
	built.root.clear();
}

function applyTransform(obj: THREE.Object3D, node: VfxSceneNode) {
	const t = node.transform;
	if (t.matrix && t.matrix.length === 16) {
		const m = new THREE.Matrix4().fromArray(t.matrix);
		m.decompose(obj.position, obj.quaternion, obj.scale);
	} else {
		obj.position.fromArray(t.position);
		obj.quaternion.fromArray(t.quaternion);
		obj.scale.fromArray(t.scale);
	}
	// Keep Euler in sync so .anim rotation.* tracks compose correctly.
	obj.rotation.setFromQuaternion(obj.quaternion, obj.rotation.order);
}


async function readPackText(
	pack: LoadedVfxPack,
	relPath: string | undefined,
): Promise<string | null> {
	if (!relPath) return null;
	const url = pack.objectUrls.get(relPath);
	if (url) {
		try {
			return await fetch(url).then((r) => r.text());
		} catch {
			/* fall through */
		}
	}
	const bytes = pack.files.get(relPath);
	if (!bytes) return null;
	return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Same as editor Viewport `environmentType === 'Default'`:
 * - background Color  → PMREM(ColorEnvironment(bg), 0.04)
 * - background Texture → use bg as Equirect env (no PMREM)
 * - background null    → PMREM(RoomEnvironment(), 0.04)
 * Must run on the draw WebGLRenderer (cross-context PMREM is black).
 */
function bakeDefaultEnvironmentMap(
	renderer: THREE.WebGLRenderer,
	background: THREE.Color | THREE.Texture | null,
): { texture: THREE.Texture; dispose: () => void } | null {
	try {
		if (background && (background as THREE.Texture).isTexture) {
			const tex = background as THREE.Texture;
			tex.mapping = THREE.EquirectangularReflectionMapping;
			return {
				texture: tex,
				dispose: () => {
					/* pack-owned texture; disposed via textureCache */
				},
			};
		}
		const pmrem = new THREE.PMREMGenerator(renderer);
		pmrem.compileEquirectangularShader();
		const envScene =
			background instanceof THREE.Color
				? new ColorEnvironment(background)
				: new RoomEnvironment();
		const renderTarget = pmrem.fromScene(envScene, 0.04);
		const texture = renderTarget.texture;
		if (typeof (envScene as { dispose?: () => void }).dispose === "function") {
			(envScene as { dispose: () => void }).dispose();
		}
		pmrem.dispose();
		return {
			texture,
			dispose: () => {
				renderTarget.dispose();
			},
		};
	} catch (err) {
		console.warn("[FreeFilmCut] Default environment PMREM failed", err);
		return null;
	}
}

async function applySceneRenderSettings({
	root,
	sceneFile,
	loadTexture,
	disposables,
	renderer,
}: {
	root: THREE.Scene;
	sceneFile: NonNullable<LoadedVfxPack["scene"]>;
	loadTexture: (rel: string) => Promise<THREE.Texture | null>;
	disposables: Array<{ dispose: () => void }>;
	renderer: THREE.WebGLRenderer | null;
}): Promise<{ pendingDefaultEnvironment: boolean }> {
	const bg = sceneFile.background as
		| {
				type?: string;
				color?: string;
				path?: string | null;
				blurriness?: number;
				intensity?: number;
		  }
		| string
		| null
		| undefined;

	if (typeof bg === "string") {
		root.background = new THREE.Color(bg);
	} else if (bg && typeof bg === "object") {
		if (bg.type === "Color" && bg.color) {
			root.background = new THREE.Color(bg.color);
		} else if (
			(bg.type === "Texture" || bg.type === "Equirectangular") &&
			bg.path
		) {
			const tex = await loadTexture(bg.path);
			if (tex) {
				if (bg.type === "Equirectangular") {
					tex.mapping = THREE.EquirectangularReflectionMapping;
				}
				root.background = tex;
			}
		} else if (bg.type === "None") {
			root.background = null;
		}
		if (typeof bg.blurriness === "number") {
			root.backgroundBlurriness = bg.blurriness;
		}
		if (typeof bg.intensity === "number") {
			root.backgroundIntensity = bg.intensity;
		}
	}

	const env = sceneFile.environment as
		| {
				type?: string;
				path?: string | null;
				intensity?: number;
				exported?: boolean;
				name?: string;
		  }
		| null
		| undefined;
	const envType = env?.type;
	const applyEnvIntensity = () => {
		if (env && typeof env.intensity === "number") {
			(
				root as THREE.Scene & { environmentIntensity?: number }
			).environmentIntensity = env.intensity;
		}
	};
	let pendingDefaultEnvironment = false;
	const applyDefaultIbl = (): boolean => {
		if (!renderer) {
			pendingDefaultEnvironment = true;
			return false;
		}
		const bg = root.background;
		const baked = bakeDefaultEnvironmentMap(
			renderer,
			bg instanceof THREE.Color || (bg as THREE.Texture | null)?.isTexture
				? (bg as THREE.Color | THREE.Texture)
				: null,
		);
		if (!baked) {
			pendingDefaultEnvironment = true;
			return false;
		}
		root.environment = baked.texture;
		disposables.push(baked);
		pendingDefaultEnvironment = false;
		return true;
	};

	if (envType === "None") {
		root.environment = null;
	} else if (envType === "Equirectangular" && env?.path) {
		// Legacy packs dump editor PMREM as Equirect with missing/unreadable PNG.
		const looksLikePmremDump =
			env.exported === false ||
			/pmrem/i.test(String(env.name || env.path || ""));
		const tex = looksLikePmremDump ? null : await loadTexture(env.path);
		if (tex) {
			tex.mapping = THREE.EquirectangularReflectionMapping;
			root.environment = tex;
		} else {
			applyDefaultIbl();
		}
		applyEnvIntensity();
	} else {
		// Default / missing → match editor RoomEnvironment / ColorEnvironment.
		applyDefaultIbl();
		applyEnvIntensity();
	}

	const fog = sceneFile.fog;
	if (fog && fog.type === "Fog") {
		root.fog = new THREE.Fog(
			fog.color ?? "#000000",
			fog.near ?? 1,
			fog.far ?? 1000,
		);
	} else if (fog && fog.type === "FogExp2") {
		root.fog = new THREE.FogExp2(
			fog.color ?? "#000000",
			fog.density ?? 0.00025,
		);
	}

	return { pendingDefaultEnvironment };
}

function typedArrayFromJSON(
	type: string | undefined,
	array: number[],
): Float32Array | Uint16Array | Uint32Array | Int16Array | Int32Array | Uint8Array {
	switch (type) {
		case "Uint16Array":
			return new Uint16Array(array);
		case "Uint32Array":
			return new Uint32Array(array);
		case "Int16Array":
			return new Int16Array(array);
		case "Int32Array":
			return new Int32Array(array);
		case "Uint8Array":
			return new Uint8Array(array);
		case "Float32Array":
		default:
			return new Float32Array(array);
	}
}

async function createGeometry(
	node: VfxSceneNode,
	pack?: LoadedVfxPack,
): Promise<THREE.BufferGeometry> {
	const g = node.geometry;
	const p = g?.parameters ?? {};
	if (g?.type === "BoxGeometry") {
		return new THREE.BoxGeometry(
			p.width ?? 1,
			p.height ?? 1,
			p.depth ?? 1,
			p.widthSegments ?? 1,
			p.heightSegments ?? 1,
			p.depthSegments ?? 1,
		);
	}
	if (g?.type === "PlaneGeometry") {
		return new THREE.PlaneGeometry(p.width ?? 1, p.height ?? 1);
	}
	if (g?.type === "SphereGeometry") {
		return new THREE.SphereGeometry(
			p.radius ?? 0.5,
			p.widthSegments ?? 32,
			p.heightSegments ?? 16,
		);
	}

	// Imported BufferGeometry (GLB/FBX): load packed attribute JSON.
	const dataPath = g?.data;
	if (dataPath && pack) {
		const raw = await readPackText(pack, dataPath);
		if (raw) {
			try {
				const payload = JSON.parse(raw) as {
					attributes?: Record<
						string,
						{
							itemSize?: number;
							normalized?: boolean;
							type?: string;
							array?: number[];
						}
					>;
					index?: { type?: string; array?: number[] };
				};
				const geom = new THREE.BufferGeometry();
				if (g.uuid) geom.uuid = g.uuid;
				const attrs = payload.attributes || {};
				for (const [name, attr] of Object.entries(attrs)) {
					if (!attr?.array || !attr.itemSize) continue;
					const arr = typedArrayFromJSON(attr.type, attr.array);
					geom.setAttribute(
						name,
						new THREE.BufferAttribute(arr, attr.itemSize, !!attr.normalized),
					);
				}
				if (payload.index?.array) {
					const idx = typedArrayFromJSON(payload.index.type, payload.index.array);
					geom.setIndex(new THREE.BufferAttribute(idx, 1));
				}
				geom.computeBoundingSphere();
				return geom;
			} catch (err) {
				console.warn("[vfxpack] failed to load geometry data", dataPath, err);
			}
		}
	}

	// Last resort for old packs that only listed BufferGeometry metadata.
	return new THREE.BoxGeometry(1, 1, 1);
}

async function createMaterial(
	node: VfxSceneNode,
	loadTexture: (rel: string) => Promise<THREE.Texture | null>,
	pack?: LoadedVfxPack,
	disposables?: Array<{ dispose: () => void }>,
): Promise<THREE.Material> {
	const matDef = node.materials?.[0];
	const color = matDef?.color
		? new THREE.Color(matDef.color)
		: new THREE.Color(0xffffff);
	const mapPath = matDef?.textures?.map;
	const mapIsRt =
		!!mapPath &&
		(mapPath.startsWith("rt:") || /rendertexture/i.test(mapPath));
	const map =
		mapPath && !mapIsRt ? await loadTexture(mapPath) : null;

	// Custom ShaderMaterial / RawShaderMaterial from Editor export
	const shaderPaths = matDef?.shader as
		| { vertex?: string; fragment?: string; raw?: boolean }
		| undefined;
	if (
		pack &&
		shaderPaths?.vertex &&
		shaderPaths?.fragment &&
		(matDef?.type === "ShaderMaterial" || matDef?.type === "RawShaderMaterial")
	) {
		const vertexShader = await readPackText(pack, shaderPaths.vertex);
		const fragmentShader = await readPackText(pack, shaderPaths.fragment);
		if (vertexShader && fragmentShader) {
			// WebGL: a null sampler2D uniform often makes ALL samplers sample black
			// (including uInput). Always bind a 1x1 placeholder for empty maps.
			const white1x1 = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
			white1x1.needsUpdate = true;
			white1x1.colorSpace = THREE.SRGBColorSpace;
			disposables?.push(white1x1);
			const uniforms: Record<string, { value: unknown }> = {
				map: { value: map ?? white1x1 },
				color: { value: color.clone() },
				opacity: { value: matDef?.opacity ?? 1 },
				uTime: { value: 0 },
				useMap: { value: map !== null || mapIsRt },
			};
			const ud = (matDef as { uniforms?: Record<string, unknown> })?.uniforms;
			if (ud) {
				for (const [k, v] of Object.entries(ud)) {
					if (v && typeof v === "object" && (v as { type?: string }).type === "t") {
						// NLE binds below-composite each frame 閳?never treat as packed map.
						const binding = (v as { binding?: string }).binding;
						if (
							isBelowInputUniformName(k) ||
							binding === "accumBelow"
						) {
							uniforms[k] = { value: white1x1 };
							continue;
						}
						const p = (v as { path?: string }).path;
						if (p?.startsWith("rt:") || (p && /rendertexture/i.test(p))) {
							uniforms[k] = { value: white1x1 };
							continue;
						}
						const loaded = p ? await loadTexture(p) : null;
						uniforms[k] = { value: loaded ?? white1x1 };
					} else if (
						v &&
						typeof v === "object" &&
						"value" in (v as object)
					) {
						const raw = (v as { value: unknown }).value;
						if (typeof raw === "string" && raw.startsWith("#")) {
							uniforms[k] = { value: new THREE.Color(raw) };
						} else {
							uniforms[k] = { value: raw };
						}
					} else if (typeof v === "string" && v.startsWith("#")) {
						uniforms[k] = { value: new THREE.Color(v) };
					} else if (v !== null && v !== undefined) {
						uniforms[k] = { value: v };
					}
					// else: skip null (uInput placeholder / NLE bind)
				}
			}
			// Auto-create sampler slots declared as uInput / belowInput / iChannel0
			const belowNames = ensureBelowInputUniforms({
				uniforms,
				vertexShader,
				fragmentShader,
			});
			ensureTransitionInputUniforms({
				uniforms,
				vertexShader,
				fragmentShader,
			});
			// Placeholder so WebGL always has a real sampler (null samples as black).
			for (const name of belowNames) {
				if (!uniforms[name].value) {
					uniforms[name].value = white1x1;
				}
			}
			for (const name of [
				"uTransitionFrom",
				"uFrom",
				"transitionFrom",
				"uTransitionTo",
				"uTo",
				"transitionTo",
			]) {
				if (uniforms[name] && !uniforms[name].value) {
					uniforms[name].value = white1x1;
				}
			}
			// Any other sampler left null also breaks sibling samplers on some GPUs.
			for (const [k, u] of Object.entries(uniforms)) {
				if (u.value === null || u.value === undefined) {
					// Heuristic: names used as textures in this material path
					if (/map|input|channel|tex|sampler/i.test(k)) {
						u.value = white1x1;
					}
				}
			}
			const Ctor = shaderPaths.raw ? THREE.RawShaderMaterial : THREE.ShaderMaterial;
			const matBuilt = new Ctor({
				uniforms,
				vertexShader,
				fragmentShader,
				transparent: matDef?.transparent ?? false,
				opacity: matDef?.opacity ?? 1,
				side: matDef?.side ?? THREE.DoubleSide,
				toneMapped: false,
				depthWrite: matDef?.depthWrite ?? true,
				depthTest: matDef?.depthTest ?? true,
			});
			if (!matBuilt.userData) matBuilt.userData = {};
			matBuilt.userData.freecapcutGlobalScreen = true;
			ensureGlobalScreenUniforms(matBuilt, { forceAll: true });
			stampRtSlots(matBuilt, matDef);
			return matBuilt;
		}
	}

	if (matDef?.type === "MeshBasicMaterial") {
		const basic = new THREE.MeshBasicMaterial({
			color,
			map,
			transparent: matDef.transparent ?? false,
			opacity: matDef.opacity ?? 1,
			side: matDef.side ?? THREE.FrontSide,
			depthWrite: matDef.depthWrite ?? true,
			depthTest: matDef.depthTest ?? true,
		});
		basic.toneMapped = false;
		stampRtSlots(basic, matDef);
		return basic;
	}

	const standard = new THREE.MeshStandardMaterial({
		color,
		map,
		emissive: matDef?.emissive ? new THREE.Color(matDef.emissive) : undefined,
		metalness: matDef?.metalness ?? 0,
		roughness: matDef?.roughness ?? 1,
		transparent: matDef?.transparent ?? false,
		opacity: matDef?.opacity ?? 1,
		side: matDef?.side ?? THREE.FrontSide,
	});
	stampRtSlots(standard, matDef);
	return standard;
}

function stampRtSlots(
	material: THREE.Material,
	matDef:
		| {
				textures?: Record<string, string>;
				uniforms?: Record<string, unknown>;
		  }
		| undefined,
) {
	const slots: { key: string; uuid: string }[] = [];
	const textures = matDef?.textures;
	if (textures) {
		for (const [key, path] of Object.entries(textures)) {
			if (typeof path !== "string") continue;
			if (path.startsWith("rt:")) {
				slots.push({ key, uuid: path.slice(3) });
			} else if (/rendertexture/i.test(path)) {
				// Legacy packs exported the RT as an empty PNG 鈥?bind the sole RT later.
				slots.push({ key, uuid: "__auto__" });
			}
		}
	}
	const uniforms = (matDef as { uniforms?: Record<string, unknown> } | undefined)?.uniforms;
	if (uniforms) {
		for (const [key, value] of Object.entries(uniforms)) {
			if (!value || typeof value !== "object") continue;
			const path = (value as { path?: string }).path;
			if (typeof path !== "string") continue;
			if (path.startsWith("rt:")) {
				slots.push({ key, uuid: path.slice(3) });
			} else if (/rendertexture/i.test(path)) {
				slots.push({ key, uuid: "__auto__" });
			}
		}
	}
	if (slots.length > 0) {
		(material.userData as { fccRtSlots?: { key: string; uuid: string }[] }).fccRtSlots = slots;
	}
}


function collectBelowInputNames(
	material: THREE.Material,
	into: Set<BelowInputUniformName>,
) {
	const mat = material as THREE.ShaderMaterial;
	if (!mat.uniforms) return;
	const names = ensureBelowInputUniforms({
		uniforms: mat.uniforms as Record<string, { value: unknown }>,
		vertexShader: mat.vertexShader,
		fragmentShader: mat.fragmentShader,
	});
	for (const n of names) into.add(n);
}
