import {
	Input,
	ALL_FORMATS,
	BlobSource,
	CanvasSink,
	type WrappedCanvas,
} from "mediabunny";
import {
	incrementCounter,
	isRenderPerfEnabled,
	recordSpan,
} from "@/diagnostics/render-perf";

interface VideoSinkData {
	input: Input;
	sink: CanvasSink;
	iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
	currentFrame: WrappedCanvas | null;
	nextFrame: WrappedCanvas | null;
	lastTime: number;
	prefetching: boolean;
	prefetchPromise: Promise<void> | null;
}

/**
 * Forward distance inside which walking the open iterator beats re-opening one
 * at a keyframe. Past this the walk would decode more frames than a seek costs.
 */
const ITERATE_WINDOW_S = 2.0;

/**
 * A seek costs ~35ms: re-open a canvas iterator at the previous keyframe and
 * decode up to the target. Which branch lost continuity decides the fix, and
 * the four cases need opposite treatment:
 *
 * - `cold`     nothing decoded yet — prewarm before play starts.
 * - `rewind`   playhead went backwards — legitimate (scrub), mask with a
 *              low-res preview instead of making the seek cheaper.
 * - `jump`     playhead moved more than `ITERATE_WINDOW_S` — same as above.
 * - `iterateMissed` forward walk failed (iterator exhausted / ended mid-clip)
 *              after already paying for the walk, then paid for the seek too.
 */
function classifySeekCause({
	sinkData,
	time,
	iterateMissed,
}: {
	sinkData: VideoSinkData;
	time: number;
	iterateMissed: boolean;
}): string {
	if (!sinkData.currentFrame) return "cold";
	if (time < sinkData.lastTime) return "rewind";
	if (time >= sinkData.lastTime + ITERATE_WINDOW_S) return "jump";
	if (iterateMissed) return "iterateMissed";
	return "invalid";
}

export class VideoCache {
	private sinks = new Map<string, VideoSinkData>();
	private initPromises = new Map<string, Promise<void>>();
	private frameChain = new Map<string, Promise<unknown>>();
	private seekGenerations = new Map<string, number>();

	/**
	 * `streamKey` opens an independent decoder for the same media. Two readers
	 * at different times on one decoder force a keyframe seek on every frame
	 * (e.g. both sides of a transition between halves of a split clip).
	 */
	async getFrameAt({
		mediaId,
		file,
		time,
		streamKey,
	}: {
		mediaId: string;
		file: File;
		time: number;
		streamKey?: string;
	}): Promise<WrappedCanvas | null> {
		const key = streamKey ? `${mediaId}#${streamKey}` : mediaId;
		await this.ensureSink({ mediaId: key, file });

		const sinkData = this.sinks.get(key);
		if (!sinkData) return null;

		const generation = (this.seekGenerations.get(key) ?? 0) + 1;
		this.seekGenerations.set(key, generation);

		/**
		 * Frames for one media are serialised through `frameChain`, so a single
		 * 200ms seek blocks every frame queued behind it. Measuring the wait
		 * separately from the decode is what tells contention apart from a slow
		 * decoder — they need opposite fixes.
		 */
		const perf = isRenderPerfEnabled();
		const enqueuedAt = perf ? performance.now() : 0;
		const previous = this.frameChain.get(key) ?? Promise.resolve();
		const current = previous.then(() => {
			if (perf) {
				recordSpan({
					name: "vcache:queueWait",
					durationMs: performance.now() - enqueuedAt,
				});
			}
			if (this.seekGenerations.get(key) !== generation) {
				if (perf) incrementCounter({ name: "vcache:stale" });
				return sinkData.currentFrame ?? null;
			}
			return this.resolveFrame({ sinkData, time });
		});
		this.frameChain.set(
			key,
			current.catch(() => {}),
		);
		return current;
	}

	private async resolveFrame({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
			sinkData.currentFrame = sinkData.nextFrame;
			sinkData.nextFrame = null;
			this.startPrefetch({ sinkData });
		}

		if (
			sinkData.currentFrame &&
			this.isFrameValid({ frame: sinkData.currentFrame, time })
		) {
			if (isRenderPerfEnabled()) incrementCounter({ name: "vcache:pathHit" });
			if (!sinkData.nextFrame && !sinkData.prefetching) {
				this.startPrefetch({ sinkData });
			}
			return sinkData.currentFrame;
		}

		let iterateMissed = false;
		if (
			sinkData.iterator &&
			sinkData.currentFrame &&
			time >= sinkData.lastTime &&
			time < sinkData.lastTime + ITERATE_WINDOW_S
		) {
			const iterateStart = isRenderPerfEnabled() ? performance.now() : 0;
			const frame = await this.iterateToTime({ sinkData, targetTime: time });
			if (iterateStart) {
				recordSpan({
					name: "vcache:iterate",
					durationMs: performance.now() - iterateStart,
				});
			}
			if (frame) {
				if (!sinkData.nextFrame && !sinkData.prefetching) {
					this.startPrefetch({ sinkData });
				}
				return frame;
			}
			iterateMissed = true;
		}

		if (isRenderPerfEnabled()) {
			incrementCounter({
				name: `vcache:seekCause:${classifySeekCause({ sinkData, time, iterateMissed })}`,
			});
		}

		const seekStart = isRenderPerfEnabled() ? performance.now() : 0;
		const frame = await this.seekToTime({ sinkData, time });
		if (seekStart) {
			recordSpan({
				name: "vcache:seek",
				durationMs: performance.now() - seekStart,
			});
			incrementCounter({ name: "vcache:seekCount" });
		}
		if (frame && !sinkData.nextFrame && !sinkData.prefetching) {
			this.startPrefetch({ sinkData });
		}
		return frame;
	}

