import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { RootNode } from "./nodes/root-node";
import { VideoNode } from "./nodes/video-node";
import { ImageNode } from "./nodes/image-node";
import { TextNode } from "./nodes/text-node";
import { StickerNode } from "./nodes/sticker-node";
import { GraphicNode } from "./nodes/graphic-node";
import { ColorNode } from "./nodes/color-node";
import { BlurBackgroundNode } from "./nodes/blur-background-node";
import { CoverFillNode } from "./nodes/cover-fill-node";
import { EffectLayerNode } from "./nodes/effect-layer-node";
import type { AnyBaseNode } from "./nodes/base-node";
import type { TBackground, TCanvasSize } from "@/project/types";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import {
	isBackgroundFillActive,
	readBackgroundFillFromParams,
} from "@/background/fill";
import { resolveBackgroundFillStyleUrl } from "@/background/fill-styles";
import {
	buildTransformFromParams,
	readBlendModeFromParams,
	readOpacityFromParams,
} from "@/rendering";
import { buildCutTransitionBindings } from "./cut-transition";
import { readChromaKeyFromParams } from "@/chroma-key";
import { readColorCorrectionFromParams } from "@/color-correction";
import { readColorGradeFromParams } from "@/color-grade";

const PREVIEW_MAX_IMAGE_SIZE = 2048;

function getVisibleSortedElements({ track }: { track: TimelineTrack }) {
	return track.elements
		.filter((element) => !("hidden" in element && element.hidden))
		.slice()
		.sort((a, b) => {
			if (a.startTime !== b.startTime) return a.startTime - b.startTime;
			return a.id.localeCompare(b.id);
		});
}

/**
 * Only hands the keyer to nodes that actually use it.
 *
 * An `undefined` here keeps un-keyed clips on the old allocation-free path:
 * `resolve` returns `chromaKey: null` and the compositor never touches the
 * shader uniforms.
 */
function buildChromaKeyParam({
	element,
}: {
	element: { params: import("@/params").ParamValues };
}): { chromaKey?: import("@/chroma-key").ChromaKeySettings } {
	const chromaKey = readChromaKeyFromParams({ params: element.params });
	return chromaKey.enabled ? { chromaKey } : {};
}

/**
 * Always attach base grade so keyframed Adjustment params can sample even when
 * the static defaults are identity. Resolve turns identity back into null.
 */
function buildColorGradeParam({
	element,
}: {
	element: { params: import("@/params").ParamValues };
}): { colorGrade: import("@/color-grade").ColorGradeSettings } {
	return {
		colorGrade: readColorGradeFromParams({ params: element.params }),
	};
}

/**
 * Always attach base correction so the intensity keyframe can sample even when
 * the clip is disabled. Resolve turns inactive correction back into null.
 */
function buildColorCorrectionParam({
	element,
}: {
	element: { params: import("@/params").ParamValues };
}): { colorCorrection: import("@/color-correction").ColorCorrectionSettings } {
	return {
		colorCorrection: readColorCorrectionFromParams({ params: element.params }),
	};
}

type CachedElementNodes = {
	deps: readonly unknown[];
	nodes: AnyBaseNode[];
	/** Last element object that was built or patched into `nodes`. */
	element: TimelineElement;
};

/**
 * Reuses scene nodes across preview rebuilds.
 *
 * Timeline edits install a **new element object** every time (preview overlay
 * spreads). A WeakMap keyed on object identity therefore misses on every
 * Basic/HSL slider tick and rebuilds VideoNode — the "drag one slider, FPS
 * dies" path. Cache by `element.id` instead: structural deps decide rebuild vs
 * in-place param patch; a params-only scrub keeps the GPU node and only forces
 * a new root so preview recomposes.
 */
export type SceneNodeCache = {
	elements: Map<string, CachedElementNodes>;
	projectColor: ColorNode | null;
	lastRoot: RootNode | null;
	/** True when the last buildScene patched node params without rebuilding. */
	paramsPatched: boolean;
};

export function createSceneNodeCache(): SceneNodeCache {
	return {
		elements: new Map(),
		projectColor: null,
		lastRoot: null,
		paramsPatched: false,
	};
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!Object.is(a[i], b[i])) return false;
	}
	return true;
}

