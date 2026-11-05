import { mediaTimeToSeconds, roundMediaTime } from "@/wasm";
import { isRenderPerfEnabled, recordSpan } from "@/diagnostics/render-perf";
import { builtPackTimelineDurationSec } from "./compositor/three-compositor";
import {
	authorPackTimelineDurationSec,
	isInsideCutTransitionWindow,
	pickOwnedCutTransition,
	sampleCutTransitionComposite,
} from "./cut-transition";
import { getElementLocalTime } from "@/animation";
import { resolveAnimationPathValueAtTime } from "@/animation/resolve";
import { resolveEffectParamsAtTime } from "@/animation/effect-param-channel";
	import {
		effectsRegistry,
		resolveEffectPasses,
		buildVfxPackEffectPasses,
	} from "@/effects";
import { isVfxPackEffectType } from "@/vfxpack/effect-id";
import type { Effect, EffectPass } from "@/effects/types";
import { getMappedSourceTime } from "@/retime";
import {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	resolveGraphicElementParamsAtTime,
} from "@/graphics";
import {
	buildTextBackgroundFromElement,
	getTextMeasurementContext,
	measureTextElement,
} from "@/text/measure-element";
import { resolveColorAtTime, resolveOpacityAtTime } from "@/animation/values";
import { resolveChromaKeyAtTime } from "@/chroma-key";
import {
	isColorGradeIdentity,
	resolveColorGradeAtTime,
} from "@/color-grade";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import { videoCache } from "@/services/video-cache/service";
import type { CanvasRenderer } from "./canvas-renderer";
import type { AnyBaseNode } from "./nodes/base-node";
import {
	BlurBackgroundNode,
	type BackdropSource,
	type ResolvedBlurBackgroundNodeState,
} from "./nodes/blur-background-node";
import {
	ColorNode,
	type ResolvedColorNodeState,
} from "./nodes/color-node";
import {
	CoverFillNode,
	type ResolvedCoverFillNodeState,
} from "./nodes/cover-fill-node";
import {
	EffectLayerNode,
	type ResolvedEffectLayerNodeState,
} from "./nodes/effect-layer-node";
import {
	GraphicNode,
	type ResolvedGraphicNodeState,
} from "./nodes/graphic-node";
import { ImageNode, loadImageSource } from "./nodes/image-node";
import { StickerNode, loadStickerSource } from "./nodes/sticker-node";
import { TextNode, type ResolvedTextNodeState } from "./nodes/text-node";
import { VideoNode } from "./nodes/video-node";
import type {
	ResolvedVisualNodeState,
	ResolvedVisualSourceNodeState,
	VisualNodeParams,
} from "./nodes/visual-node";

type ResolveContext = {
	renderer: CanvasRenderer;
	time: number;
};

export async function resolveRenderTree({
	node,
	renderer,
	time,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
	time: number;
}): Promise<void> {
	await resolveNode({
		node,
		context: {
			renderer,
			time,
		},
	});
}

/** Per-node-type timing wrapper; no-op when `__renderPerf` is off. */
async function span<T>({
	name,
	fn,
}: {
	name: string;
	fn: () => T | Promise<T>;
}): Promise<T> {
	if (!isRenderPerfEnabled()) return fn();
	const start = performance.now();
	try {
		return await fn();
	} finally {
		recordSpan({ name, durationMs: performance.now() - start });
	}
}

async function resolveNode({
	node,
	context,
}: {
	node: AnyBaseNode;
	context: ResolveContext;
}): Promise<void> {
	/**
	 * `resolve` is reported as one span, and it is bimodal: p50 ~0.4ms but
	 * p95 >100ms. A single total cannot say which node type owns the tail, and
	 * a decode wait, a sticker fetch and a text measurement all look identical
	 * from outside. Split by node type so the tail is attributable.
	 */
	if (node instanceof VideoNode) {
		node.resolved = await span({
			name: "resolve:video",
			fn: () => resolveVideoNode({ node, context }),
		});
	} else if (node instanceof ImageNode) {
		node.resolved = await span({
			name: "resolve:image",
			fn: () => resolveImageNode({ node, context }),
		});
	} else if (node instanceof StickerNode) {
		node.resolved = await span({
			name: "resolve:sticker",
			fn: () => resolveStickerNode({ node, context }),
		});
	} else if (node instanceof GraphicNode) {
		node.resolved = resolveGraphicNode({ node, context });
	} else if (node instanceof TextNode) {
		node.resolved = await span({
			name: "resolve:text",
			fn: () => resolveTextNode({ node, context }),
		});
	} else if (node instanceof BlurBackgroundNode) {
		node.resolved = await span({
			name: "resolve:blur",
			fn: () => resolveBlurBackgroundNode({ node, context }),
		});
	} else if (node instanceof CoverFillNode) {
		node.resolved = await span({
			name: "resolve:cover-fill",
			fn: () => resolveCoverFillNode({ node, context }),
		});
	} else if (node instanceof ColorNode) {
		node.resolved = resolveColorNode({ node, context });
	} else if (node instanceof EffectLayerNode) {
		node.resolved = resolveEffectLayerNode({ node, context });
	}

	await Promise.all(
		node.children.map((child) => resolveNode({ node: child, context })),
	);
}

