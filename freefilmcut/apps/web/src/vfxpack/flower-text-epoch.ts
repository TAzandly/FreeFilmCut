/**
 * Bumps when timeline Troika flower-text is ready for another preview blit.
 * OpenCut skips compositor.render when the playhead frame is unchanged; async
 * buildPackScene / Troika sync finish after that skip, so without an epoch the
 * Default text (and first Sample frame) stay blank until the user scrubs.
 *
 * fcc-tl-flower-67: wake listeners so preview can sleep its RAF when idle and
 * still redraw when an async epoch bump arrives.
 */
let flowerTextFrameEpoch = 0;
const wakeListeners = new Set<() => void>();

export function getFlowerTextFrameEpoch(): number {
	return flowerTextFrameEpoch;
}

export function bumpFlowerTextFrameEpoch(): void {
	flowerTextFrameEpoch += 1;
	wakeListeners.forEach((fn) => {
		try {
			fn();
		} catch {
			/* ignore listener errors */
		}
	});
}

/** Subscribe to epoch bumps (and any future wake). Returns unsubscribe. */
export function onFlowerTextFrameEpoch(fn: () => void): () => void {
	wakeListeners.add(fn);
	return () => {
		wakeListeners.delete(fn);
	};
}