/** Structural inputs — param-only edits (color grade, opacity, …) must NOT be here. */
function getElementNodeDeps({
	track,
	element,
	mediaMap,
	mediaAssets,
	canvasSize,
	isPreview,
}: {
	track: TimelineTrack;
	element: TimelineElement;
	mediaMap: Map<string, MediaAsset>;
	mediaAssets: MediaAsset[];
	canvasSize: TCanvasSize;
	isPreview?: boolean;
}): unknown[] {
	const deps: unknown[] = [
		element.type,
		canvasSize.width,
		canvasSize.height,
		isPreview,
	];

	if (element.type === "effect") {
		deps.push(element.effectType);
		return deps;
	}
	if (element.type === "sticker") {
		deps.push(
			element.stickerId,
			element.intrinsicWidth,
			element.intrinsicHeight,
		);
		return deps;
	}
	if (element.type === "graphic") {
		deps.push(element.definitionId);
		return deps;
	}
	if (element.type === "text") {
		// Glyph / flower layout keys — transform/opacity still patch in place.
		const p = element.params;
		deps.push(
			p.content,
			p.fontSize,
			p.fontFamily,
			p.fontWeight,
			p.fontStyle,
			p.textAlign,
			p.letterSpacing,
			p.lineHeight,
			element.flowerStyle ?? null,
			element.flowerBaseFontSize ?? null,
			element.flowerTemplateId ?? null,
			element.textTemplatePackId ?? null,
			element.textFxStack ?? null,
		);
		return deps;
	}
	if (element.type !== "video" && element.type !== "image") return deps;

	deps.push(mediaMap.get(element.mediaId));
	const fill = readBackgroundFillFromParams({ params: element.params });
	const fillActive = isBackgroundFillActive({ fill });
	deps.push(fillActive, fill.mode);
	if (fillActive && fill.mode === "style") deps.push(fill.styleId);
	if (fillActive && fill.mode === "color") deps.push(fill.color);
	// Cut-transition bindings read the neighbouring clip and its media.
	const inTransition =
		track.type === "video" &&
		(track.transitions ?? []).some(
			(edge) =>
				edge.fromElementId === element.id || edge.toElementId === element.id,
		);
	if (inTransition) {
		deps.push(track.elements, track.transitions, mediaAssets);
	}
	return deps;
}

