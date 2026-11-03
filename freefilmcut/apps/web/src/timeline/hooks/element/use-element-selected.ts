import { useEditor } from "@/editor/use-editor";
import type { ElementRef } from "@/timeline/types";

/**
 * Per-element selection subscriptions.
 *
 * `useElementSelection()` subscribes to the whole `selectedElements` array, so
 * every consumer re-renders whenever the selection changes at all — with one
 * consumer per timeline clip, clicking a single clip used to recommit the
 * entire timeline (~50-100 ms on a large project).
 *
 * These hooks subscribe to a **primitive** instead. `useEditor`'s snapshot
 * cache compares primitives with `Object.is`, so:
 *
 *   - clicking clip B while A was selected → A goes true→false, B false→true,
 *     the other N-2 clips compare `false === false` and do not re-render;
 *   - any non-selection notify (param edit, playback, project) → `false ===
 *     false` again, so clips are no longer dragged into those commits either.
 *
 * Use the array-returning hook only where the full list is genuinely needed
 * (panels, multi-select actions, overlays).
 */
export function useElementSelected({
	trackId,
	elementId,
}: ElementRef): boolean {
	return useEditor((e) => e.selection.isElementSelected({ trackId, elementId }));
}

export function useMultipleElementsSelected(): boolean {
	return useEditor((e) => e.selection.hasMultipleElementsSelected());
}

export function useSelectedElementCount(): number {
	return useEditor((e) => e.selection.getSelectedElementCount());
}

/**
 * "Which tracks hold a selected element", as a primitive key. Track rows use it
 * for the row highlight only; a string means selecting a different clip on the
 * same track does not re-render the rows (and therefore not every clip inside
 * them).
 */
export function useSelectedTrackIdsKey(): string {
	return useEditor((e) => e.selection.getSelectedTrackIdsKey());
}
