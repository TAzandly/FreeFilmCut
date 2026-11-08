import { isBackgroundFillActive } from "@/background/fill";
import {
	drawBlurredCoverBackdrop,
	drawCoverScaled,
	toCssPaintColor,
} from "@/background/paint-fill";
import { drawCssBackground } from "@/gradients";
import { getMaskDefinition } from "@/masks";
import { incrementCounter } from "@/diagnostics/render-perf";
import type { AnyBaseNode } from "../nodes/base-node";
import type { CanvasRenderer } from "../canvas-renderer";
import { createCanvasSurface } from "../canvas-utils";
import { applyMaskFeather } from "../mask-feather";
import { BlurBackgroundNode } from "../nodes/blur-background-node";
import { ColorNode } from "../nodes/color-node";
import { CoverFillNode } from "../nodes/cover-fill-node";
import { EffectLayerNode } from "../nodes/effect-layer-node";
import {
	GraphicNode,
	type ResolvedGraphicNodeState,
} from "../nodes/graphic-node";
import { ImageNode } from "../nodes/image-node";
import { RootNode } from "../nodes/root-node";
import { StickerNode } from "../nodes/sticker-node";
import { TextNode } from "../nodes/text-node";
import {
	contentHashForFlowerText,
	resolveTimelineFlowerTextProps,
} from "@/vfxpack/timeline-flower-text";
import { VideoNode } from "../nodes/video-node";
import type {
	CutTransitionSide,
	ResolvedVisualSourceNodeState,
} from "../nodes/visual-node";
import { mediaTime, mediaTimeToSeconds } from "@/wasm";
import { resolveAppliedStickerPose } from "@/vfxpack/sticker-motion";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import type {
	FrameDescriptor,
	FrameItemDescriptor,
	LayerMaskDescriptor,
	QuadTransformDescriptor,
	TextureCanvasDrawFn,
	TextureUploadDescriptor,
	TransitionSideDescriptor,
} from "./types";
import { DEFAULT_GRAPHIC_SOURCE_SIZE } from "@/graphics";

export async function buildFrameDescriptor({
	node,
	renderer,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
}): Promise<{
	frame: FrameDescriptor;
	textures: TextureUploadDescriptor[];
}> {
	const items: FrameItemDescriptor[] = [];
	const textures = new Map<string, TextureUploadDescriptor>();

	await collectNode({
		node,
		renderer,
		path: "root",
		items,
		textures,
	});

	incrementCounter({ name: "frameItems", by: items.length });
	incrementCounter({ name: "frameTextures", by: textures.size });
	// Breakdown by kind. "3 items" on its own cannot distinguish three plain
	// layers from one video layer + one pack effect chain + one text RT, and
	// those cost wildly different amounts per frame — the per-item count is
	// only useful once you know which kinds the items are.
	for (const item of items) {
		incrementCounter({ name: `frameItems.${item.type}` });
	}

	return {
		frame: {
			width: renderer.width,
			height: renderer.height,
			logicalWidth: renderer.logicalWidth || renderer.width,
			logicalHeight: renderer.logicalHeight || renderer.height,
			contentScale: renderer.contentScale || 1,
			clear: {
				color: [0, 0, 0, 1],
			},
			items,
		},
		textures: [...textures.values()],
	};
}

