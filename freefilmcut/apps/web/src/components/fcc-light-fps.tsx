"use client";

import { useEffect } from "react";
import { useDiagSettings } from "@/diagnostics/diag-settings";
import {
	clearPerfPhaseMarks,
	readPerfSpans,
	type PerfPhase,
} from "@/utils/perf-mark";

/**
 * Attributes every long task inside a window to the phase it overlapped.
 *
 * `longtask` alone only says "110ms of main thread was blocked". Between
 * pressing space and the first moving picture there are four places it can
 * live, with completely different fixes:
 *
 *   play:call      → listener fan-out / React commit (9 store notifications)
 *   audio:resume   → AudioContext resume + collectAudioClips
 *   compose:sync   → shader compile / texImage2D / render-target realloc
 *   compose        → async tail of one compose (awaited node resolution)
 *   (none)         → layout / paint / GC, i.e. outside our JS entirely
 *
 * Console: `await __fccPlayTrace({ ms: 6000 })` then press space.
 */
async function playTrace({ ms = 6000 }: { ms?: number } = {}): Promise<unknown> {
	clearPerfPhaseMarks();
	const tasks: Array<{ start: number; duration: number }> = [];
	let observer: PerformanceObserver | null = null;
	try {
		observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				tasks.push({ start: entry.startTime, duration: entry.duration });
			}
		});
		observer.observe({ entryTypes: ["longtask"] });
	} catch {
		return { error: "longtask observer unavailable" };
	}

	const since = performance.now();
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
	observer.disconnect();

	const spans = readPerfSpans({ since });
	const spanRows = spans.map((span) => ({
		phase: span.name,
		startMs: Number((span.start - since).toFixed(0)),
		durMs: Number(((span.end ?? performance.now()) - span.start).toFixed(1)),
		open: span.end === null,
	}));

	const rows = tasks.map((task, index) => {
		const taskEnd = task.start + task.duration;
		const overlapped = spans
			.filter((span) => {
				const end = span.end ?? performance.now();
				return span.start < taskEnd && end > task.start;
			})
			.map((span) => span.name as PerfPhase);
		// Prefer the narrowest overlapping phase: when `compose:sync` and
		// `compose` both overlap, the block is inside the synchronous head, which
		// is the actionable answer.
		let phase = overlapped.includes("compose:sync")
			? "compose:sync"
			: overlapped.includes("play:call")
				? "play:call"
				: overlapped.includes("audio:resume")
					? "audio:resume"
					: overlapped.includes("compose")
						? "compose"
						: "outside-js";
		if (phase === "compose" && overlapped.includes("compose:sync")) {
			phase = "compose:sync";
		}
		return {
			task: index + 1,
			startMs: Number((task.start - since).toFixed(0)),
			durMs: Number(task.duration.toFixed(1)),
			phase,
		};
	});

	const worst = rows.reduce<typeof rows[number] | null>(
		(best, row) => (best === null || row.durMs > best.durMs ? row : best),
		null,
	);

	const verdict = worst
		? {
				longestMs: worst.durMs,
				atPhase: worst.phase,
				hint:
					worst.phase === "compose:sync"
						? "阻塞在合成的同步头部：shader 首次编译 / 纹理上传 / RT 重建"
						: worst.phase === "compose"
							? "阻塞在合成的异步尾部：逐节点 await 串行解析"
							: worst.phase === "audio:resume"
								? "阻塞在音频：AudioContext.resume 或 collectAudioClips"
								: worst.phase === "play:call"
									? "阻塞在 play() 的监听器扇出 / React 提交"
									: "阻塞在 JS 之外：layout / paint / GC",
			}
		: { longestMs: 0, atPhase: "none", hint: "窗口内没有长任务" };

	const result = { windowMs: ms, tasks: rows, spans: spanRows, verdict };
	// Dev-only probe: printing is the whole point.
	console.table(rows);
	console.log("[fcc] phase spans", spanRows);
	console.log("[fcc] verdict", verdict);
	return result;
}

declare global {
	interface Window {
		/** Dev-only: attribute play-start long tasks to a phase. */
		__fccPlayTrace?: (opts?: { ms?: number }) => Promise<unknown>;
	}
}

