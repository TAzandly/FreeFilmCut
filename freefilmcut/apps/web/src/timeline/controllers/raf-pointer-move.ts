export interface PointerPoint {
	clientX: number;
	clientY: number;
}

export interface RafPointerMove {
	/** Record the newest pointer position; the callback runs at most once per frame. */
	push: (point: PointerPoint) => void;
	/** Flush any pending position immediately (call before handling mouseup). */
	flushNow: () => void;
	cancel: () => void;
}

/**
 * Coalesces pointer-move events to one callback per animation frame.
 *
 * Drag interactions only need the newest pointer position each frame: a
 * 1000 Hz mouse emits ~16 moves per displayed frame, and running the full
 * drag pipeline (snap resolution, drop-target computation, store notify,
 * scene rebuild) for each of them saturates the main thread. Events now only
 * store the latest coordinate; the work happens in `requestAnimationFrame`.
 */
export function createRafPointerMove({
	onFrame,
}: {
	onFrame: (point: PointerPoint) => void;
}): RafPointerMove {
	let pending: PointerPoint | null = null;
	let frameId = 0;

	const flush = () => {
		frameId = 0;
		const point = pending;
		pending = null;
		if (point) onFrame(point);
	};

	return {
		push(point) {
			pending = point;
			if (frameId === 0) {
				frameId = requestAnimationFrame(flush);
			}
		},
		flushNow() {
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
				frameId = 0;
			}
			flush();
		},
		cancel() {
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
				frameId = 0;
			}
			pending = null;
		},
	};
}
