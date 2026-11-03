"use client";

import { useSyncExternalStore } from "react";

/**
 * Local-only, reload-free switches for the in-app performance instruments.
 *
 * These are deliberately **not** project settings: none of it belongs in a
 * `.fcc` file that gets shared with a collaborator, and none of it changes what
 * the timeline renders. They live in `localStorage` and are exposed through a
 * minimal observable, so flipping a switch in the settings panel takes effect
 * immediately — no reload, no console command.
 *
 * Defaults are dev-friendly: the overlay is on in development (it used to be
 * unconditional there) and off in production, where a stray overlay would ship
 * to users. Either switch can be flipped per machine.
 */

export type DiagSettings = {
	/** Bottom-left FPS / vsync / compose overlay. */
	perfOverlay: boolean;
	/**
	 * Per-stage compose timings, dumped to the console every 60 frames.
	 *
	 * Mirrors `window.__renderPerf`, which predates this panel — a manual
	 * assignment from the devtools console still works for the current page
	 * load, it just is not written back into the panel.
	 */
	renderProfiler: boolean;
};

const STORAGE_KEY = "fccDiag";

/** The overlay's older opt-out key, honoured once on migration. */
const LEGACY_OVERLAY_KEY = "fccFps";

const DEFAULTS: DiagSettings = {
	perfOverlay: process.env.NODE_ENV === "development",
	renderProfiler: false,
};

/**
 * Written out literally so the loop below can stay assertion-free —
 * `Object.keys()` would erase the key type.
 */
const SETTING_KEYS: Array<keyof DiagSettings> = ["perfOverlay", "renderProfiler"];

const listeners = new Set<() => void>();

/**
 * `null` until the first read. Kept lazy so importing this module during SSR
 * never touches `localStorage`, and so `getServerSnapshot` can hand back the
 * pristine defaults while the client hydrates with the stored values.
 */
let state: DiagSettings | null = null;

function parseStoredFlags({ raw }: { raw: string | null }): Partial<DiagSettings> {
	const flags: Partial<DiagSettings> = {};
	if (!raw) return flags;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return flags;
	}
	if (typeof parsed !== "object" || parsed === null) return flags;
	for (const key of SETTING_KEYS) {
		// `Reflect.get` keeps this honest without an `as` narrowing: the value
		// stays `unknown` until the `typeof` guard proves it is a boolean.
		const value: unknown = Reflect.get(parsed, key);
		if (typeof value === "boolean") flags[key] = value;
	}
	return flags;
}

function readLegacyOverlayChoice(): boolean | null {
	// The overlay used to be hidden with `localStorage.fccFps = "0"`. Honour
	// that decision once, then never look at the key again — otherwise a stale
	// value would keep overriding the panel.
	try {
		const legacy = window.localStorage.getItem(LEGACY_OVERLAY_KEY);
		if (legacy === null) return null;
		return legacy !== "0";
	} catch {
		return null;
	}
}

function load(): DiagSettings {
	if (typeof window === "undefined") return { ...DEFAULTS };
	let raw: string | null = null;
	try {
		raw = window.localStorage.getItem(STORAGE_KEY);
	} catch {
		return { ...DEFAULTS };
	}
	const stored = parseStoredFlags({ raw });
	const next: DiagSettings = { ...DEFAULTS, ...stored };
	if (stored.perfOverlay === undefined) {
		const legacy = readLegacyOverlayChoice();
		if (legacy !== null) next.perfOverlay = legacy;
	}
	return next;
}

/**
 * The profiler is reached through a pre-existing global, so the switch has to
 * be mirrored onto it. Doing that here — rather than in a component — keeps the
 * two from drifting, because this module is the only writer of the setting.
 */
function applyRuntimeFlags({ settings }: { settings: DiagSettings }): void {
	if (typeof window === "undefined") return;
	window.__renderPerf = settings.renderProfiler;
}

function persist({ settings }: { settings: DiagSettings }): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		/* private mode / quota: the toggle still works for this page load */
	}
}

function initialize(): DiagSettings {
	if (state) return state;
	state = load();
	// Must happen before the first compose, which is why it lives in the
	// initializer instead of an effect.
	applyRuntimeFlags({ settings: state });
	return state;
}

export function getDiagSettings(): DiagSettings {
	return initialize();
}

function getServerDiagSettings(): DiagSettings {
	return DEFAULTS;
}

function subscribeDiagSettings(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function setDiagSettings({ patch }: { patch: Partial<DiagSettings> }): void {
	const current = initialize();
	const next: DiagSettings = { ...current, ...patch };
	if (
		next.perfOverlay === current.perfOverlay &&
		next.renderProfiler === current.renderProfiler
	) {
		return;
	}
	state = next;
	applyRuntimeFlags({ settings: next });
	persist({ settings: next });
	for (const listener of listeners) listener();
}

/**
 * Subscribes a component to the switches. The snapshot is the stored object
 * itself, so its identity only changes on a real edit — which is exactly what
 * `useSyncExternalStore` requires to avoid re-rendering every frame.
 */
export function useDiagSettings(): DiagSettings {
	return useSyncExternalStore(
		subscribeDiagSettings,
		getDiagSettings,
		getServerDiagSettings,
	);
}