function resolveEffectPassGroups({
	effects,
	animations,
	localTime,
	width,
	height,
}: {
	effects: Effect[] | undefined;
	animations: VisualNodeParams["animations"];
	localTime: number;
	width: number;
	height: number;
}): EffectPass[][] {
	return (effects ?? [])
		.filter((effect) => effect.enabled)
		.map((effect) => {
			const resolvedParams = resolveEffectParamsAtTime({
				effectId: effect.id,
				params: effect.params,
				animations,
				localTime,
			});
			const definition = effectsRegistry.get(effect.type);
			return resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width,
				height,
			});
		});
}

function resolveVisualState({
	params,
	context,
	sourceWidth,
	sourceHeight,
}: {
	params: VisualNodeParams;
	context: ResolveContext;
	sourceWidth: number;
	sourceHeight: number;
}): ResolvedVisualNodeState | null {
	const clipTime = context.time - params.timeOffset;
	if (clipTime < 0 || clipTime >= params.duration) {
		return null;
	}

	const localTime = getElementLocalTime({
		timelineTime: context.time,
		elementStartTime: params.timeOffset,
		elementDuration: params.duration,
	});
	const transform = resolveTransformAtTime({
		baseTransform: params.transform,
		animations: params.animations,
		localTime,
	});
	const opacity = resolveOpacityAtTime({
		baseOpacity: params.opacity,
		animations: params.animations,
		localTime,
	});
	const containScale = Math.min(
		context.renderer.width / sourceWidth,
		context.renderer.height / sourceHeight,
	);
	const effectWidth = Math.round(
		Math.abs(sourceWidth * containScale * transform.scaleX),
	);
	const effectHeight = Math.round(
		Math.abs(sourceHeight * containScale * transform.scaleY),
	);

		const colorGrade = params.colorGrade
			? resolveColorGradeAtTime({
					base: params.colorGrade,
					animations: params.animations,
					localTime,
				})
			: null;

		return {
			localTime,
			transform,
			opacity,
			effectPasses: resolveEffectPassGroups({
				effects: params.effects,
				animations: params.animations,
				localTime,
				width: effectWidth,
				height: effectHeight,
			}),
			/**
			 * Sampled here rather than in the frame descriptor: `localTime` is the
			 * only place the clip-local clock exists, and the four sliders are
			 * keyframable. Returns `null` for un-keyed clips so the compositor can
			 * skip the branch entirely.
			 */
			chromaKey: params.chromaKey
				? resolveChromaKeyAtTime({
						base: params.chromaKey,
						animations: params.animations,
						localTime,
					})
				: null,
			/** Null when grade is identity so the material patch stays off. */
			colorGrade:
				colorGrade && !isColorGradeIdentity({ grade: colorGrade })
					? colorGrade
					: null,
		};
	}

async function resolveOwnedCutTransition({
	node,
	context,
}: {
	node: VideoNode | ImageNode;
	context: ResolveContext;
}): Promise<
	| { handled: false }
	| { handled: true; state: ResolvedVisualSourceNodeState | null }
> {
	const timelineTime = roundMediaTime({ time: context.time });
	const owned = pickOwnedCutTransition({
		bindings: node.params.cutTransitions,
		time: timelineTime,
	});
	if (!owned) return { handled: false };

	const builtT = builtPackTimelineDurationSec(owned.packId);
	const packTimelineDurationSec =
		builtT ?? authorPackTimelineDurationSec({ packId: owned.packId });
	const cutTransition = await sampleCutTransitionComposite({
		binding: owned,
		timelineTime,
		packTimelineDurationSec,
	});
	if (!cutTransition) return { handled: true, state: null };

	const self = owned.role === "from" ? cutTransition.from : cutTransition.to;
	const visual = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: self.sourceWidth,
		sourceHeight: self.sourceHeight,
		}) ?? {
			localTime: 0,
			transform: node.params.transform,
			opacity: node.params.opacity,
			effectPasses: [],
			chromaKey: null,
			colorGrade: null,
		};

	return {
		handled: true,
		state: {
			...visual,
			source: self.source,
			sourceWidth: self.sourceWidth,
			sourceHeight: self.sourceHeight,
			cutTransition,
		},
	};
}