async function collectNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}): Promise<void> {
	if (node instanceof RootNode) {
		for (let index = 0; index < node.children.length; index++) {
			await collectNode({
				node: node.children[index],
				renderer,
				path: `${path}:${index}`,
				items,
				textures,
			});
		}
		return;
	}

	if (node instanceof ColorNode) {
		// Project-wide color bg has no duration; clip fill requires resolve window.
		if (typeof node.params.duration === "number" && !node.resolved) {
			return;
		}
		const textureId = `${path}:color`;
		const { width, height } = renderer;
		const cssColor = toCssPaintColor(node.params.color);
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash: `color:${cssColor}:${width}x${height}`,
			width,
			height,
			draw: (ctx) => {
				if (/gradient\(/i.test(cssColor)) {
					drawCssBackground({ ctx, width, height, css: cssColor });
				} else {
					ctx.fillStyle = cssColor;
					ctx.fillRect(0, 0, width, height);
				}
			},
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [],
			mask: null,
		});
		return;
	}

	if (node instanceof CoverFillNode) {
		if (!node.resolved) {
			return;
		}
		const textureId = `${path}:cover-fill`;
		const { width, height } = renderer;
		const { source, width: srcW, height: srcH, localTimeSec } = node.resolved;
		const animatedKey = node.params.animated
			? `:t=${localTimeSec.toFixed(3)}`
			: "";
		const contentHash = `cover:${node.params.url}:${srcW}x${srcH}:${width}x${height}${animatedKey}`;
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash,
			width,
			height,
			draw: (ctx) => {
				const coverScale = Math.max(width / srcW, height / srcH);
				const scaledWidth = srcW * coverScale;
				const scaledHeight = srcH * coverScale;
				const offsetX = (width - scaledWidth) / 2;
				const offsetY = (height - scaledHeight) / 2;
				ctx.drawImage(source, offsetX, offsetY, scaledWidth, scaledHeight);
			},
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [],
			mask: null,
		});
		return;
	}

	if (node instanceof EffectLayerNode) {
		if (!node.resolved || node.resolved.passes.length === 0) {
			return;
		}
		items.push({
			type: "sceneEffect",
			elementId: node.params.elementId,
			effectType: node.params.effectType,
			effectPassGroups: [node.resolved.passes],
			effectParams: node.params.effectParams,
			clipLocalTime: node.resolved.localTime ?? 0,
			clipDurationSec: mediaTimeToSeconds({
				time: mediaTime({ ticks: node.params.duration }),
			}),
			stickerAnims: node.params.stickerAnims,
		});
		return;
	}

	if (node instanceof BlurBackgroundNode) {
		if (!node.resolved) {
			return;
		}
		const textureId = `${path}:blur-background`;
		const { width, height } = renderer;
		const { backdropSource } = node.resolved;
		const blurIntensity = node.params.blurIntensity;
		// Three compositor does not apply layer effectPassGroups yet, so blur must
		// be baked into this rendered texture. Intensity belongs in the hash or
		// slider changes would keep showing a stale sharp cover.
		const contentHash = `blur:${identityKey(backdropSource.source)}:${backdropSource.width}x${backdropSource.height}:${width}x${height}:i=${blurIntensity}`;
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash,
			width,
			height,
			draw: (ctx) => {
				drawBlurredCoverBackdrop({
					ctx,
					width,
					height,
					source: backdropSource.source,
					sourceWidth: backdropSource.width,
					sourceHeight: backdropSource.height,
					blurIntensity,
				});
			},
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			// Already baked above; keep empty so a future compositor pass path
			// does not double-blur.
			effectPassGroups: [],
			mask: null,
		});
		return;
	}

	if (
		node instanceof VideoNode ||
		node instanceof ImageNode ||
		node instanceof StickerNode ||
		node instanceof GraphicNode
	) {
		await collectVisualSourceNode({
			node,
			renderer,
			path,
			items,
			textures,
		});
		return;
	}

	if (node instanceof TextNode) {
		collectTextNode({
			node,
			renderer,
			path,
			items,
			textures,
		});
	}
}