	private isFrameValid({
		frame,
		time,
	}: {
		frame: WrappedCanvas;
		time: number;
	}): boolean {
		return time >= frame.timestamp && time < frame.timestamp + frame.duration;
	}
	private async iterateToTime({
		sinkData,
		targetTime,
	}: {
		sinkData: VideoSinkData;
		targetTime: number;
	}): Promise<WrappedCanvas | null> {
		if (!sinkData.iterator) return null;

		try {
			while (true) {
				// Wait for any pending prefetch to finish before touching iterator
				if (sinkData.prefetching && sinkData.prefetchPromise) {
					await sinkData.prefetchPromise;
				}

				// Check if the nextFrame (which might have just arrived) is what we need
				if (
					sinkData.nextFrame &&
					sinkData.nextFrame.timestamp <= targetTime + 0.05 // Tolerance
				) {
					sinkData.currentFrame = sinkData.nextFrame;
					sinkData.nextFrame = null;
				} else {
					const { value: frame, done } = await sinkData.iterator.next();

					if (done || !frame) break;

					sinkData.currentFrame = frame;
				}

				const frame = sinkData.currentFrame;
				if (!frame) break;

				sinkData.lastTime = frame.timestamp;

				if (this.isFrameValid({ frame, time: targetTime })) {
					return frame;
				}

				if (frame.timestamp > targetTime + 1.0) break;
			}
		} catch (error) {
			console.warn("Iterator failed, will restart:", error);
			sinkData.iterator = null;
		}

		return null;
	}
	private async seekToTime({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		try {
			if (sinkData.prefetching && sinkData.prefetchPromise) {
				await sinkData.prefetchPromise;
			}

			if (sinkData.iterator) {
				await sinkData.iterator.return();
				sinkData.iterator = null;
			}

			sinkData.nextFrame = null;
			sinkData.iterator = sinkData.sink.canvases(time);
			sinkData.lastTime = time;

			// Fetch current frame
			const { value: frame } = await sinkData.iterator.next();

			if (frame) {
				sinkData.currentFrame = frame;
				this.startPrefetch({ sinkData });
				return frame;
			}
		} catch (error) {
			console.warn("Failed to seek video:", error);
		}

		return null;
	}

	private startPrefetch({ sinkData }: { sinkData: VideoSinkData }): void {
		if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) {
			return;
		}

		sinkData.prefetching = true;
		sinkData.prefetchPromise = this.prefetchNextFrame({ sinkData });
	}

	private async prefetchNextFrame({
		sinkData,
	}: {
		sinkData: VideoSinkData;
	}): Promise<void> {
		if (!sinkData.iterator) {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			return;
		}

		try {
			const { value: frame, done } = await sinkData.iterator.next();

			if (done || !frame) {
				sinkData.prefetching = false;
				sinkData.prefetchPromise = null;
				return;
			}

			sinkData.nextFrame = frame;
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
		} catch (error) {
			console.warn("Prefetch failed:", error);
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			sinkData.iterator = null;
		}
	}
	private async ensureSink({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		if (this.sinks.has(mediaId)) return;

		if (this.initPromises.has(mediaId)) {
			await this.initPromises.get(mediaId);
			return;
		}

		const initStart = isRenderPerfEnabled() ? performance.now() : 0;
		const initPromise = this.initializeSink({ mediaId, file });
		this.initPromises.set(mediaId, initPromise);

		try {
			await initPromise;
		} finally {
			this.initPromises.delete(mediaId);
			if (initStart) {
				// One-shot per media, but it can be seconds on a big file — worth
				// separating from the per-frame numbers.
				recordSpan({
					name: "vcache:sink",
					durationMs: performance.now() - initStart,
				});
			}
		}
	}
	private async initializeSink({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		const input = new Input({
			source: new BlobSource(file),
			formats: ALL_FORMATS,
		});

		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) {
				throw new Error("No video track found");
			}

			const canDecode = await videoTrack.canDecode();
			if (!canDecode) {
				throw new Error("Video codec not supported for decoding");
			}

			const sink = new CanvasSink(videoTrack, {
				poolSize: 3,
				fit: "contain",
			});

			this.sinks.set(mediaId, {
				input,
				sink,
				iterator: null,
				currentFrame: null,
				nextFrame: null,
				lastTime: -1,
				prefetching: false,
				prefetchPromise: null,
			});
		} catch (error) {
			input.dispose();
			console.error(`Failed to initialize video sink for ${mediaId}:`, error);
			throw error;
		}
	}

	clearVideo({ mediaId }: { mediaId: string }): void {
		const streamPrefix = `${mediaId}#`;
		for (const key of [...this.sinks.keys()]) {
			if (key === mediaId || key.startsWith(streamPrefix)) {
				this.clearStream({ key });
			}
		}
		this.clearStream({ key: mediaId });
	}

	private clearStream({ key }: { key: string }): void {
		const sinkData = this.sinks.get(key);
		if (sinkData) {
			if (sinkData.iterator) {
				void sinkData.iterator.return();
			}

			sinkData.input.dispose();
			this.sinks.delete(key);
		}

		this.initPromises.delete(key);
		this.frameChain.delete(key);
		this.seekGenerations.delete(key);
	}

	clearAll(): void {
		for (const key of [...this.sinks.keys()]) {
			this.clearStream({ key });
		}
	}

	getStats() {
		return {
			totalSinks: this.sinks.size,
			activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
				.length,
			cachedFrames: Array.from(this.sinks.values()).filter(
				(s) => s.currentFrame,
			).length,
		};
	}
}

export const videoCache = new VideoCache();