async function resolveVideoNode({
	node,
	context,
}: {
	node: VideoNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const cutTransition = await resolveOwnedCutTransition({ node, context });
	if (cutTransition.handled) return cutTransition.state;

	const clipTime = context.time - node.params.timeOffset;
	if (clipTime < 0 || clipTime >= node.params.duration) {
		return null;
	}

	const sourceTimeTicks = getMappedSourceTime({
		clipTime,
		clipDuration: node.params.duration,
		trimStart: node.params.trimStart,
		retime: node.params.retime,
		reversed: node.params.reversed === true,
	});
	const frame = await videoCache.getFrameAt({
		mediaId: node.params.mediaId,
		file: node.params.file,
		time: mediaTimeToSeconds({ time: roundMediaTime({ time: sourceTimeTicks }) }),
	});
	if (!frame) {
		return null;
	}

	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: frame.canvas.width,
		sourceHeight: frame.canvas.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: frame.canvas,
		sourceWidth: frame.canvas.width,
		sourceHeight: frame.canvas.height,
	};
}

async function resolveImageNode({
	node,
	context,
}: {
	node: ImageNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const cutTransition = await resolveOwnedCutTransition({ node, context });
	if (cutTransition.handled) return cutTransition.state;

	const source = await loadImageSource({
		url: node.params.url,
		maxSourceSize: node.params.maxSourceSize,
	});
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: source.width,
		sourceHeight: source.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: source.source,
		sourceWidth: source.width,
		sourceHeight: source.height,
	};
}

async function resolveStickerNode({
	node,
	context,
}: {
	node: StickerNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const source = await loadStickerSource({ stickerId: node.params.stickerId });
	const sourceWidth = node.params.intrinsicWidth ?? source.width;
	const sourceHeight = node.params.intrinsicHeight ?? source.height;
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth,
		sourceHeight,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: source.source,
		sourceWidth,
		sourceHeight,
	};
}

function resolveGraphicNode({
	node,
	context,
}: {
	node: GraphicNode;
	context: ResolveContext;
}): ResolvedGraphicNodeState | null {
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: DEFAULT_GRAPHIC_SOURCE_SIZE,
		sourceHeight: DEFAULT_GRAPHIC_SOURCE_SIZE,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		resolvedParams: resolveGraphicElementParamsAtTime({
			element: node.params,
			localTime: visualState.localTime,
		}),
	};
}

function resolveTextNode({
	node,
	context,
}: {
	node: TextNode;
	context: ResolveContext;
}): ResolvedTextNodeState | null {
	if (
		context.time < node.params.startTime ||
		context.time >= node.params.startTime + node.params.duration
	) {
		return null;
	}

	const localTime = getElementLocalTime({
		timelineTime: context.time,
		elementStartTime: node.params.startTime,
		elementDuration: node.params.duration,
	});
	const background = buildTextBackgroundFromElement({ element: node.params });

	return {
		localTime,
		transform: resolveTransformAtTime({
			baseTransform: node.params.transform,
			animations: node.params.animations,
			localTime,
		}),
		opacity: resolveOpacityAtTime({
			baseOpacity: node.params.opacity,
			animations: node.params.animations,
			localTime,
		}),
		textColor: resolveColorAtTime({
			baseColor:
				typeof node.params.params.color === "string"
					? node.params.params.color
					: "#ffffff",
			animations: node.params.animations,
			propertyPath: "color",
			localTime,
		}),
		backgroundColor: resolveColorAtTime({
			baseColor: background.color,
			animations: node.params.animations,
			propertyPath: "background.color",
			localTime,
		}),
			effectPasses: resolveEffectPassGroups({
				effects: node.params.effects,
				animations: node.params.animations,
				localTime,
				width: context.renderer.width,
				height: context.renderer.height,
			}),
			measuredText: measureTextElement({
				element: node.params,
				canvasHeight: node.params.canvasHeight,
				localTime,
				ctx: getTextMeasurementContext(),
			}),
		};
	}

	async function resolveBlurBackgroundNode({
		node,
		context,
	}: {
		node: BlurBackgroundNode;
		context: ResolveContext;
	}): Promise<ResolvedBlurBackgroundNodeState | null> {
		const clipTime = context.time - node.params.timeOffset;
		if (clipTime < 0 || clipTime >= node.params.duration) {
			return null;
		}
		// Fill is already composited into uFrom/uTo for the cut window.
		if (
			isInsideCutTransitionWindow({
				bindings: node.params.cutTransitions,
				time: roundMediaTime({ time: context.time }),
			})
		) {
			return null;
		}

		const backdropSource = await resolveBackdropSource({ node, clipTime });
		if (!backdropSource) {
			return null;
		}

		// Blur is baked at 1/4 res in frame-descriptor (not via effectPassGroups).
		return { backdropSource };
	}

