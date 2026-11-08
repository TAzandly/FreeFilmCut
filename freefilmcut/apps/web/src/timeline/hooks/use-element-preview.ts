import { useEffect, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { pushLiveElementPreview } from "@/preview/push-live-element-preview";
import { onLiveParamPreviewElement } from "@/preview/live-param-preview";
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
	const storeElement = useEditor((e) => {
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
	 * Live param scrub skips timeline notify, so useEditor above would freeze.
	 * Re-read the silent overlay when this element is touched.
	 */
	const [liveElement, setLiveElement] = useState<T | null>(null);
	useEffect(() => {
		setLiveElement(null);
	}, [storeElement]);
	useEffect(() => {
		return onLiveParamPreviewElement((elementIds) => {
			if (!elementIds.has(elementId)) return;
			const tracks = editor.timeline.getPreviewTracks();
			if (!tracks) return;
			const track = findTrackInSceneTracks({ tracks, trackId });
			const next = track?.elements.find((element) => element.id === elementId) as
				| T
				| undefined;
			if (next) setLiveElement(next);
		});
	}, [editor.timeline, trackId, elementId]);

	const renderElement = liveElement ?? storeElement;

	/**
	 * One preview write per frame — see use-coalesced-preview.ts. Callers hand in
	 * complete sub-objects (`params: {...current, ...patch}`), so keeping only
	 * the latest write is equivalent to keeping all of them, minus the 2–16
	 * redundant full-editor commits per frame.
	 */
	const { push: previewUpdates, flush: flushPreview } =
		useCoalescedPreview<Partial<TimelineElement>>({
			apply: (updates) =>
				pushLiveElementPreview({
					previewElements: (args) => editor.timeline.previewElements(args),
					getPreviewElement: () => {
						const tracks = editor.timeline.getPreviewTracks();
						if (!tracks) return null;
						const track = findTrackInSceneTracks({ tracks, trackId });
						return track?.elements.find((element) => element.id === elementId);
					},
					trackId,
					elementId,
					updates,
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
