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

type CachedElementNodes = {
	deps: readonly unknown[];
	nodes: AnyBaseNode[];
};

/**
 * Reuses scene nodes across preview rebuilds. Elements are immutable (every
 * edit installs a new object), so an element whose object and inputs are
 * unchanged maps to the same nodes, and an unchanged scene to the same tree.
 */
export type SceneNodeCache = {
	elements: WeakMap<TimelineElement, CachedElementNodes>;
	projectColor: ColorNode | null;
	lastRoot: RootNode | null;
};

export function createSceneNodeCache(): SceneNodeCache {
	return { elements: new WeakMap(), projectColor: null, lastRoot: null };
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!Object.is(a[i], b[i])) return false;
	}
	return true;
}

/** Everything `buildElementNodes` reads besides the element itself. */
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
	const deps: unknown[] = [canvasSize.width, canvasSize.height, isPreview];
	if (element.type !== "video" && element.type !== "image") return deps;

	deps.push(mediaMap.get(element.mediaId));
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

	for (const track of tracks) {
		const elements = getVisibleSortedElements({ track });

		for (const element of elements) {
			if (!cache) {
				nodes.push(
					...buildElementNodes({ track, element, mediaMap, canvasSize, isPreview }),
				);
				continue;
			}
			const deps = getElementNodeDeps({
				track,
				element,
				mediaMap,
				mediaAssets,
				canvasSize,
				isPreview,
			});
			let entry = cache.elements.get(element);
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
				};
				cache.elements.set(element, entry);
			}
			nodes.push(...entry.nodes);
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
								mediaId: mediaAsset.id,
								url: mediaAsset.url,
								file: mediaAsset.file,
								duration: element.duration,
								timeOffset: element.startTime,
								trimStart: element.trimStart,
								trimEnd: element.trimEnd,
								retime: element.retime,
								transform: buildTransformFromParams({ params: element.params }),
								animations: element.animations,
								opacity: readOpacityFromParams({ params: element.params }),
								blendMode: readBlendModeFromParams({ params: element.params }),
								effects: element.effects ?? [],
								masks: element.masks ?? [],
								mediaAnims: element.mediaAnims,
								...buildChromaKeyParam({ element }),
								...buildColorGradeParam({ element }),
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
		if (
			last &&
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