function resolveColorNode({
	node,
	context,
}: {
	node: ColorNode;
	context: ResolveContext;
}): ResolvedColorNodeState | null {
	const { timeOffset, duration } = node.params;
	if (typeof duration === "number") {
		const clipTime = context.time - (timeOffset ?? 0);
		if (clipTime < 0 || clipTime >= duration) {
			return null;
		}
	}
	if (
		isInsideCutTransitionWindow({
			bindings: node.params.cutTransitions,
			time: roundMediaTime({ time: context.time }),
		})
	) {
		return null;
	}
	return { active: true };
}

async function resolveCoverFillNode({
	node,
	context,
}: {
	node: CoverFillNode;
	context: ResolveContext;
}): Promise<ResolvedCoverFillNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (clipTime < 0 || clipTime >= node.params.duration) {
		return null;
	}
	if (
		isInsideCutTransitionWindow({
			bindings: node.params.cutTransitions,
			time: roundMediaTime({ time: context.time }),
		})
	) {
		return null;
	}

	const source = await loadImageSource({ url: node.params.url });
	return {
		source: source.source,
		width: source.width,
		height: source.height,
		localTimeSec: mediaTimeToSeconds({
			time: roundMediaTime({ time: clipTime }),
		}),
	};
}

async function resolveBackdropSource({
	node,
	clipTime,
}: {
	node: BlurBackgroundNode;
	clipTime: number;
}): Promise<BackdropSource | null> {
	if (node.params.mediaType === "video") {
		const sourceTimeTicks = getMappedSourceTime({
			clipTime,
			clipDuration: node.params.duration,
			trimStart: node.params.trimStart,
			retime: node.params.retime,
			reversed: node.params.reversed === true,
		});
		const frame = await videoCache.getFrameAt({
			mediaId: node.params.mediaId,
			file: node.params.file,
			time: mediaTimeToSeconds({ time: roundMediaTime({ time: sourceTimeTicks }) }),
		});
		if (!frame) {
			return null;
		}

		return {
			source: frame.canvas,
			width: frame.canvas.width,
			height: frame.canvas.height,
		};
	}

	const source = await loadImageSource({ url: node.params.url });
	return {
		source: source.source,
		width: source.width,
		height: source.height,
	};
}

function resolveEffectLayerNode({
	node,
	context,
}: {
	node: EffectLayerNode;
	context: ResolveContext;
}): ResolvedEffectLayerNodeState | null {
	const time = context.time;
	if (
		time < node.params.timeOffset - 1e-6 ||
		time >= node.params.timeOffset + node.params.duration + 1e-6
	) {
		return null;
	}

	// NLE keyframes are stored in MediaTime ticks. Pack .anim clips still sample seconds.
	const localTicks = Math.max(0, time - node.params.timeOffset);
	const clipLocalTime = mediaTimeToSeconds({
		time: roundMediaTime({ time: localTicks }),
	});
	const baseParams = { ...(node.params.effectParams || {}) };
	// Include animation-only paths (e.g. exposed param keyed after first keyframe).
	for (const path of Object.keys(node.params.animations || {})) {
		if (!(path in baseParams)) {
			baseParams[path] = 0;
		}
	}
		const resolvedParams: Record<string, number | string | boolean | number[]> =
			{};
		for (const [key, staticValue] of Object.entries(baseParams)) {
			resolvedParams[key] = resolveAnimationPathValueAtTime({
				animations: node.params.animations,
				propertyPath: key,
				localTime: localTicks,
				fallbackValue: staticValue,
			}) as number | string | boolean | number[];
		}
	// Keep resolved params on the node so frame-descriptor / compositor see live values.
	node.params.effectParams = resolvedParams;

	if (isVfxPackEffectType({ effectType: node.params.effectType })) {
		return { passes: buildVfxPackEffectPasses(), localTime: clipLocalTime };
	}

	const definition = effectsRegistry.get(node.params.effectType);
	const passes = resolveEffectPasses({
		definition,
		effectParams: resolvedParams,
		width: context.renderer.width,
		height: context.renderer.height,
	});
	if (passes.length === 0) {
		return null;
	}

	return {
		passes,
		localTime: clipLocalTime,
	};
}
