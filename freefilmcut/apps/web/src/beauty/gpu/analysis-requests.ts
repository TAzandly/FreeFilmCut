import {
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
import {
	analyzeBeautyFrameOffThread,
	analyzeBeautyPreviewOffThread,
	invalidateBeautyPreviewClip,
} from "../analysis/worker-client";

/** Longer edge of analysis snapshots (detectors resize internally anyway). */
export const BEAUTY_ANALYSIS_MAX_EDGE = 720;
/** A previous result for the same clip is reused up to this far away (1 s). */
export const BEAUTY_STALE_MAX_TICKS = 120_000;
/** Results the analyzer chose not to cache (detector error) are retried after this. */
export const BEAUTY_RETRY_MS = 2_000;
/**
 * Preview refresh throttle: at most one new analysis start per clip per
 * interval, with a trailing run for the latest playhead position. Unlike a
 * debounce this keeps landmarks tracking during playback and scrubbing.
 * Export `ensure()` bypasses it.
 */
export const BEAUTY_ANALYSIS_THROTTLE_MS = 40;
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
	/** Preview analysis; may return an approximate frame and refine it later. */
	analyze: (params: AnalyzeBeautyFrameParams) => Promise<BeautyAnalysisFrame>;
	/** Export analysis (exact). Defaults to `analyze` when only that is injected. */
	analyzeExact: (params: AnalyzeBeautyFrameParams) => Promise<BeautyAnalysisFrame>;
	/** Forget analyzer-side state for a clip (`null` = all clips). */
	invalidate?: (clipId: string | null) => void;
	cache: Pick<BeautyAnalysisCache, "get" | "delete">;
	/** Copy `source` into a private bitmap; the pooled source mutates later. */
	snapshot: (request: BeautyAnalysisRequest) => BeautyImageSource | null;
	/** Called when an analysis finishes so a paused preview can repaint. */
	onReady?: () => void;
	now: () => number;
	/** Injectable timer for tests; returns a cancel function. */
	schedule: (fn: () => void, ms: number) => () => void;
};

type Latest = {
	ticksKey: number;
	at: number;
	frame: BeautyAnalysisFrame;
	/** From `analyzeExact`; preview frames may carry an approximate mask. */
	exact: boolean;
};
type InFlight = { ticksKey: number; promise: Promise<BeautyAnalysisFrame | null> };

/**
 * Copy a frame (<= maxEdge) for analysis. Returns a transferable `ImageBitmap`
 * when `OffscreenCanvas` exists, else a DOM canvas. Browser only.
 */
export function snapshotForBeautyAnalysis(
	request: BeautyAnalysisRequest,
	maxEdge = BEAUTY_ANALYSIS_MAX_EDGE,
): BeautyImageSource | null {
	const { width, height } = request;
	if (!(width > 0 && height > 0)) return null;
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));
	try {
		if (typeof OffscreenCanvas !== "undefined") {
			const canvas = new OffscreenCanvas(w, h);
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;
			ctx.drawImage(request.source, 0, 0, w, h);
			return canvas.transferToImageBitmap();
		}
		if (typeof document === "undefined") return null;
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(request.source, 0, 0, w, h);
		return canvas;
	} catch {
		return null;
	}
}

function defaultSchedule(fn: () => void, ms: number): () => void {
	const id = setTimeout(fn, ms);
	return () => clearTimeout(id);
}

/**
 * Non-blocking beauty analysis scheduling for the compositor.
 *
 * - `request()` (preview): returns cached / recent analysis immediately and
 *   starts at most one run per clip at a time, throttled to
 *   `BEAUTY_ANALYSIS_THROTTLE_MS`. When throttled, a timer wakes the preview
 *   (`onReady`) so the next render requests again with the live frame.
 * - `ensure()` (export): resolves with the exact analysis, no throttle.
 */
export class BeautyAnalysisRequester {
	private readonly deps: BeautyAnalysisRequesterDeps;
	private readonly latest = new Map<string, Latest>();
	private readonly inFlight = new Map<string, InFlight>();
	private readonly lastStartAt = new Map<string, number>();
	/** Cancel functions of scheduled throttle wake-ups, per clip. */
	private readonly pending = new Map<string, () => void>();
	/**
	 * Bumped by `invalidateClip` / `clear`; an analysis started under an older
	 * token is stale and its result is dropped instead of remembered.
	 */
	private readonly clipGeneration = new Map<string, number>();
	private epoch = 0;