/** Sync timeline fields onto an already-built node (slider scrub / live preview). */
export function patchElementNodes({
	nodes,
	element,
	canvasSize,
}: {
	nodes: AnyBaseNode[];
	element: TimelineElement;
	canvasSize: TCanvasSize;
}): void {
	for (const node of nodes) {
		if (
			(node instanceof VideoNode || node instanceof ImageNode) &&
			(element.type === "video" || element.type === "image")
		) {
			const p = node.params;
			p.elementId = element.id;
			p.duration = element.duration;
			p.timeOffset = element.startTime;
			p.trimStart = element.trimStart;
			p.trimEnd = element.trimEnd;
			if (element.type === "video") {
				p.retime = element.retime;
				p.reversed = element.reversed === true;
			}
			p.transform = buildTransformFromParams({ params: element.params });
			p.animations = element.animations;
			p.opacity = readOpacityFromParams({ params: element.params });
			p.blendMode = readBlendModeFromParams({ params: element.params });
			p.effects = element.effects ?? [];
			p.masks = element.masks ?? [];
			p.mediaAnims = element.mediaAnims;
			p.chromaKey = buildChromaKeyParam({ element }).chromaKey;
			p.colorGrade = buildColorGradeParam({ element }).colorGrade;
			p.colorCorrection = buildColorCorrectionParam({ element }).colorCorrection;
			continue;
		}
		if (node instanceof BlurBackgroundNode && (element.type === "video" || element.type === "image")) {
			const fill = readBackgroundFillFromParams({ params: element.params });
			node.params.duration = element.duration;
			node.params.timeOffset = element.startTime;
			node.params.trimStart = element.trimStart;
			node.params.trimEnd = element.trimEnd;
			if (element.type === "video") {
				node.params.retime = element.retime;
				node.params.reversed = element.reversed === true;
			}
			if (fill.mode === "blur") {
				node.params.blurIntensity = fill.blurIntensity;
			}
			continue;
		}
		if (node instanceof CoverFillNode && (element.type === "video" || element.type === "image")) {
			node.params.duration = element.duration;
			node.params.timeOffset = element.startTime;
			continue;
		}
		if (node instanceof ColorNode && (element.type === "video" || element.type === "image")) {
			const fill = readBackgroundFillFromParams({ params: element.params });
			node.params.duration = element.duration;
			node.params.timeOffset = element.startTime;
			if (fill.mode === "color") {
				node.params.color = fill.color;
			}
			continue;
		}
		if (node instanceof EffectLayerNode && element.type === "effect") {
			node.params.elementId = element.id;
			node.params.effectType = element.effectType;
			node.params.effectParams = element.params;
			node.params.timeOffset = element.startTime;
			node.params.duration = element.duration;
			node.params.animations = element.animations;
			node.params.stickerAnims = element.stickerAnims;
			continue;
		}
		if (node instanceof StickerNode && element.type === "sticker") {
			const p = node.params;
			p.elementId = element.id;
			p.stickerId = element.stickerId;
			p.stickerAnims = element.stickerAnims;
			p.intrinsicWidth = element.intrinsicWidth;
			p.intrinsicHeight = element.intrinsicHeight;
			p.duration = element.duration;
			p.timeOffset = element.startTime;
			p.trimStart = element.trimStart;
			p.trimEnd = element.trimEnd;
			p.transform = buildTransformFromParams({ params: element.params });
			p.animations = element.animations;
			p.opacity = readOpacityFromParams({ params: element.params });
			p.blendMode = readBlendModeFromParams({ params: element.params });
			p.effects = element.effects ?? [];
			continue;
		}
		if (node instanceof GraphicNode && element.type === "graphic") {
			const p = node.params;
			p.elementId = element.id;
			p.definitionId = element.definitionId;
			p.params = element.params;
			p.duration = element.duration;
			p.timeOffset = element.startTime;
			p.trimStart = element.trimStart;
			p.trimEnd = element.trimEnd;
			p.transform = buildTransformFromParams({ params: element.params });
			p.animations = element.animations;
			p.opacity = readOpacityFromParams({ params: element.params });
			p.blendMode = readBlendModeFromParams({ params: element.params });
			p.effects = element.effects ?? [];
			p.masks = element.masks ?? [];
			continue;
		}
		if (node instanceof TextNode && element.type === "text") {
			Object.assign(node.params, element, {
				transform: buildTransformFromParams({ params: element.params }),
				opacity: readOpacityFromParams({ params: element.params }),
				blendMode: readBlendModeFromParams({ params: element.params }),
				canvasCenter: {
					x: canvasSize.width / 2,
					y: canvasSize.height / 2,
				},
				canvasHeight: canvasSize.height,
				textBaseline: node.params.textBaseline ?? "middle",
				effects: element.effects ?? [],
			});
		}
	}
}

function buildTrackNodes({
	tracks,
	mediaMap,
	mediaAssets,
	canvasSize,
	isPreview,
	cache,
}: {
	tracks: TimelineTrack[];
	mediaMap: Map<string, MediaAsset>;
	mediaAssets: MediaAsset[];
	canvasSize: TCanvasSize;
	isPreview?: boolean;
	cache?: SceneNodeCache;
}): AnyBaseNode[] {
	const nodes: AnyBaseNode[] = [];
	const seenIds = new Set<string>();

	for (const track of tracks) {
		const elements = getVisibleSortedElements({ track });

		for (const element of elements) {
			if (!cache) {
				nodes.push(
					...buildElementNodes({ track, element, mediaMap, canvasSize, isPreview }),
				);
				continue;
			}
			seenIds.add(element.id);
			const deps = getElementNodeDeps({
				track,
				element,
				mediaMap,
				mediaAssets,
				canvasSize,
				isPreview,
			});
			let entry = cache.elements.get(element.id);
			if (!entry || !sameDeps(entry.deps, deps)) {
				entry = {
					deps,
					nodes: buildElementNodes({
						track,
						element,
						mediaMap,
						canvasSize,
						isPreview,
					}),
					element,
				};
				cache.elements.set(element.id, entry);
			} else if (entry.element !== element) {
				// New element object, same structure — Basic/HSL scrub, opacity, …
				patchElementNodes({ nodes: entry.nodes, element, canvasSize });
				entry.element = element;
				cache.paramsPatched = true;
			}
			nodes.push(...entry.nodes);
		}
	}

	if (cache) {
		for (const id of [...cache.elements.keys()]) {
			if (!seenIds.has(id)) cache.elements.delete(id);
		}
	}

	return nodes;
}

