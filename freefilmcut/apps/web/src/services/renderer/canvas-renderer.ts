import type { FrameRate } from "opencut-wasm";
import type { AnyBaseNode } from "./nodes/base-node";
import { createCanvasSurface } from "./canvas-utils";
import { buildFrameDescriptor } from "./compositor/frame-descriptor";
import { wasmCompositor } from "./compositor/wasm-compositor";
import { threeCompositor } from "./compositor/three-compositor";
import { resolveRenderTree } from "./resolve";
import {
	measureSpanAsync,
	measureSpanSync,
	onRenderPerfFrameComplete,
} from "@/diagnostics/render-perf";

/**
 * FreeFilmCut: Three.js blit is default ON.
 * Set NEXT_PUBLIC_USE_THREE=0 to fall back to the wasm compositor.
 */
const USE_THREE = process.env.NEXT_PUBLIC_USE_THREE !== "0";

type ActiveCompositor = {
	ensureInitialized: (size: { width: number; height: number }) => void;
	getCanvas: () => HTMLCanvasElement;
	syncTextures: (textures: Parameters<typeof threeCompositor.syncTextures>[0]) => void;
	render: (
		frame: Parameters<typeof threeCompositor.render>[0],
		opts?: { waitForFlowerText?: boolean },
	) => void | Promise<void>;
};

function getCompositor(): ActiveCompositor {
	return USE_THREE ? threeCompositor : wasmCompositor;
}

export type CanvasRendererParams = {
	/** Project / logical canvas size (element positions are authored in this space). */
	width: number;
	height: number;
	fps: FrameRate;
	/**
	 * Preview-only scale of the actual render buffer (1 = full).
	 * Export / snapshot paths should leave this at 1.
	 */
	contentScale?: number;
};

function resolveBufferSize({
	width,
	height,
	contentScale,
}: {
	width: number;
	height: number;
	contentScale: number;
}): { width: number; height: number; contentScale: number } {
	// Preview uses scale < 1; export resolution may use scale > 1 (e.g. 1080→4K).
	const scale =
		Number.isFinite(contentScale) && contentScale > 0 ? contentScale : 1;
	if (Math.abs(scale - 1) < 0.001) {
		return {
			width: Math.max(1, Math.round(width)),
			height: Math.max(1, Math.round(height)),
			contentScale: 1,
		};
	}
	const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
	const bufferWidth = even(Math.max(1, width * scale));
	const bufferHeight = even(Math.max(1, height * scale));
	return {
		width: bufferWidth,
		height: bufferHeight,
		contentScale: bufferWidth / Math.max(1, width),
	};
}

export class CanvasRenderer {
	canvas: OffscreenCanvas;
	context: OffscreenCanvasRenderingContext2D;
	/** Physical render buffer size (may be smaller than project for preview). */
	width: number;
	height: number;
	/** Project canvas size used by transforms / Fit UI. */
	logicalWidth: number;
	logicalHeight: number;
	/**
	 * Multiply authored pixel positions by this to land in buffer space.
	 * Equal to width / logicalWidth.
	 */
	contentScale: number;
	fps: FrameRate;

	constructor({ width, height, fps, contentScale = 1 }: CanvasRendererParams) {
		this.logicalWidth = Math.max(1, Math.round(width));
		this.logicalHeight = Math.max(1, Math.round(height));
		const buffer = resolveBufferSize({
			width: this.logicalWidth,
			height: this.logicalHeight,
			contentScale,
		});
		this.width = buffer.width;
		this.height = buffer.height;
		this.contentScale = buffer.contentScale;
		this.fps = fps;

		const surface = createCanvasSurface({
			width: this.width,
			height: this.height,
		});
		this.canvas = surface.canvas;
		this.context = surface.context;
	}

	getOutputCanvas(): HTMLCanvasElement {
		const compositor = getCompositor();
		compositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		return compositor.getCanvas();
	}

	setSize({
		width,
		height,
		contentScale,
	}: {
		width: number;
		height: number;
		contentScale?: number;
	}) {
		this.logicalWidth = Math.max(1, Math.round(width));
		this.logicalHeight = Math.max(1, Math.round(height));
		const buffer = resolveBufferSize({
			width: this.logicalWidth,
			height: this.logicalHeight,
			contentScale: contentScale ?? this.contentScale,
		});
		this.width = buffer.width;
		this.height = buffer.height;
		this.contentScale = buffer.contentScale;

		const surface = createCanvasSurface({
			width: this.width,
			height: this.height,
		});
		this.canvas = surface.canvas;
		this.context = surface.context;
	}

	async render({
		node,
		time,
		waitForFlowerText = false,
	}: {
		node: AnyBaseNode;
		time: number;
		/** Export/snapshot: block until Troika text scenes are ready. Preview: false. */
		waitForFlowerText?: boolean;
	}) {
		await measureSpanAsync({
			name: "resolve",
			fn: () => resolveRenderTree({ node, renderer: this, time }),
		});
		const { frame, textures } = await measureSpanAsync({
			name: "buildFrame",
			fn: () => buildFrameDescriptor({ node, renderer: this }),
		});
		const compositor = getCompositor();
		compositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		measureSpanSync({
			name: "syncTextures",
			fn: () => compositor.syncTextures(textures),
		});
		await measureSpanAsync({
			name: "renderFrame",
			fn: async () => {
				await compositor.render(frame, { waitForFlowerText });
			},
		});
		// Preview path never reached the flush before: `onRenderPerfFrameComplete`
		// was only called from `renderToCanvas`, so `window.__renderPerf = true`
		// produced nothing while scrubbing or playing (and grew the span map
		// without bound). The live preview is where compose cost actually matters,
		// so close the frame here.
		onRenderPerfFrameComplete();
	}

	async renderToCanvas({
		node,
		time,
		targetCanvas,
		waitForFlowerText = true,
	}: {
		node: AnyBaseNode;
		time: number;
		targetCanvas: HTMLCanvasElement;
		waitForFlowerText?: boolean;
	}) {
		await this.render({ node, time, waitForFlowerText });

		const ctx = targetCanvas.getContext("2d");
		if (!ctx) {
			throw new Error("Failed to get target canvas context");
		}

		const compositor = getCompositor();
		measureSpanSync({
			name: "drawImage",
			fn: () =>
				ctx.drawImage(
					compositor.getCanvas(),
					0,
					0,
					targetCanvas.width,
					targetCanvas.height,
				),
		});
	}
}
