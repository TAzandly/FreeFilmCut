/**
 * Interaction-side perf instrumentation (complements `render-perf.ts`, which
 * only covers the render pipeline).
 *
 * Toggle from the devtools console:
 *   window.__interactionPerf = true
 *
 * Once a second it prints one row per instrumented drag pipeline:
 *   moves/s   — raw pointermove events received
 *   work/s    — times the coalesced work callback actually ran
 *   perMove   — work / moves. Before rAF coalescing this is ~1.0 (every event
 *               ran the full pipeline); afterwards it should land near the
 *               frame rate / device-report-rate ratio (e.g. ~0.06 for 1000Hz).
 * It also reports long tasks (>50ms) collected by PerformanceObserver and a
 * rolling worst-case duration.
 *
 * Zero overhead when disabled: `isInteractionPerfEnabled()` short-circuits on
 * a global flag read before any bookkeeping happens.
 */

type WorkCounters = Map<string, number>;

const FLUSH_INTERVAL_MS = 1000;

declare global {
	interface Window {
		__interactionPerf?: boolean;
		__interactionPerfReset?: () => void;
	}
}

let movesThisWindow = 0;
let longTasksThisWindow: number[] = [];
let totalLongTasks = 0;
let worstLongTaskMs = 0;
const workThisWindow: WorkCounters = new Map();
const workTotals: WorkCounters = new Map();

type DurationStats = { total: number; max: number; count: number };
const durationThisWindow = new Map<string, DurationStats>();

export function isInteractionPerfEnabled(): boolean {
	return typeof window !== "undefined" && window.__interactionPerf === true;
}

export function recordPointerMove(): void {
	if (!isInteractionPerfEnabled()) return;
	movesThisWindow += 1;
}

/**
 * Marks one execution of a coalesced drag/pointer work callback. Call this at
 * the top of the per-frame handler, not at the DOM event listener.
 */
export function recordInteractionWork({ name }: { name: string }): void {
	if (!isInteractionPerfEnabled()) return;
	workThisWindow.set(name, (workThisWindow.get(name) ?? 0) + 1);
}

/**
 * How long the synchronous body of one coalesced work callback took.
 *
 * `recordInteractionWork` only counts invocations, which cannot tell "the drag
 * runs 60 times a second" from "the drag burns 30ms each time". Mean and max
 * here separate a cheap-but-frequent pipeline from an expensive one — and a
 * mean that sits far below max points at intermittent GC, not steady work.
 */
export function recordInteractionDuration({
	name,
	durationMs,
}: {
	name: string;
	durationMs: number;
}): void {
	if (!isInteractionPerfEnabled()) return;
	const stats = durationThisWindow.get(name) ?? { total: 0, max: 0, count: 0 };
	stats.total += durationMs;
	stats.count += 1;
	if (durationMs > stats.max) stats.max = durationMs;
	durationThisWindow.set(name, stats);
}

/**
 * Times the synchronous body of one coalesced work callback.
 * Mirrors `measureSpanSync` in `render-perf.ts`: the timing calls themselves
 * are skipped entirely while the flag is off.
 */
export function measureInteraction<T>({
	name,
	fn,
}: {
	name: string;
	fn: () => T;
}): T {
	if (!isInteractionPerfEnabled()) return fn();
	const start = performance.now();
	try {
		return fn();
	} finally {
		recordInteractionDuration({ name, durationMs: performance.now() - start });
	}
}

export function recordLongTask({ durationMs }: { durationMs: number }): void {
	if (!isInteractionPerfEnabled()) return;
	longTasksThisWindow.push(durationMs);
	totalLongTasks += 1;
	if (durationMs > worstLongTaskMs) worstLongTaskMs = durationMs;
}

function flushWindow(): void {
	if (!isInteractionPerfEnabled()) {
		movesThisWindow = 0;
		workThisWindow.clear();
		return;
	}

	const rows: Array<Record<string, number | string>> = [];
	for (const [name, count] of workThisWindow) {
		const total = (workTotals.get(name) ?? 0) + count;
		workTotals.set(name, total);
		const durations = durationThisWindow.get(name);
		rows.push({
			pipeline: name,
			"moves/s": movesThisWindow,
			"work/s": count,
			perMove: +(count / Math.max(1, movesThisWindow)).toFixed(3),
			meanMs: durations
				? +(durations.total / Math.max(1, durations.count)).toFixed(2)
				: 0,
			maxMs: durations ? +durations.max.toFixed(2) : 0,
			"total work": total,
		});
	}

	if (rows.length > 0 || movesThisWindow > 0) {
		const windowLongTasks = longTasksThisWindow.length;
		const windowWorst = longTasksThisWindow.reduce((a, b) => Math.max(a, b), 0);
		console.groupCollapsed(
			`[interaction-perf] ${movesThisWindow} moves/s · ${windowLongTasks} long task(s) · worst ${windowWorst.toFixed(1)}ms`,
		);
		if (rows.length > 0) console.table(rows);
		console.table([
			{
				longTasksTotal: totalLongTasks,
				worstLongTaskMs: +worstLongTaskMs.toFixed(1),
			},
		]);
		console.groupEnd();
	}

	movesThisWindow = 0;
	workThisWindow.clear();
	durationThisWindow.clear();
	longTasksThisWindow = [];
}

/**
 * Installs the counters. Safe to call once per editor mount; returns a cleanup
 * that removes every listener it registered.
 */
export function installInteractionPerf(): () => void {
	if (typeof window === "undefined") return () => {};

	const handlePointerMove = () => {
		recordPointerMove();
	};
	document.addEventListener("pointermove", handlePointerMove, {
		passive: true,
	});

	let observer: PerformanceObserver | null = null;
	try {
		observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				recordLongTask({ durationMs: entry.duration });
			}
		});
		observer.observe({ entryTypes: ["longtask"] });
	} catch {
		// `longtask` is unsupported in some browsers; pointer/work counters still work.
		observer = null;
	}

	const intervalId = window.setInterval(flushWindow, FLUSH_INTERVAL_MS);

	window.__interactionPerfReset = () => {
		movesThisWindow = 0;
		longTasksThisWindow = [];
		totalLongTasks = 0;
		worstLongTaskMs = 0;
		workThisWindow.clear();
		workTotals.clear();
		durationThisWindow.clear();
	};

	return () => {
		document.removeEventListener("pointermove", handlePointerMove);
		observer?.disconnect();
		window.clearInterval(intervalId);
		delete window.__interactionPerfReset;
	};
}
