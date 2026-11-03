/**
 * Registry of pending, frame-coalesced preview writes.
 *
 * `useCoalescedPreview` defers a preview write to the next animation frame, which
 * is what stops a 125–1000 Hz scrub from issuing that many React commits. The
 * cost of deferring is that a value can be "in flight" while someone else decides
 * to commit or discard:
 *
 *   - `commitPreview()` builds the real edit from the overlay → a queued value
 *     would be dropped (panel shows the new number, project keeps the old one);
 *   - `discardPreview()` clears the overlay → the queued value would then land on
 *     an overlay nobody clears, leaving it "active" forever.
 *
 * Both are decided in `TimelineManager`, which knows nothing about React. So the
 * hooks register their flusher here and the manager calls `flushPendingPreviews()`
 * before either operation. Flushing is idempotent and safe to over-call.
 */

type Flusher = () => void;

const flushers = new Set<Flusher>();

export function registerPreviewFlusher({ flush }: { flush: Flusher }): () => void {
	flushers.add(flush);
	return () => {
		flushers.delete(flush);
	};
}

export function flushPendingPreviews(): void {
	if (flushers.size === 0) return;
	for (const flush of flushers) {
		flush();
	}
}
