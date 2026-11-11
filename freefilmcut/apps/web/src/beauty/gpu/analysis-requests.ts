import {
	analyzeBeautyFrame,
	beautyAnalysisCache,
	type AnalyzeBeautyFrameParams,
} from "../analysis/face-body-analysis";
import {
	BEAUTY_ANALYSIS_TICK_QUANTUM,
	type BeautyAnalysisCache,
	quantizeMediaTimeTicks,
} from "../analysis/cache";
import type { BeautyImageSource } from "../analysis/image-source";
import type { BeautyAnalysisFrame } from "../analysis/types";

/** Longer edge of the pixel snapshot handed to the detectors. */
export const BEAUTY_ANALYSIS_MAX_EDGE = 1280;
/** A previous result for the same clip is reused up to this far away (0.5 s). */
export const BEAUTY_STALE_MAX_TICKS = 60_000;
/** Results the analyzer chose not to cache (detector error) are retried after this. */
export const BEAUTY_RETRY_MS = 2_000;
const MAX_TRACKED_CLIPS = 32;

export type BeautyAnalysisRequest = {
	/** Timeline element id; analysis cache key is `(clipId, quantized ticks)`. */
	clipId: string;
	/** Clip-local time in MediaTime ticks (0 for stills). */
	mediaTimeTicks: number;
	/** Live source (video canvas, bitmap, …) — snapshotted synchronously. */
	source: CanvasImageSource;
	width: number;
	height: number;
};

export type BeautyAnalysisRequesterDeps = {
	analyze: (params: AnalyzeBeautyFrameParams) => Promise<BeautyAnalysisFrame>;
	cache: Pick<BeautyAnalysisCache, "get" | "delete">;
	/** Copy `source` into a private bitmap; the pooled source mutates later. */
	snapshot: (request: BeautyAnalysisRequest) => BeautyImageSource | null;
	/** Called when an analysis finishes so a paused preview can repaint. */
	onReady?: () => void;
	now: () => number;
};

type Latest = { ticksKey: number; at: number; frame: BeautyAnalysisFrame };
type InFlight = { ticksKey: number; promise: Promise<BeautyAnalysisFrame | null> };

/** Copy a frame into a DOM canvas (<= maxEdge) for analysis. Browser only. */
export function snapshotForBeautyAnalysis(
	request: BeautyAnalysisRequest,
	maxEdge = BEAUTY_ANALYSIS_MAX_EDGE,
): BeautyImageSource | null {
	if (typeof document === "undefined") return null;
	const { width, height } = request;
	if (!(width > 0 && height > 0)) return null;
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	try {
		ctx.drawImage(request.source, 0, 0, canvas.width, canvas.height);
	} catch {
		return null;
	}
	return canvas;
}

/**
 * Non-blocking beauty analysis scheduling for the compositor.
 *
 * - `request()` (preview): returns the analysis for this frame if cached, else
 *   the most recent one for the clip (within `BEAUTY_STALE_MAX_TICKS`), and
 *   starts at most one analysis per clip in the background.
 * - `ensure()` (export): resolves with the exact analysis, awaiting detection.
 */
export class BeautyAnalysisRequester {
	private readonly deps: BeautyAnalysisRequesterDeps;
	private readonly latest = new Map<string, Latest>();
	private readonly inFlight = new Map<string, InFlight>();
	/**
	 * Bumped by `invalidateClip` / `clear`; an analysis started under an older
	 * token is stale and its result is dropped instead of remembered.
	 */
	private readonly clipGeneration = new Map<string, number>();
	private epoch = 0;

	constructor(deps: Partial<BeautyAnalysisRequesterDeps> = {}) {
		this.deps = {
			analyze: analyzeBeautyFrame,
			cache: beautyAnalysisCache,
			snapshot: (r) => snapshotForBeautyAnalysis(r),
			now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
			...deps,
		};
	}

	/** Cache hit / recent result for this frame, without scheduling work. */
	peek(clipId: string, mediaTimeTicks: number): BeautyAnalysisFrame | null {
		const ticksKey = quantizeMediaTimeTicks(mediaTimeTicks, BEAUTY_ANALYSIS_TICK_QUANTUM);
		const hit = this.deps.cache.get(clipId, mediaTimeTicks);
		if (hit) return hit;
		const last = this.latest.get(clipId);
		if (!last) return null;
		if (last.ticksKey === ticksKey) {
			// Uncached results (detector failure) are retried after a delay.
			return this.deps.now() - last.at < BEAUTY_RETRY_MS ? last.frame : null;
		}
		return Math.abs(last.ticksKey - ticksKey) <= BEAUTY_STALE_MAX_TICKS ? last.frame : null;
	}