/**
 * Dev-only lightweight FPS overlay (rAF counter). Does not instrument React.
 *
 * Reads out four things that must be separated before any fix makes sense:
 *   FPS / frameMs   — average rAF cadence.
 *   vsync / drops   — the display's real refresh period, and how many frames
 *                     the browser missed relative to it. A "40fps" reading is
 *                     either a 48Hz display (drops = 0) or a 60Hz display
 *                     dropping a quarter of its frames (drops > 0). Those two
 *                     have opposite fixes, so never read FPS alone.
 *   histogram       — Rounded gap multiples. Single bucket at 1x = the display
 *                     is not running at 60Hz. Split across 1x/2x/3x = the page
 *                     is missing vsyncs.
 *   longtask        — Main-thread blocking. 0 means the stall is downstream of
 *                     JS: paint / composite / GPU / window composition.
 *
 * Visibility is owned by the settings panel (Settings → Developer), not by a
 * `localStorage` key you have to edit by hand. The switch is read through a
 * store, so turning it off tears the DOM node and the rAF loop down
 * immediately — the meter costs nothing while it is hidden.
 */
export function FccLightFps() {
	const { perfOverlay } = useDiagSettings();

	// The trace probe is a console tool, not part of the overlay: hiding the
	// meter must not remove it. Dev-only, because every span it reads is a
	// no-op outside development.
	useEffect(() => {
		if (window.__fccPlayTrace) return;
		window.__fccPlayTrace = playTrace;
	}, []);

	useEffect(() => {
		if (!perfOverlay) return;

		const existing = document.getElementById("fcc-light-fps");
		if (existing) existing.remove();

		const el = document.createElement("div");
		el.id = "fcc-light-fps";
		el.setAttribute("data-fcc-fps", "light");
		el.style.cssText = [
			"position:fixed",
			"left:12px",
			"bottom:12px",
			"z-index:2147483647",
			"background:rgba(0,0,0,0.85)",
			"color:#7CFF9A",
			"font:13px/1.4 ui-monospace,Menlo,Consolas,monospace",
			"padding:8px 12px",
			"border-radius:8px",
			"pointer-events:none",
			"white-space:pre",
			"box-shadow:0 2px 8px rgba(0,0,0,0.45)",
			"border:1px solid rgba(124,255,154,0.35)",
		].join(";");
		el.textContent = "FPS --\nlight meter";
		document.body.appendChild(el);

		const WINDOW_MS = 1000;
		let frames = 0;
		let last = performance.now();
		let previousFrame = last;
		let longestGap = 0;
		/** Gaps within the current window, used to infer the refresh period. */
		let gaps: number[] = [];
		let longTasks = 0;
		let longestTask = 0;
		let raf = 0;

		// Long tasks answer "is the main thread busy?" independently of rAF cadence.
		// Without this, a dropped frame and a browser-throttled display look identical.
		let observer: PerformanceObserver | null = null;
		try {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks += 1;
					if (entry.duration > longestTask) longestTask = entry.duration;
				}
			});
			observer.observe({ entryTypes: ["longtask"] });
		} catch {
			observer = null;
		}

		/**
		 * Sticky floor for the refresh period, in ms. 0 = not established yet.
		 *
		 * The mode alone is not enough. When every frame misses its vsync, the
		 * gap doubles and 2x becomes the mode — so a 60Hz display that is
		 * consistently 30fps gets relabelled "30Hz" and reports `drops 0%`.
		 * That reads as "the display is 30Hz, nothing is wrong", which is the
		 * opposite of the truth: it means every frame is 45% over budget.
		 *
		 * Only a *well-represented* shorter period may lower the floor, so a
		 * single scheduler hiccup cannot inflate the drop count, and a genuine
		 * 30Hz panel (which never produces 16.7ms gaps) keeps a 33ms floor.
		 */
		let vsyncFloor = 0;
		const MIN_STABLE_SAMPLES = 5;

		/**
		 * Refresh period estimate: the mode, lowered by any smaller stable bin.
		 * Prefers evidence of a faster refresh over the current cadence, because
		 * cadence is exactly what we are trying to measure.
		 */
		const estimateVsync = (samples: number[]): number => {
			const bins = new Map<number, number>();
			for (const gap of samples) {
				const bin = Math.round(gap * 2) / 2;
				bins.set(bin, (bins.get(bin) ?? 0) + 1);
			}
			let mode = 0;
			let modeCount = 0;
			let smallestStable = Number.POSITIVE_INFINITY;
			for (const [bin, count] of bins) {
				if (count > modeCount) {
					mode = bin;
					modeCount = count;
				}
				if (count >= MIN_STABLE_SAMPLES && bin < smallestStable) {
					smallestStable = bin;
				}
			}
			const candidate =
				smallestStable === Number.POSITIVE_INFINITY
					? mode
					: Math.min(mode, smallestStable);
			if (vsyncFloor === 0 || candidate < vsyncFloor) {
				vsyncFloor = candidate;
			}
			return vsyncFloor;
		};

		const tick = (t: number) => {
			frames++;
			const gap = t - previousFrame;
			previousFrame = t;
			if (gap > 0 && gap < 1000) {
				if (gap > longestGap) longestGap = gap;
				gaps.push(gap);
			}

			if (t - last >= WINDOW_MS) {
				const elapsed = t - last;
				const fps = Math.round((frames * 1000) / elapsed);
				const frameMs = elapsed / frames;
				const vsync = estimateVsync(gaps) || frameMs;

				let drops = 0;
				const hist = new Map<number, number>();
				for (const gap of gaps) {
					const multiple = Math.min(9, Math.max(1, Math.round(gap / vsync)));
					hist.set(multiple, (hist.get(multiple) ?? 0) + 1);
					drops += multiple - 1;
				}
				const total = gaps.length;
				const dropPct = total > 0 ? Math.round((drops / (total + drops)) * 100) : 0;

				const histText = [...hist.entries()]
					.sort((a, b) => a[0] - b[0])
					.map(([multiple, count]) => `${multiple}x ${count}`)
					.join("  ");

				let scanOn = false;
				try {
					scanOn = localStorage.getItem("fccReactScan") === "1";
				} catch {
					/* ignore */
				}

				const focused = document.hasFocus() && document.visibilityState === "visible";

				// A <video> that is still decoding composites a new frame every vsync
				// and can drag the whole page off the 60Hz grid without ever producing
				// a long task. This app creates video elements for pack previews, so
				// surface the count instead of making it a guess.
				const videos = document.querySelectorAll("video");
				let playingVideos = 0;
				for (const video of videos) {
					if (!video.paused && !video.ended && video.readyState > 2) {
						playingVideos += 1;
					}
				}

				const lines = [
					`FPS ${fps}  ${frameMs.toFixed(1)}ms`,
					`vsync ${vsync.toFixed(1)}ms  drops ${dropPct}%`,
					`${histText}  max ${longestGap.toFixed(0)}ms`,
					`longtask ${longTasks}/${longestTask.toFixed(0)}ms` +
						(focused ? "" : "  !unfocused"),
				];

				// Splits the window's compose cost into its blocking head vs total.
				// A 110ms `sync` is shader compile / texture upload (a one-off you
				// can pre-warm); a 110ms `total` with small `sync` is the async node
				// walk (a structural fix). No data in the window => omit the line.
				const windowSpans = readPerfSpans({ since: last, until: t });
				let syncMax = 0;
				let composeMax = 0;
				for (const span of windowSpans) {
					const dur = (span.end ?? t) - span.start;
					if (span.name === "compose:sync" && dur > syncMax) syncMax = dur;
					if (span.name === "compose" && dur > composeMax) composeMax = dur;
				}
				if (composeMax > 0) {
					// Over-budget compose is the whole story once drops are steady:
					// a frame that costs more than one refresh period can only ever
					// land on the next vsync, so the page locks to half rate while
					// still reporting "0 drops" against its own cadence.
					lines.push(
						`compose sync ${syncMax.toFixed(0)}ms  total ${composeMax.toFixed(0)}ms` +
							(composeMax > vsync ? `  > budget ${vsync.toFixed(1)}` : ""),
					);
				}

				if (videos.length > 0) {
					lines.push(`video ${playingVideos}/${videos.length} playing`);
				}
				lines.push(scanOn ? "light meter (+ react-scan ON)" : "light meter");
				el.textContent = lines.join("\n");
				el.style.color = fps >= 55 ? "#7CFF9A" : fps >= 40 ? "#FFD27C" : "#FF8A8A";
				frames = 0;
				longestGap = 0;
				gaps = [];
				longTasks = 0;
				longestTask = 0;
				last = t;
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(raf);
			observer?.disconnect();
			el.remove();
		};
	}, [perfOverlay]);

	return null;
}
