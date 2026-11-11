import { beautyAnalysisCache } from "./analysis/face-body-analysis";

type Listener = (clipId: string) => void;

const listeners = new Set<Listener>();

/** Requesters subscribe so they can drop per-clip state; returns unsubscribe. */
export function subscribeBeautyInvalidation(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * A clip's decoded frames changed (media source, trim, reverse, retime, or the
 * clip was removed): drop cached analysis and any requester state for it.
 */
export function invalidateBeautyClip(clipId: string): void {
	beautyAnalysisCache.invalidateClip(clipId);
	for (const listener of listeners) listener(clipId);
}
