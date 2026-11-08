/**
 * Live property scrub: update GPU-facing scene nodes without React timeline
 * notify / buildScene on every pointermove (same idea as live-drag-transform).
 *
 * Flow:
 * 1. `previewElements({ notify: false })` keeps a silent overlay for commit
 * 2. `applyLiveParamPreview` patches cached scene nodes in place
 * 3. Epoch wake recomposes preview; property panels for touched ids re-read
 * 4. pointer-up `commitPreview` lands the overlay into the project once
 */

import type { TimelineElement } from "@/timeline";
import {
	patchElementNodes,
	type SceneNodeCache,
} from "@/services/renderer/scene-builder";

type CanvasSize = { width: number; height: number };

type BoundScene = {
	cache: SceneNodeCache;
	getCanvasSize: () => CanvasSize;
};

let boundScene: BoundScene | null = null;
let liveParamEpoch = 0;
/** Element ids touched since last clear — property panels subscribe per id. */
let touchedElementIds = new Set<string>();
const wakeListeners = new Set<() => void>();
const elementListeners = new Set<(elementIds: ReadonlySet<string>) => void>();

export function getLiveParamPreviewEpoch(): number {
	return liveParamEpoch;
}

export function getLiveParamTouchedElementIds(): ReadonlySet<string> {
	return touchedElementIds;
}

export function hasLiveParamPreview(): boolean {
	return touchedElementIds.size > 0;
}

export function isLiveParamPreviewBound(): boolean {
	return boundScene !== null;
}

export function hasLiveParamPreviewElement({
	elementId,
}: {
	elementId: string;
}): boolean {
	return boundScene?.cache.elements.has(elementId) === true;
}

/**
 * Preview mounts the scene-node cache here so property scrub can patch nodes
 * without going through RenderTreeController's React effect.
 */
export function bindLiveParamPreviewScene({
	cache,
	getCanvasSize,
}: {
	cache: SceneNodeCache;
	getCanvasSize: () => CanvasSize;
}): () => void {
	boundScene = { cache, getCanvasSize };
	return () => {
		if (boundScene?.cache === cache) {
			boundScene = null;
		}
	};
}

/**
 * Patch cached nodes for `element` and wake preview compose.
 * Returns false when the clip is not in the preview cache (caller should
 * fall back to a notifying previewElements write).
 */
export function applyLiveParamPreview({
	element,
}: {
	element: TimelineElement;
}): boolean {
	if (!boundScene) return false;
	const entry = boundScene.cache.elements.get(element.id);
	if (!entry) return false;

	patchElementNodes({
		nodes: entry.nodes,
		element,
		canvasSize: boundScene.getCanvasSize(),
	});
	entry.element = element;

	const nextTouched = new Set(touchedElementIds);
	nextTouched.add(element.id);
	touchedElementIds = nextTouched;
	liveParamEpoch += 1;

	wakeListeners.forEach((fn) => {
		try {
			fn();
		} catch {
			/* ignore */
		}
	});
	elementListeners.forEach((fn) => {
		try {
			fn(touchedElementIds);
		} catch {
			/* ignore */
		}
	});
	return true;
}

export function clearLiveParamPreview({
	silent = false,
}: {
	silent?: boolean;
} = {}): void {
	if (touchedElementIds.size === 0) return;
	touchedElementIds = new Set();
	if (silent) return;
	liveParamEpoch += 1;
	wakeListeners.forEach((fn) => {
		try {
			fn();
		} catch {
			/* ignore */
		}
	});
	elementListeners.forEach((fn) => {
		try {
			fn(touchedElementIds);
		} catch {
			/* ignore */
		}
	});
}

export function onLiveParamPreviewEpoch(fn: () => void): () => void {
	wakeListeners.add(fn);
	return () => {
		wakeListeners.delete(fn);
	};
}

/** Property panels: re-read silent overlay when this element's live scrub moves. */
export function onLiveParamPreviewElement(
	fn: (elementIds: ReadonlySet<string>) => void,
): () => void {
	elementListeners.add(fn);
	return () => {
		elementListeners.delete(fn);
	};
}
