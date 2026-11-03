/**
 * Dev-only Performance marks for the play-start hitch.
 *
 * "Press space and the framerate falls off a cliff" is a single ~110ms main
 * thread block, not a diffuse slowdown. `longtask` proves a block happened but
 * not where: it could be the audio scheduler, React's commit, or one
 * `compositor.render()` call. These spans answer that — each one also emits a
 * `performance.mark`, so the same phases show up as labelled bands on the
 * DevTools Timings track.
 *
 * No-ops outside development, so production pays nothing.
 */
const ENABLED = process.env.NODE_ENV === "development";

export type PerfPhase =
	| "play:call"
	| "audio:resume"
	| "compose"
	/**
	 * The synchronous head of `compositor.render()`, measured from the call to
	 * the first `await` that actually yields. This is the span that can block a
	 * frame: shader compilation, `texImage2D` uploads and render-target
	 * reallocation all happen here, and an async-looking method can still run
	 * 100ms of it before returning its promise.
	 */
	| "compose:sync";

export type PerfSpan = {
	name: PerfPhase;
	start: number;
	/** `null` while the phase is still running (or never returned). */
	end: number | null;
};

/**
 * Enough to cover several seconds of composes: two spans per frame at 60Hz is
 * ~120/s, and a trace window can be 6s.
 */
const MAX_SPANS = 1200;
const spans: PerfSpan[] = [];

/**
 * Only one-shot phases get a real `performance.mark`.
 *
 * `compose`/`compose:sync` run every frame; marking them would mint ~180 user
 * timing entries per second and grow the timeline without bound. The ring
 * buffer is enough for per-frame attribution, and DevTools bands only make
 * sense for the rare events anyway.
 */
const MARKED_PHASES = new Set<PerfPhase>(["play:call", "audio:resume"]);

export function beginPerfPhase({ phase }: { phase: PerfPhase }): void {
	if (!ENABLED) return;
	if (spans.length >= MAX_SPANS) spans.shift();
	spans.push({ name: phase, start: performance.now(), end: null });
	if (!MARKED_PHASES.has(phase)) return;
	try {
		performance.mark(`fcc:${phase}:start`);
	} catch {
		/* ignore */
	}
}

export function endPerfPhase({ phase }: { phase: PerfPhase }): void {
	if (!ENABLED) return;
	const now = performance.now();
	if (MARKED_PHASES.has(phase)) {
		try {
			performance.mark(`fcc:${phase}:end`);
		} catch {
			/* ignore */
		}
	}
	// Close the most recent still-open span of this phase. Composes never
	// overlap (`renderingRef` in the preview loop guarantees it), so "most
	// recent open" is unambiguous without keeping a per-phase stack.
	for (let i = spans.length - 1; i >= 0; i--) {
		const span = spans[i];
		if (span && span.name === phase && span.end === null) {
			span.end = now;
			return;
		}
	}
}

/** Snapshots every span that overlaps `[since, until]`. */
export function readPerfSpans({
	since,
	until,
}: {
	since: number;
	until?: number;
}): PerfSpan[] {
	if (!ENABLED) return [];
	const to = until ?? Number.POSITIVE_INFINITY;
	return spans
		.filter((span) => (span.end ?? performance.now()) >= since && span.start <= to)
		.map((span) => ({ ...span }));
}

export function clearPerfPhaseMarks(): void {
	if (!ENABLED) return;
	spans.length = 0;
	try {
		// `clearMarks` only accepts a plain name in this TS lib, so clear the
		// whole track. Dev-only probe; nothing else owns marks here.
		performance.clearMarks();
	} catch {
		/* ignore */
	}
}