	/** Preview path: best available analysis now; refresh in the background. */
	request(request: BeautyAnalysisRequest): BeautyAnalysisFrame | null {
		const { clipId, mediaTimeTicks } = request;
		const exact = this.deps.cache.get(clipId, mediaTimeTicks);
		if (exact) return exact;
		const ticksKey = quantizeMediaTimeTicks(mediaTimeTicks, BEAUTY_ANALYSIS_TICK_QUANTUM);
		const current = this.peek(clipId, mediaTimeTicks);
		const last = this.latest.get(clipId);
		const haveExact = last?.ticksKey === ticksKey && current === last.frame;
		if (!haveExact && !this.inFlight.has(clipId)) {
			void this.start(request, ticksKey);
		}
		return current;
	}

	/** Export path: resolve with this frame's analysis (null when unavailable). */
	async ensure(request: BeautyAnalysisRequest): Promise<BeautyAnalysisFrame | null> {
		const { clipId, mediaTimeTicks } = request;
		const ticksKey = quantizeMediaTimeTicks(mediaTimeTicks, BEAUTY_ANALYSIS_TICK_QUANTUM);
		for (let attempt = 0; attempt < 3; attempt++) {
			const token = this.token(clipId);
			const exact = this.deps.cache.get(clipId, mediaTimeTicks);
			if (exact) return exact;
			const last = this.latest.get(clipId);
			if (last?.ticksKey === ticksKey && this.deps.now() - last.at < BEAUTY_RETRY_MS) {
				return last.frame;
			}
			const pending = this.inFlight.get(clipId);
			if (pending) {
				// Preview may be analysing a different frame; wait, then re-check.
				const done = await pending.promise;
				if (pending.ticksKey === ticksKey && done) return done;
				continue;
			}
			const result = await this.start(request, ticksKey, true);
			// Invalidated while analysing: the result was dropped, so re-analyze.
			if (this.token(clipId) !== token) continue;
			return result;
		}
		return null;
	}

	/** Forget a clip's results; late in-flight results for it are ignored. */
	invalidateClip(clipId: string): void {
		this.latest.delete(clipId);
		this.inFlight.delete(clipId);
		this.clipGeneration.set(clipId, (this.clipGeneration.get(clipId) ?? 0) + 1);
	}

	/** Forget everything (compositor teardown); all in-flight results are ignored. */
	clear(): void {
		this.latest.clear();
		this.inFlight.clear();
		this.clipGeneration.clear();
		this.epoch++;
	}

	private token(clipId: string): string {
		return `${this.epoch}:${this.clipGeneration.get(clipId) ?? 0}`;
	}

	private start(
		request: BeautyAnalysisRequest,
		ticksKey: number,
		quiet = false,
	): Promise<BeautyAnalysisFrame | null> {
		const { clipId, mediaTimeTicks } = request;
		const image = this.deps.snapshot(request);
		if (!image) return Promise.resolve(null);
		const token = this.token(clipId);
		const promise = this.deps
			.analyze({ clipId, mediaTimeTicks, image })
			.then((frame): BeautyAnalysisFrame | null => {
				if (this.token(clipId) !== token) {
					// Source/trim changed mid-analysis: the analyzer already cached
					// this frame, so evict it and never surface it.
					if (this.deps.cache.get(clipId, mediaTimeTicks) === frame) {
						this.deps.cache.delete(clipId, mediaTimeTicks);
					}
					return null;
				}
				this.remember(clipId, { ticksKey, at: this.deps.now(), frame });
				// Export awaits the result directly; only the preview needs a wake-up.
				if (!quiet) this.deps.onReady?.();
				return frame;
			})
			.catch((error): BeautyAnalysisFrame | null => {
				console.warn("[beauty] analysis request failed:", error);
				return null;
			})
			.finally(() => {
				if (this.inFlight.get(clipId)?.promise === promise) {
					this.inFlight.delete(clipId);
				}
			});
		this.inFlight.set(clipId, { ticksKey, promise });
		return promise;
	}

	private remember(clipId: string, entry: Latest): void {
		this.latest.delete(clipId);
		this.latest.set(clipId, entry);
		while (this.latest.size > MAX_TRACKED_CLIPS) {
			const oldest = this.latest.keys().next().value as string;
			this.latest.delete(oldest);
		}
	}
}
