import { useEditor } from "@/editor/use-editor";
import { findTrackInSceneTracks, type TimelineElement } from "@/timeline";
import { useCoalescedPreview } from "@/timeline/hooks/use-coalesced-preview";

/**
 * Subscribes to the live (preview-aware) version of ONE element and returns it
 * alongside helpers for previewing and committing updates.
 *
 * Use this wherever property fields need to reflect in-progress preview state
 * (e.g. a slider being dragged) rather than the last committed value.
 */
export function useElementPreview<T extends TimelineElement>({
	trackId,
	elementId,
	fallback,
}: {
	trackId: string;
	elementId: string;
	fallback: T;
}) {
	const editor = useEditor();
	/**
	 * Subscribe to THIS element, not the whole track tree.
	 *
	 * `getPreviewTracks()` installs a brand new tree object on every preview
	 * frame, so a tree-level selector made every mounted clip re-render during
	 * any drag (one clip dragged → N clips re-rendered). Element identities are
	 * stable unless that element's own overlay changed, so untouched clips now
	 * hit `Object.is` in useEditor's snapshot cache and stay put.
	 */
	const renderElement = useEditor((e) => {
		const tracks =
			e.timeline.getPreviewTracks() ??
			e.scenes.getActiveSceneOrNull()?.tracks ??
			null;
		if (!tracks) return fallback;
		const track = findTrackInSceneTracks({ tracks, trackId });
		return (
			(track?.elements.find((element) => element.id === elementId) as
				| T
				| undefined) ?? fallback
		);
	});

	/**
	 * One preview write per frame — see use-coalesced-preview.ts. Callers hand in
	 * complete sub-objects (`params: {...current, ...patch}`), so keeping only
	 * the latest write is equivalent to keeping all of them, minus the 2–16
	 * redundant full-editor commits per frame.
	 */
	const { push: previewUpdates, flush: flushPreview } =
		useCoalescedPreview<Partial<TimelineElement>>({
			apply: (updates) =>
				editor.timeline.previewElements({
					updates: [{ trackId, elementId, updates }],
				}),
		});

	const commit = () => {
		// Never let commitPreview() run ahead of a queued write: it turns the
		// overlay into a real edit and the queued value would be dropped.
		flushPreview();
		editor.timeline.commitPreview();
	};

	return { renderElement, previewUpdates, commit };
}
