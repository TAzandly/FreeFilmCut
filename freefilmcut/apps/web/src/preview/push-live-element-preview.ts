import type { TimelineElement } from "@/timeline";
import {
	applyLiveParamPreview,
	hasLiveParamPreviewElement,
} from "./live-param-preview";

/**
 * Property scrub write: keep a silent overlay for commit, patch scene nodes,
 * wake compose — skip React timeline notify when the clip is in the preview
 * scene cache.
 */
export function pushLiveElementPreview({
	previewElements,
	getPreviewElement,
	trackId,
	elementId,
	updates,
}: {
	previewElements: (args: {
		updates: readonly {
			trackId: string;
			elementId: string;
			updates: Partial<TimelineElement>;
		}[];
		notify?: boolean;
		forceNotify?: boolean;
	}) => void;
	getPreviewElement: () => TimelineElement | null | undefined;
	trackId: string;
	elementId: string;
	updates: Partial<TimelineElement>;
}): void {
	const canLive = hasLiveParamPreviewElement({ elementId });

	previewElements({
		updates: [{ trackId, elementId, updates }],
		notify: !canLive,
	});

	if (!canLive) return;

	const element = getPreviewElement();
	if (element && applyLiveParamPreview({ element })) {
		return;
	}

	// Cache miss / unbind race — wake React so UI/preview still move.
	previewElements({
		updates: [{ trackId, elementId, updates }],
		notify: true,
		forceNotify: true,
	});
}