async function collectVisualSourceNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: VideoNode | ImageNode | StickerNode | GraphicNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}) {
	if (!node.resolved) {
		return;
	}

	if (
		(node instanceof VideoNode || node instanceof ImageNode) &&
		node.resolved.cutTransition
	) {
		const cut = node.resolved.cutTransition;
		items.push({
			type: "transition",
			packId: cut.packId,
			packTimelineTimeSec: cut.packTimelineTimeSec,
			from: collectTransitionSide({
				side: cut.from,
				renderer,
				path: `${path}:transition-from`,
				textures,
			}),
			to: collectTransitionSide({
				side: cut.to,
				renderer,
				path: `${path}:transition-to`,
				textures,
			}),
		});
		return;
	}

	const source =
		node instanceof GraphicNode
			? node.getSource({ resolvedParams: node.resolved.resolvedParams })
			: node.resolved.source;
	if (!source) {
		return;
	}

	const sourceWidth =
		node instanceof GraphicNode
			? DEFAULT_GRAPHIC_SOURCE_SIZE
			: (node.resolved as ResolvedVisualSourceNodeState).sourceWidth;
	const sourceHeight =
		node instanceof GraphicNode
			? DEFAULT_GRAPHIC_SOURCE_SIZE
			: (node.resolved as ResolvedVisualSourceNodeState).sourceHeight;

	const textureId = `${path}:source`;
	textures.set(textureId, {
		kind: "external",
		id: textureId,
		source,
		width: sourceWidth,
		height: sourceHeight,
		frameKey:
			node instanceof GraphicNode
				? undefined
				: (node.resolved as ResolvedVisualSourceNodeState).sourceFrameKey,
	});

	const transform = computeVisualTransform({
		renderer,
		resolved: node.resolved,
		sourceWidth,
		sourceHeight,
	});
	let opacity = node.resolved.opacity;
	if (node instanceof StickerNode && node.params.stickerAnims) {
		const pose = resolveAppliedStickerPose({
			stickerAnims: node.params.stickerAnims,
			localTimeSec: mediaTimeToSeconds({
				time: mediaTime({ ticks: node.resolved.localTime }),
			}),
			clipDurationSec: mediaTimeToSeconds({
				time: mediaTime({ ticks: node.params.duration }),
			}),
			motionForPack: (packId) => {
				const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
				return pack?.manifest.motion ?? null;
			},
		});
		const placedW = transform.width;
		const placedH = transform.height;
		transform.width *= pose.scale;
		transform.height *= pose.scale;
		transform.rotationDegrees += pose.rotate;
		transform.centerX += pose.positionX * placedW;
		// Canvas camera is Y-down. Animation +Y is up.
		transform.centerY -= pose.positionY * placedH;
		opacity *= pose.opacity;
	}
	const { mask, strokeLayer } = buildMaskArtifacts({
		node,
		renderer,
		path,
		transform,
		textures,
	});

	const clipLocalTime = mediaTimeToSeconds({
		time: mediaTime({ ticks: node.resolved.localTime }),
	});
	const clipDurationSec = mediaTimeToSeconds({
		time: mediaTime({ ticks: node.params.duration }),
	});
	items.push({
		type: "layer",
		textureId,
		transform,
		opacity,
		blendMode: node.params.blendMode ?? "normal",
		effectPassGroups: node.resolved.effectPasses,
		mask,
		// Undefined (not null) for un-keyed layers: the descriptor is rebuilt
		// every frame, so keeping the field absent keeps it out of the shape.
		...(node.resolved.chromaKey ? { chromaKey: node.resolved.chromaKey } : {}),
		...(node.resolved.colorGrade
			? { colorGrade: node.resolved.colorGrade }
			: {}),
		...(node.resolved.colorCorrection
			? { colorCorrection: node.resolved.colorCorrection }
			: {}),
		...((node instanceof ImageNode || node instanceof VideoNode) &&
		node.params.mediaAnims
			? {
					clipLocalTime,
					clipDurationSec,
					mediaAnims: node.params.mediaAnims,
				}
			: {}),
	});
	if (strokeLayer) {
		items.push(strokeLayer);
	}
}

function collectTextNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: TextNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}) {
	if (!node.resolved) {
		return;
	}

	const { width, height } = renderer;
	// Always resolve Troika/FlowerStyle in project (authored) pixels.
	// Preview quality may shrink the compose buffer, but must NOT change
	// fontSize / stroke / shadow / blur amounts — only sampling resolution.
	const authoredW = Math.max(
		1,
		Math.round(renderer.logicalWidth || width / (renderer.contentScale || 1)),
	);
	const authoredH = Math.max(
		1,
		Math.round(renderer.logicalHeight || height / (renderer.contentScale || 1)),
	);
	// All TextNode (plain + flower) → shared Text→RT→blit path (item type "flowerText").
	const renderProps = resolveTimelineFlowerTextProps({
		element: node.params,
		canvasWidth: authoredW,
		canvasHeight: authoredH,
	});
	const contentHash = contentHashForFlowerText(renderProps);
	const elementId =
		typeof (node.params as { id?: string }).id === "string"
			? String((node.params as { id?: string }).id)
			: path;
	const clipDurationSec = mediaTimeToSeconds({
		time: node.params.duration,
	});
	const clipLocalTime = mediaTimeToSeconds({
		time: mediaTime({ ticks: node.resolved.localTime }),
	});
	items.push({
		type: "flowerText",
		elementId,
		contentHash,
		props: renderProps,
		opacity: node.resolved.opacity,
		blendMode: node.params.blendMode ?? "normal",
		effectPassGroups: node.resolved.effectPasses,
		clipLocalTime,
		clipDurationSec,
		textAnims: node.params.textAnims,
	});
	void textures; // textures unused for Troika path
}

/**
 * Same items a normal clip produces (full-bleed fill, then the placed media
 * with grade / clip-anim), for one cut side. The compositor draws them into
 * that side's own target instead of accum.
 */
