/**
 * Store fan-out profiler — "who did this one notify wake up, and how much did
 * it cost to find out?"
 *
 * The editor keeps a single `useEditor(selector)` hook that subscribes to NINE
 * managers at once (playback / timeline / scenes / project / media / renderer /
 * selection / clipboard / diagnostics). Every `notify()` therefore wakes EVERY
 * mounted selector in the app. A selector that returns a fresh object (or array
 * of fresh objects) fails the snapshot identity check and forces a re-render,
 * even when the change had nothing to do with that component.
 *
 * `__renderPerf` measures the compositor; it is blind to this. This probe
 * measures the React side:
 *
 *   window.__editorFanout = true      // enable
 *   window.__editorFanoutDump()       // console.table of per-manager stats
 *   window.__editorFanoutReset()      // clear counters
 *
 * Columns:
 *   wakes     – selectors that ran because of this manager
 *   changed   – of those, how many produced a NEW snapshot (⇒ will re-render)
 *   selector  – total ms spent running selectors (JS only, not commit)
 *   maxSel    – worst single selector
 *
 * Reading it: `changed` ≈ how many components React will re-render for one
 * notify of that manager. Compare `wakes` to `changed` — a healthy ratio is
 * single-digit percent. Selection waking hundreds of selectors and changing
 * dozens of them is the signature of "click a clip → whole timeline recommits".
 */

type SourceStat = {
	wakes: number;
	changed: number;
	selectorMs: number;
	maxSelectorMs: number;
};

/**
 * Per-CALL-SITE breakdown.
 *
 * The per-manager table answers "how many subscribers did this wake". It cannot
 * answer "which ones actually re-rendered", and that is the number that costs
 * money — a `changed` count of 400 could be 400 cheap pills or 40 properties
 * panels. This groups by the selector's own source text, which is stable per
 * call site (an inline arrow's `toString()` is identical every render) and
 * readable in the dump. Two sites that literally share the same text merge into
 * one row, which is itself useful: it says "N components share this selector".
 */
type SiteStat = {
	source: string;
	site: string;
	wakes: number;
	changed: number;
};

type WindowWithFanout = Window & {
	__editorFanout?: boolean;
	__editorFanoutDump?: () => void;
	__editorFanoutReset?: () => void;
};

const stats = new Map<string, SourceStat>();
const siteStats = new Map<string, SiteStat>();

/**
 * How many `useEditor(selector)` subscriptions are mounted right now.
 *
 * This is the divisor the per-manager table was missing. `wakes` is
 * per-subscription-per-notify, so without the mount count a report like
 * "timeline: 6864 wakes" cannot be read as a rate — 6864 could be 44 notifies
 * over 156 subscribers or 132 notifies over 52. Every candidate divisor of the
 * observed numbers is arithmetically valid, which is exactly why guessing is
 * not allowed here. Counting mounts turns `wakes` into `notifies` exactly.
 */
let mountedSubscriptions = 0;

/** Sampling window, so `wakes` can be expressed per second. */
let windowStartMs: number | null = null;
let windowEndMs = 0;

export function registerStoreSubscription(): () => void {
	mountedSubscriptions += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		mountedSubscriptions -= 1;
	};
}

export function getMountedSubscriptionCount(): number {
	return mountedSubscriptions;
}

let hooked = false;

export function isStoreFanoutEnabled(): boolean {
	if (typeof window === "undefined") return false;
	return (window as WindowWithFanout).__editorFanout === true;
}

function hookConsoleApi(): void {
	if (hooked || typeof window === "undefined") return;
	hooked = true;
	const target = window as WindowWithFanout;
	target.__editorFanoutDump = () => {
		dumpStoreFanout();
	};
	target.__editorFanoutReset = () => {
		stats.clear();
		siteStats.clear();
		windowStartMs = null;
		windowEndMs = 0;
	};
}

export function recordStoreWake({
	source,
	changed,
	selectorMs,
	site,
}: {
	source: string;
	changed: boolean;
	selectorMs: number;
	/** Selector source text, resolved once per hook instance. Optional. */
	site?: string;
}): void {
	hookConsoleApi();

	const now = performance.now();
	if (windowStartMs === null) windowStartMs = now;
	windowEndMs = now;

	let entry = stats.get(source);
	if (!entry) {
		entry = { wakes: 0, changed: 0, selectorMs: 0, maxSelectorMs: 0 };
		stats.set(source, entry);
	}
	entry.wakes += 1;
	if (changed) entry.changed += 1;
	entry.selectorMs += selectorMs;
	if (selectorMs > entry.maxSelectorMs) entry.maxSelectorMs = selectorMs;

	if (!site) return;
	const key = `${source}\u0000${site}`;
	let siteEntry = siteStats.get(key);
	if (!siteEntry) {
		siteEntry = { source, site, wakes: 0, changed: 0 };
		siteStats.set(key, siteEntry);
	}
	siteEntry.wakes += 1;
	if (changed) siteEntry.changed += 1;
}

export function dumpStoreFanout(): void {
	if (stats.size === 0) {
		console.info(
			"[fanout] no samples yet — set window.__editorFanout = true, interact, then call again",
		);
		return;
	}

	const mounts = Math.max(1, mountedSubscriptions);
	const windowMs = windowEndMs - (windowStartMs ?? windowEndMs);
	const windowSeconds = windowMs > 0 ? windowMs / 1000 : 0;
	console.info(
		`[fanout] ${mountedSubscriptions} mounted subscription(s) · sampled ${windowSeconds.toFixed(2)}s · 每次 notify 会唤醒 ${mounts} 次`,
	);

	const rows = [...stats.entries()]
		.map(([source, entry]) => ({
			manager: source,
			wakes: entry.wakes,
			notifies: Math.round(entry.wakes / mounts),
			"per s": windowSeconds > 0
				? Number((entry.wakes / mounts / windowSeconds).toFixed(1))
				: 0,
			changed: entry.changed,
			"changed%": entry.wakes
				? `${((entry.changed / entry.wakes) * 100).toFixed(1)}%`
				: "0%",
			"selector ms": Number(entry.selectorMs.toFixed(1)),
			"max sel ms": Number(entry.maxSelectorMs.toFixed(2)),
			"ms/notify": Number((entry.selectorMs / entry.wakes).toFixed(3)),
		}))
		.sort((a, b) => b["selector ms"] - a["selector ms"]);

	console.table(rows);

	if (siteStats.size === 0) {
		console.info(
			"[fanout] per-site breakdown unavailable — this page load predates it, or no selector produced a new snapshot.",
		);
		return;
	}

	const siteRows = [...siteStats.values()]
		.filter((entry) => entry.changed > 0)
		.sort((a, b) => b.changed - a.changed)
		.slice(0, 15)
		.map((entry) => ({
			manager: entry.source,
			changed: entry.changed,
			wakes: entry.wakes,
			"changed%": `${((entry.changed / entry.wakes) * 100).toFixed(0)}%`,
			selector: entry.site,
		}));

	if (siteRows.length === 0) {
		console.info("[fanout] no selector changed its snapshot — nothing re-rendered.");
		return;
	}
	console.info(
		"[fanout] top selector call sites that produced a NEW snapshot (⇒ re-rendered):",
	);
	console.table(siteRows);
}

// Install the console helpers at import time so `window.__editorFanout = true;
// window.__editorFanoutDump()` works without waiting for the first notify.
if (typeof window !== "undefined") {
	hookConsoleApi();
}
