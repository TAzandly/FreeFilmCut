import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { EditorCore } from "@/core";
import {
	isStoreFanoutEnabled,
	recordStoreWake,
	registerStoreSubscription,
} from "@/diagnostics/store-fanout";

const SNAPSHOT_UNSET = Symbol("snapshotUnset");

function isShallowEqual({
	a,
	b,
}: {
	a: unknown;
	b: unknown;
}): boolean {
	if (Object.is(a, b)) return true;
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	if (a.length !== b.length) return false;
	return a.every((item, i) => Object.is(item, b[i]));
}

const subscribeNone = () => () => {};

export function useEditor(): EditorCore;
export function useEditor<T>(selector: (editor: EditorCore) => T): T;
export function useEditor<T>(
	selector?: (editor: EditorCore) => T,
): EditorCore | T {
	const editor = useMemo(() => EditorCore.getInstance(), []);
	const snapshotCacheRef = useRef<T | typeof SNAPSHOT_UNSET>(SNAPSHOT_UNSET);
	/**
	 * `subscribeAll` is memoised on `[editor]`, but the selector is an inline
	 * arrow in nearly every call site — a new function per render. The
	 * subscription therefore has to read it through a ref, or it would keep
	 * running the selector from the very first render forever.
	 */
	const selectorRef = useRef(selector);
	useEffect(() => {
		selectorRef.current = selector;
	}, [selector]);

	const subscribeAll = useCallback(
		(onChange: () => void) => {
			/**
			 * Counted even while the probe is off (one integer, no allocation).
			 * The dump needs the divisor to turn `wakes` into a notify count;
			 * the numbers in a report always have several valid divisors, so
			 * this cannot be recovered after the fact.
			 */
			const release = registerStoreSubscription();

			/**
			 * Selector source text, resolved lazily on the first wake and then
			 * cached for the component's lifetime.
			 *
			 * Lazy: a page load with the probe off must pay nothing. Cached:
			 * an inline arrow's `toString()` never changes, and calling it on
			 * every notify would cost more than the selector it is measuring.
			 * This is what lets the dump name the call sites that actually
			 * re-rendered instead of just counting them.
			 */
			let siteCache: string | null = null;
			const resolveSite = (): string => {
				if (siteCache !== null) return siteCache;
				const fn = selectorRef.current;
				if (!fn) {
					siteCache = "<whole editor>";
					return siteCache;
				}
				try {
					siteCache =
						String(fn).replace(/\s+/g, " ").trim().slice(0, 120) ||
						"<anonymous>";
				} catch {
					siteCache = "<unreadable selector>";
				}
				return siteCache;
			};

			/**
			 * Each manager gets its OWN callback so the fan-out probe can label
			 * the notify source. Without the label a spike just says "something
			 * notified"; with it we can say "selection woke 312 selectors".
			 *
			 * `subscribe` is passed as a closure, never as a detached method
			 * reference — the managers' `subscribe` implementations touch `this`.
			 */
			const bind = ({
				source,
				subscribe,
			}: {
				source: string;
				subscribe: (listener: () => void) => () => void;
			}) =>
				subscribe(() => {
					if (isStoreFanoutEnabled()) {
						const started = performance.now();
						const before = snapshotCacheRef.current;
						const current = selectorRef.current;
						const next = current ? current(editor) : editor;
						const selectorMs = performance.now() - started;
						/**
						 * Same predicate `getSnapshot` will apply a moment later,
						 * evaluated here without touching the cache so React's own
						 * pass below stays authoritative.
						 */
						const changed =
							before === SNAPSHOT_UNSET ||
							!isShallowEqual({ a: before, b: next });
						recordStoreWake({
						source,
						changed,
						selectorMs,
						site: resolveSite(),
					});
					}
					onChange();
				});

			const unsubscribers = [
				bind({ source: "playback", subscribe: (fn) => editor.playback.subscribe(fn) }),
				bind({ source: "timeline", subscribe: (fn) => editor.timeline.subscribe(fn) }),
				bind({ source: "scenes", subscribe: (fn) => editor.scenes.subscribe(fn) }),
				bind({ source: "project", subscribe: (fn) => editor.project.subscribe(fn) }),
				bind({ source: "media", subscribe: (fn) => editor.media.subscribe(fn) }),
				bind({ source: "renderer", subscribe: (fn) => editor.renderer.subscribe(fn) }),
				bind({ source: "selection", subscribe: (fn) => editor.selection.subscribe(fn) }),
				bind({ source: "clipboard", subscribe: (fn) => editor.clipboard.subscribe(fn) }),
				bind({
					source: "diagnostics",
					subscribe: (fn) => editor.diagnostics.subscribe(fn),
				}),
			];
			return () => {
				unsubscribers.forEach((unsubscribe) => {
					unsubscribe();
				});
				release();
			};
		},
		[editor],
	);

	const getSnapshot = useCallback((): EditorCore | T => {
		if (!selector) {
			return editor;
		}

		const next = selector(editor);
		if (
			snapshotCacheRef.current !== SNAPSHOT_UNSET &&
			isShallowEqual({
				a: snapshotCacheRef.current,
				b: next,
			})
		) {
			return snapshotCacheRef.current;
		}

		snapshotCacheRef.current = next;
		return next;
	}, [editor, selector]);

	return useSyncExternalStore(
		selector ? subscribeAll : subscribeNone,
		getSnapshot,
		getSnapshot,
	);
}