	constructor(deps: Partial<BeautyAnalysisRequesterDeps> = {}) {
		const injected = deps.analyze;
		this.deps = {
			analyze: (params) =>
				analyzeBeautyPreviewOffThread(params, () => this.deps.onReady?.()),
			analyzeExact: injected ?? analyzeBeautyFrameOffThread,
			invalidate: injected ? undefined : invalidateBeautyPreviewClip,
			cache: beautyAnalysisCache,
			snapshot: (r) => snapshotForBeautyAnalysis(r),
			now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
			schedule: defaultSchedule,
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

	/** Preview path: best available analysis now; throttled refresh. */
	request(request: BeautyAnalysisRequest): BeautyAnalysisFrame | null {
		const { clipId, mediaTimeTicks } = request;
		const exact = this.deps.cache.get(clipId, mediaTimeTicks);
		if (exact) return exact;
		const ticksKey = quantizeMediaTimeTicks(mediaTimeTicks, BEAUTY_ANALYSIS_TICK_QUANTUM);
		const current = this.peek(clipId, mediaTimeTicks);
		const last = this.latest.get(clipId);
		const haveExact = last?.ticksKey === ticksKey && current === last.frame;
		// In-flight completion fires `onReady`, which re-requests the live frame.
		if (haveExact || this.inFlight.has(clipId)) return current;
		const since = this.deps.now() - (this.lastStartAt.get(clipId) ?? Number.NEGATIVE_INFINITY);
		if (!current || since >= BEAUTY_ANALYSIS_THROTTLE_MS) {
			this.cancelPending(clipId);
			void this.start(request, ticksKey);
		} else {
			this.scheduleWake(clipId, BEAUTY_ANALYSIS_THROTTLE_MS - since);
		}
		return current;
	}

	/** Export path: resolve with this frame's analysis (null when unavailable). */
	async ensure(request: BeautyAnalysisRequest): Promise<BeautyAnalysisFrame | null> {
		const { clipId, mediaTimeTicks } = request;
		this.cancelPending(clipId);
		const ticksKey = quantizeMediaTimeTicks(mediaTimeTicks, BEAUTY_ANALYSIS_TICK_QUANTUM);
		for (let attempt = 0; attempt < 3; attempt++) {
			const token = this.token(clipId);
			const exact = this.deps.cache.get(clipId, mediaTimeTicks);
			if (exact) return exact;
			const last = this.latest.get(clipId);
			if (
				last?.exact &&
				last.ticksKey === ticksKey &&
				this.deps.now() - last.at < BEAUTY_RETRY_MS
			) {
				return last.frame;
			}
			const pending = this.inFlight.get(clipId);
			if (pending) {
				// Preview may be analysing a different frame; wait, then re-check.
				await pending.promise;
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
		this.cancelPending(clipId);
		this.latest.delete(clipId);
		this.inFlight.delete(clipId);
		this.lastStartAt.delete(clipId);
		this.deps.invalidate?.(clipId);
		this.clipGeneration.set(clipId, (this.clipGeneration.get(clipId) ?? 0) + 1);
	}

	/** Forget everything (compositor teardown); all in-flight results are ignored. */
	clear(): void {
		for (const clipId of [...this.pending.keys()]) this.cancelPending(clipId);
		this.latest.clear();
		this.inFlight.clear();
		this.lastStartAt.clear();
		this.deps.invalidate?.(null);
		this.clipGeneration.clear();
		this.epoch++;
	}

	private token(clipId: string): string {
		return `${this.epoch}:${this.clipGeneration.get(clipId) ?? 0}`;
	}

	private cancelPending(clipId: string): void {
		const cancel = this.pending.get(clipId);
		if (!cancel) return;
		cancel();
		this.pending.delete(clipId);
	}

	/** Repaint the preview once the throttle window for `clipId` has passed. */
	private scheduleWake(clipId: string, ms: number): void {
		if (this.pending.has(clipId)) return;
		const cancel = this.deps.schedule(() => {
			this.pending.delete(clipId);
			this.deps.onReady?.();
		}, Math.max(0, ms));
		this.pending.set(clipId, cancel);
	}

	private start(
		request: BeautyAnalysisRequest,
		ticksKey: number,
		quiet = false,
	): Promise<BeautyAnalysisFrame | null> {
		const { clipId, mediaTimeTicks } = request;
		const image = this.deps.snapshot(request);
		if (!image) return Promise.resolve(null);
		this.lastStartAt.set(clipId, this.deps.now());
		const token = this.token(clipId);
		const analyze = quiet ? this.deps.analyzeExact : this.deps.analyze;
		const promise = analyze({ clipId, mediaTimeTicks, image })
			.then((frame): BeautyAnalysisFrame | null => {
				if (this.token(clipId) !== token) {
					// Source/trim changed mid-analysis: the analyzer already cached
					// this frame, so evict it and never surface it.
					if (this.deps.cache.get(clipId, mediaTimeTicks) === frame) {
						this.deps.cache.delete(clipId, mediaTimeTicks);
					}
					return null;
				}
				this.remember(clipId, {
					ticksKey,
					at: this.deps.now(),
					frame,
					exact: analyze === this.deps.analyzeExact,
				});
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
