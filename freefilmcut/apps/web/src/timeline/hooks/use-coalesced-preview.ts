"use client";

import { useCallback, useEffect, useRef } from "react";
import { registerPreviewFlusher } from "@/timeline/preview-flush";

/**
 * Collapses property-panel preview writes to ONE per animation frame.
 *
 * Why this exists:
 *
 * A number field / slider calls `onPreview` on every pointer event. A mouse
 * emits 125 events per second, a trackpad or a high-polling mouse up to 1000 —
 * so a single 1-second scrub issues 125–1000 `timeline.previewElements()` calls.
 * Each of those runs `applyPreviewOverlay()` (O(every track × element)) and then
 * `notify()`, which `useSyncExternalStore` flushes on the **sync lane**: the
 * whole React commit happens inside the same task as the pointer event. Ten
 * commits per frame is the reason "drag one slider" halves the frame rate even
 * though the compositor only spends ~4 ms.
 *
 * Nothing visual is lost by dropping intermediate values: they can never be
 * seen, because only the last write before the frame is composited. The user
 * still gets 1 write → 1 commit → 1 composite per frame.
 *
 * `flush()` is mandatory before committing: `commitPreview()` turns the overlay
 * into a real timeline edit, and a value still sitting in `pendingRef` would be
 * silently dropped (the UI would show the new value, the project would keep the
 * old one).
 */
export function useCoalescedPreview<T>({
	apply,
}: {
	apply: (value: T) => void;
}): { push: (value: T) => void; flush: () => void } {
	const applyRef = useRef(apply);
	const pendingRef = useRef<{ value: T } | null>(null);
	const frameRef = useRef<number | null>(null);

	useEffect(() => {
		applyRef.current = apply;
	});

	const cancel = useCallback(() => {
		if (frameRef.current === null) return;
		cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
	}, []);

	const flush = useCallback(() => {
		cancel();
		const pending = pendingRef.current;
		pendingRef.current = null;
		if (pending) {
			applyRef.current(pending.value);
		}
	}, [cancel]);

	const push = useCallback((value: T) => {
		pendingRef.current = { value };
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			const latest = pendingRef.current;
			pendingRef.current = null;
			if (latest) {
				applyRef.current(latest.value);
			}
		});
	}, []);

	useEffect(() => cancel, [cancel]);

	/**
	 * Let `TimelineManager.commitPreview()` / `discardPreview()` drain this queue
	 * first — see preview-flush.ts. Without it, a value still waiting for its
	 * frame would be either lost by the commit or stranded after the discard.
	 */
	useEffect(() => registerPreviewFlusher({ flush }), [flush]);

	return { push, flush };
}