function collectTransitionSide({
	side,
	renderer,
	path,
	textures,
}: {
	side: CutTransitionSide;
	renderer: CanvasRenderer;
	path: string;
	textures: Map<string, TextureUploadDescriptor>;
}): TransitionSideDescriptor {
	const { width, height } = renderer;
	const layers: TransitionSideDescriptor["layers"] = [];
	const fill = side.backgroundFill;
	const fillActive = isBackgroundFillActive({ fill });
	// Changing pixels (video, GIF) must redraw every frame even when the
	// source object is reused.
	const dynamicKey = side.sourceIsStatic
		? ""
		: `:${side.frameKey}:${side.clipLocalTime}`;

	if (fillActive) {
		let contentHash: string | null = null;
		let draw: TextureCanvasDrawFn | null = null;
		if (fill.mode === "color") {
			const cssColor = toCssPaintColor(fill.color);
			contentHash = `color:${cssColor}:${width}x${height}`;
			draw = (ctx) => {
				if (/gradient\(/i.test(cssColor)) {
					drawCssBackground({ ctx, width, height, css: cssColor });
				} else {
					ctx.fillStyle = cssColor;
					ctx.fillRect(0, 0, width, height);
				}
			};
		} else if (fill.mode === "blur") {
			contentHash = `blur:${identityKey(side.source)}${dynamicKey}:${side.sourceWidth}x${side.sourceHeight}:${width}x${height}:i=${fill.blurIntensity}`;
			draw = (ctx) => {
				drawBlurredCoverBackdrop({
					ctx,
					width,
					height,
					source: side.source,
					sourceWidth: side.sourceWidth,
					sourceHeight: side.sourceHeight,
					blurIntensity: fill.blurIntensity,
					sourceIsStatic: side.sourceIsStatic,
					preferCanvasFilter: !side.sourceIsStatic,
				});
			};
		} else if (fill.mode === "style" && side.styleSource) {
			const style = side.styleSource;
			contentHash = `cover:${identityKey(style.source)}${dynamicKey}:${style.width}x${style.height}:${width}x${height}`;
			draw = (ctx) => {
				drawCoverScaled({
					ctx,
					width,
					height,
					source: style.source,
					sourceWidth: style.width,
					sourceHeight: style.height,
				});
			};
		}
		if (contentHash && draw) {
			const fillTextureId = `${path}:fill`;
			textures.set(fillTextureId, {
				kind: "rendered",
				id: fillTextureId,
				contentHash,
				width,
				height,
				draw,
			});
			layers.push({
				type: "layer",
				textureId: fillTextureId,
				transform: fullCanvasTransform(renderer),
				opacity: 1,
				blendMode: "normal",
				effectPassGroups: [],
				mask: null,
			});
		}
	}

	const sourceTextureId = `${path}:source`;
	textures.set(sourceTextureId, {
		kind: "external",
		id: sourceTextureId,
		source: side.source,
		width: side.sourceWidth,
		height: side.sourceHeight,
	});
	layers.push({
		type: "layer",
		textureId: sourceTextureId,
		transform: computeVisualTransform({
			renderer,
			resolved: side,
			sourceWidth: side.sourceWidth,
			sourceHeight: side.sourceHeight,
		}),
		opacity: side.opacity,
		blendMode: "normal",
		effectPassGroups: [],
		mask: null,
		...(side.colorGrade ? { colorGrade: side.colorGrade } : {}),
		...(side.colorCorrection
			? { colorCorrection: side.colorCorrection }
			: {}),
		...(side.mediaAnims
			? {
					clipLocalTime: side.clipLocalTime,
					clipDurationSec: side.clipDurationSec,
					mediaAnims: side.mediaAnims,
				}
			: {}),
	});

	return { opaqueBase: fillActive, layers };
}

function computeVisualTransform({
	renderer,
	resolved,
	sourceWidth,
	sourceHeight,
}: {
	renderer: CanvasRenderer;
	resolved: Pick<
		ResolvedVisualSourceNodeState | ResolvedGraphicNodeState,
		"transform"
	>;
	sourceWidth: number;
	sourceHeight: number;
}): QuadTransformDescriptor {
	const containScale = Math.min(
		renderer.width / sourceWidth,
		renderer.height / sourceHeight,
	);
	const scaledWidth = sourceWidth * containScale * resolved.transform.scaleX;
	const scaledHeight = sourceHeight * containScale * resolved.transform.scaleY;
	const absWidth = Math.abs(scaledWidth);
	const absHeight = Math.abs(scaledHeight);

	const s = renderer.contentScale || 1;
	return {
		centerX: renderer.width / 2 + resolved.transform.position.x * s,
		centerY: renderer.height / 2 + resolved.transform.position.y * s,
		width: absWidth,
		height: absHeight,
		rotationDegrees: resolved.transform.rotate,
		flipX: scaledWidth < 0,
		flipY: scaledHeight < 0,
	};
}

function fullCanvasTransform(
	renderer: CanvasRenderer,
): QuadTransformDescriptor {
	return {
		centerX: renderer.width / 2,
		centerY: renderer.height / 2,
		width: renderer.width,
		height: renderer.height,
		rotationDegrees: 0,
		flipX: false,
		flipY: false,
	};
}

function buildMaskArtifacts({
	node,
	renderer,
	path,
	transform,
	textures,
}: {
	node: VideoNode | ImageNode | StickerNode | GraphicNode;
	renderer: CanvasRenderer;
	path: string;
	transform: QuadTransformDescriptor;
	textures: Map<string, TextureUploadDescriptor>;
}): {
	mask: LayerMaskDescriptor | null;
	strokeLayer: FrameItemDescriptor | null;
} {
	const mask = node.params.masks?.[0];
	if (!mask) {
		return { mask: null, strokeLayer: null };
	}

	const definition = getMaskDefinition(mask.type);

	if (definition.isActive?.(mask.params) === false) {
		return { mask: null, strokeLayer: null };
	}

	const { body } = definition.renderer;
	const usesOpaqueFastPath =
		body.kind === "drawWithFeather" &&
		mask.params.feather === 0 &&
		Boolean(body.opaqueFastPath);
	// drawWithFeather renderers encode feathering analytically in their canvas output
	// (e.g. split mask uses a linear gradient instead of JFA). The descriptor feather is
	// zeroed so the GPU compositor copies the mask texture as-is and does not run a second
	// JFA feather pass on top of an already-soft texture.
		const feather = body.kind === "drawWithFeather" ? 0 : mask.params.feather;
		const inverted = Boolean(mask.params.inverted);

		const maskTextureId = `${path}:mask`;
		const { width: canvasWidth, height: canvasHeight } = renderer;
		// Invert is NOT baked — Three applies `1-mask` in the layer shader (and
		// wasm uses mask.wgsl). Baking invert after JFA/getImageData made the
		// whole alphaMap black when feather > 0.
		const maskContentHash = `mask:${mask.type}:${JSON.stringify(mask.params)}:${transformHash(transform)}:${canvasWidth}x${canvasHeight}:body=${body.kind}:fastPath=${usesOpaqueFastPath}:featherBake=${feather}`;
		const drawMask: TextureCanvasDrawFn = (ctx) => {
			const { canvas: elementMaskCanvas, context: elementMaskCtx } =
				createCanvasSurface({
					width: Math.round(transform.width),
					height: Math.round(transform.height),
				});

			switch (body.kind) {
				case "fillPath": {
					const path2d = body.buildPath({
						resolvedParams: mask.params,
						width: transform.width,
						height: transform.height,
					});
					elementMaskCtx.fillStyle = "white";
					elementMaskCtx.fill(path2d);
					break;
				}
				case "drawOpaque":
					body.drawOpaque({
						resolvedParams: mask.params,
						ctx: elementMaskCtx,
						width: Math.round(transform.width),
						height: Math.round(transform.height),
					});
					break;
				case "drawWithFeather":
					if (usesOpaqueFastPath && body.opaqueFastPath) {
						const path2d = body.opaqueFastPath.buildPath({
							resolvedParams: mask.params,
							width: transform.width,
							height: transform.height,
						});
						elementMaskCtx.fillStyle = "white";
						elementMaskCtx.fill(path2d);
					} else {
						body.drawWithFeather({
							resolvedParams: mask.params,
							ctx: elementMaskCtx,
							width: Math.round(transform.width),
							height: Math.round(transform.height),
							feather: mask.params.feather,
						});
					}
					break;
			}

			// Three.js has no JFA pass — bake feather into the alphaMap. Invert
			// stays on the descriptor for the compositor shader.
			if (feather > 0) {
				const { canvas: hardMaskCanvas, context: hardMaskCtx } =
					createCanvasSurface({
						width: canvasWidth,
						height: canvasHeight,
					});
				drawTransformedCanvas({
					ctx: hardMaskCtx,
					source: elementMaskCanvas,
					transform,
				});
				const baked = applyMaskFeather({
					maskCanvas: hardMaskCanvas,
					width: canvasWidth,
					height: canvasHeight,
					feather,
				});
				ctx.drawImage(baked, 0, 0);
				return;
			}

			drawTransformedCanvas({ ctx, source: elementMaskCanvas, transform });
		};
	textures.set(maskTextureId, {
		kind: "rendered",
		id: maskTextureId,
		contentHash: maskContentHash,
		width: canvasWidth,
		height: canvasHeight,
		draw: drawMask,
	});

	const stroke = definition.renderer.stroke;
	const hasStroke = mask.params.strokeWidth > 0 && Boolean(stroke);
	let strokeLayer: FrameItemDescriptor | null = null;
	if (hasStroke && stroke) {
		const strokeTextureId = `${path}:mask-stroke`;
		const strokeContentHash = `stroke:${mask.type}:${JSON.stringify(mask.params)}:${transformHash(transform)}:${canvasWidth}x${canvasHeight}:stroke=${stroke.kind}`;
		const drawStroke: TextureCanvasDrawFn = (ctx) => {
			const { canvas: strokeCanvas, context: strokeCtx } = createCanvasSurface({
				width: Math.round(transform.width),
				height: Math.round(transform.height),
			});

			switch (stroke.kind) {
				case "renderStroke":
					stroke.renderStroke({
						resolvedParams: mask.params,
						ctx: strokeCtx,
						width: transform.width,
						height: transform.height,
					});
					break;
				case "strokeFromPath": {
					const strokePath = stroke.buildStrokePath({
						resolvedParams: mask.params,
						width: transform.width,
						height: transform.height,
					});
					strokeCtx.strokeStyle = mask.params.strokeColor;
					strokeCtx.lineWidth = mask.params.strokeWidth;
					strokeCtx.stroke(strokePath);
					break;
				}
			}

			drawTransformedCanvas({ ctx, source: strokeCanvas, transform });
		};
		textures.set(strokeTextureId, {
			kind: "rendered",
			id: strokeTextureId,
			contentHash: strokeContentHash,
			width: canvasWidth,
			height: canvasHeight,
			draw: drawStroke,
		});
		strokeLayer = {
			type: "layer",
			textureId: strokeTextureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [],
			mask: null,
		};
	}

	return {
		mask: {
			textureId: maskTextureId,
			// Feather is baked into the texture (Three has no JFA). Invert is
			// applied at sample time — keep the flag for Three + wasm.
			feather: 0,
			inverted,
		},
		strokeLayer,
	};
}

function drawTransformedCanvas({
	ctx,
	source,
	transform,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	transform: QuadTransformDescriptor;
}) {
	const x = transform.centerX - transform.width / 2;
	const y = transform.centerY - transform.height / 2;
	const flipX = transform.flipX ? -1 : 1;
	const flipY = transform.flipY ? -1 : 1;
	const requiresTransform =
		transform.rotationDegrees !== 0 || flipX !== 1 || flipY !== 1;

	ctx.save();
	if (requiresTransform) {
		ctx.translate(transform.centerX, transform.centerY);
		ctx.rotate((transform.rotationDegrees * Math.PI) / 180);
		ctx.scale(flipX, flipY);
		ctx.translate(-transform.centerX, -transform.centerY);
	}
	ctx.drawImage(source, x, y, transform.width, transform.height);
	ctx.restore();
}

function transformHash(transform: QuadTransformDescriptor): string {
	return `${transform.centerX}:${transform.centerY}:${transform.width}:${transform.height}:${transform.rotationDegrees}:${transform.flipX ? 1 : 0}:${transform.flipY ? 1 : 0}`;
}

// Stable identity key for CanvasImageSource. Using a WeakMap → counter keeps
// hash string length bounded and avoids holding sources alive.
const identityKeys = new WeakMap<object, number>();
let nextIdentity = 1;
function identityKey(source: CanvasImageSource): string {
	if (typeof source === "object" && source !== null) {
		let key = identityKeys.get(source);
		if (key === undefined) {
			key = nextIdentity++;
			identityKeys.set(source, key);
		}
		return `@${key}`;
	}
	return "@?";
}