function buildElementNodes({
	track,
	element,
	mediaMap,
	canvasSize,
	isPreview,
}: {
	track: TimelineTrack;
	element: TimelineElement;
	mediaMap: Map<string, MediaAsset>;
	canvasSize: TCanvasSize;
	isPreview?: boolean;
}): AnyBaseNode[] {
	const nodes: AnyBaseNode[] = [];

			if (element.type === "effect") {
				nodes.push(
					new EffectLayerNode({
						elementId: element.id,
						effectType: element.effectType,
						effectParams: element.params,
						timeOffset: element.startTime,
						duration: element.duration,
						animations: element.animations,
						stickerAnims: element.stickerAnims,
					}),
				);
				return nodes;
			}

			if (element.type === "video" || element.type === "image") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset?.file || !mediaAsset?.url) {
					return nodes;
				}

				const cutTransitions = buildCutTransitionBindings({
					track,
					element,
					mediaMap,
					imageMaxSourceSize: isPreview ? PREVIEW_MAX_IMAGE_SIZE : undefined,
				});

						if (element.type === "video" && mediaAsset.type === "video") {
						const fillNodes = buildMediaBackgroundFillNodes({
							element,
							mediaAsset,
							cutTransitions,
						});
						nodes.push(...fillNodes);
						nodes.push(
							new VideoNode({
								elementId: element.id,
								mediaId: mediaAsset.id,
								url: mediaAsset.url,
								file: mediaAsset.file,
								duration: element.duration,
								timeOffset: element.startTime,
								trimStart: element.trimStart,
								trimEnd: element.trimEnd,
								retime: element.retime,
								reversed: element.reversed === true,
								transform: buildTransformFromParams({ params: element.params }),
								animations: element.animations,
								opacity: readOpacityFromParams({ params: element.params }),
								blendMode: readBlendModeFromParams({ params: element.params }),
								effects: element.effects ?? [],
								masks: element.masks ?? [],
								mediaAnims: element.mediaAnims,
								...buildChromaKeyParam({ element }),
								...buildColorGradeParam({ element }),
								...buildColorCorrectionParam({ element }),
								...(cutTransitions.length > 0 ? { cutTransitions } : {}),
							}),
						);
					}
					if (element.type === "image" && mediaAsset.type === "image") {
						const fillNodes = buildMediaBackgroundFillNodes({
							element,
							mediaAsset,
							cutTransitions,
						});
						nodes.push(...fillNodes);
						nodes.push(
							new ImageNode({
								elementId: element.id,
								url: mediaAsset.url,
								duration: element.duration,
								timeOffset: element.startTime,
								trimStart: element.trimStart,
								trimEnd: element.trimEnd,
								transform: buildTransformFromParams({ params: element.params }),
								animations: element.animations,
								opacity: readOpacityFromParams({ params: element.params }),
								blendMode: readBlendModeFromParams({ params: element.params }),
								effects: element.effects ?? [],
								masks: element.masks ?? [],
								mediaAnims: element.mediaAnims,
								...buildChromaKeyParam({ element }),
								...buildColorGradeParam({ element }),
								...buildColorCorrectionParam({ element }),
								...(cutTransitions.length > 0 ? { cutTransitions } : {}),
								...(isPreview && {
									maxSourceSize: PREVIEW_MAX_IMAGE_SIZE,
								}),
							}),
						);
					}
			}

			if (element.type === "text") {
				nodes.push(
					new TextNode({
						...element,
						transform: buildTransformFromParams({ params: element.params }),
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						canvasCenter: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
						canvasHeight: canvasSize.height,
						textBaseline: "middle",
						effects: element.effects ?? [],
					}),
				);
			}

			if (element.type === "sticker") {
				nodes.push(
					new StickerNode({
						elementId: element.id,
						stickerId: element.stickerId,
						stickerAnims: element.stickerAnims,
						intrinsicWidth: element.intrinsicWidth,
						intrinsicHeight: element.intrinsicHeight,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						effects: element.effects ?? [],
					}),
				);
			}

			if (element.type === "graphic") {
				nodes.push(
					new GraphicNode({
						elementId: element.id,
						definitionId: element.definitionId,
						params: element.params,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						effects: element.effects ?? [],
						masks: element.masks ?? [],
					}),
				);
			}

	return nodes;
}

	function buildMediaBackgroundFillNodes({
		element,
		mediaAsset,
		cutTransitions = [],
	}: {
		element: {
			type: "image" | "video";
			params: import("@/params").ParamValues;
			duration: number;
			startTime: number;
			trimStart: number;
			trimEnd: number;
			retime?: import("@/timeline").RetimeConfig;
			reversed?: boolean;
		};
		mediaAsset: MediaAsset;
		cutTransitions?: import("./cut-transition").CutTransitionBinding[];
	}): AnyBaseNode[] {
		const fill = readBackgroundFillFromParams({ params: element.params });
		if (!isBackgroundFillActive({ fill })) {
			return [];
		}
		const transitionOpts =
			cutTransitions.length > 0 ? { cutTransitions } : {};

		if (fill.mode === "blur") {
			if (
				!mediaAsset.file ||
				!mediaAsset.url ||
				(mediaAsset.type !== "image" && mediaAsset.type !== "video")
			) {
				return [];
			}
			return [
				new BlurBackgroundNode({
					mediaId: mediaAsset.id,
					url: mediaAsset.url,
					file: mediaAsset.file,
					mediaType: mediaAsset.type,
					duration: element.duration,
					timeOffset: element.startTime,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					retime: element.type === "video" ? element.retime : undefined,
					reversed:
						element.type === "video" ? element.reversed === true : undefined,
					blurIntensity: fill.blurIntensity,
					...transitionOpts,
				}),
			];
		}

		if (fill.mode === "color") {
			return [
				new ColorNode({
					color: fill.color,
					timeOffset: element.startTime,
					duration: element.duration,
					...transitionOpts,
				}),
			];
		}

		if (fill.mode === "style") {
			const url = resolveBackgroundFillStyleUrl({ styleId: fill.styleId });
			if (!url) {
				return [];
			}
			const animated = /\.gif($|\?)/i.test(url);
			return [
				new CoverFillNode({
					url,
					duration: element.duration,
					timeOffset: element.startTime,
					animated,
					...transitionOpts,
				}),
			];
		}

		return [];
	}

	export type BuildSceneParams = {
		canvasSize: TCanvasSize;
		tracks: SceneTracks;
		mediaAssets: MediaAsset[];
		duration: number;
		background: TBackground;
		isPreview?: boolean;
		/** Reuse nodes (and the whole tree when nothing changed) across calls. */
		cache?: SceneNodeCache;
	};

	/** Project canvas blur was removed — legacy blur settings fall back to solid color. */
	function resolveProjectBackgroundColor({
		background,
	}: {
		background: TBackground;
	}): string | null {
		if (background.type === "color") {
			return background.color === "transparent" ? null : background.color;
		}
		return DEFAULT_BACKGROUND_COLOR;
	}

	export function buildScene({
		canvasSize,
		tracks,
		mediaAssets,
		duration,
		background,
		isPreview,
		cache,
	}: BuildSceneParams): RootNode {
		if (cache) cache.paramsPatched = false;
		const mediaMap = new Map(mediaAssets.map((m) => [m.id, m]));

		const visibleTracks = [
			...tracks.overlay.filter((track) => !("hidden" in track && track.hidden)),
			...(!tracks.main.hidden ? [tracks.main] : []),
		];
		const orderedTracksBottomToTop = visibleTracks.slice().reverse();

		const allNodes = buildTrackNodes({
			tracks: orderedTracksBottomToTop,
			mediaMap,
			mediaAssets,
			canvasSize,
			isPreview,
			cache,
		});

		const children: AnyBaseNode[] = [];
		const projectColor = resolveProjectBackgroundColor({ background });
		if (projectColor) {
			let colorNode = cache?.projectColor;
			if (!colorNode || colorNode.params.color !== projectColor) {
				colorNode = new ColorNode({ color: projectColor });
				if (cache) cache.projectColor = colorNode;
			}
			children.push(colorNode);
		}
		children.push(...allNodes);

		const last = cache?.lastRoot;
		// Params-only scrub patches nodes in place but must still publish a new
		// root — same child refs would otherwise reuse lastRoot and skip compose.
		if (
			last &&
			!cache?.paramsPatched &&
			last.params.duration === duration &&
			sameDeps(last.children, children)
		) {
			return last;
		}

		const rootNode = new RootNode({ duration });
		for (const node of children) {
			rootNode.add(node);
		}
		if (cache) cache.lastRoot = rootNode;
		return rootNode;
	}
