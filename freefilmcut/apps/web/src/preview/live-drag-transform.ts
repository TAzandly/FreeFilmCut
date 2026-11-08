/**
 * Lightweight canvas-drag overlay: absolute transform.position while the
 * pointer is down, without rebuilding SceneTracks / buildScene each move.
 *
 * Preview compose and selection bounds read this map; pointer-up commits
 * timeline tracks once, then clears this overlay.
 */

export type LiveDragPosition = {
	readonly x: number;
	readonly y: number;
};

let liveDragEpoch = 0;
let liveDragByElementId = new Map<string, LiveDragPosition>();
const wakeListeners = new Set<() => void>();

export function getLiveDragEpoch(): number {
	return liveDragEpoch;
}

export function getLiveDragTransform(
	elementId: string,
): LiveDragPosition | undefined {
	return liveDragByElementId.get(elementId);
}

export function hasLiveDragTransforms(): boolean {
	return liveDragByElementId.size > 0;
}

/**
 * Replace the live map. Passing an empty map (or calling clear) ends the
 * overlay. Always bumps the epoch so preview RAF and handle UI wake.
 */
export function setLiveDragTransforms({
	positions,
}: {
	positions: ReadonlyMap<string, LiveDragPosition>;
}): void {
	liveDragByElementId = new Map(positions);
	liveDragEpoch += 1;
	wakeListeners.forEach((fn) => {
		try {
			fn();
		} catch {
			/* ignore listener errors */
		}
	});
}

/**
 * Drop the live overlay. `silent` skips the epoch wake — used right after a
 * tracks commit has already published the final positions, so we do not
 * schedule an extra compose on the pointer-up frame.
 */
export function clearLiveDragTransforms({
	silent = false,
}: {
	silent?: boolean;
} = {}): void {
	if (liveDragByElementId.size === 0) return;
	if (silent) {
		liveDragByElementId = new Map();
		return;
	}
	setLiveDragTransforms({ positions: new Map() });
}

/** Subscribe to live-drag epoch bumps. Returns unsubscribe. */
export function onLiveDragEpoch(fn: () => void): () => void {
	wakeListeners.add(fn);
	return () => {
		wakeListeners.delete(fn);
	};
}

/** Apply live absolute position over a resolved transform, if any. */
export function applyLiveDragToTransform<
	T extends { position: { x: number; y: number } },
>({
	elementId,
	transform,
}: {
	elementId: string | undefined;
	transform: T;
}): T {
	if (!elementId) return transform;
	const live = liveDragByElementId.get(elementId);
	if (!live) return transform;
	return {
		...transform,
		position: { x: live.x, y: live.y },
	};
}
