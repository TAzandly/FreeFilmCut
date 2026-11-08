"use client";

import { useEditor } from "@/editor/use-editor";
import { useCoalescedPreview } from "@/timeline/hooks/use-coalesced-preview";
import {
	buildGraphicParamPath,
	getKeyframeAtTime,
	hasKeyframesForPath,
	upsertPathKeyframe,
} from "@/animation";
import type {
	AnimationPath,
	ElementAnimations,
} from "@/animation/types";
import { pushLiveElementPreview } from "@/preview/push-live-element-preview";
import {
	coerceParamValue,
	getParamChannelLayout,
	type ParamDefinition,
	type ParamValue,
} from "@/params";
import { findTrackInSceneTracks, type TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

export interface KeyframedParamPropertyResult {
	hasAnimatedKeyframes: boolean;
	isKeyframedAtTime: boolean;
	keyframeIdAtTime: string | null;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	toggleKeyframe: () => void;
}

export function useKeyframedParamProperty({
	param,
	trackId,
	elementId,
	animations,
	propertyPath,
	localTime,
	isPlayheadWithinElementRange,
	resolvedValue,
	buildBaseUpdates,
}: {
	param: ParamDefinition;
	trackId: string;
	elementId: string;
	animations: ElementAnimations | undefined;
	propertyPath?: AnimationPath;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
	resolvedValue: ParamValue;
	buildBaseUpdates: ({
		value,
	}: {
		value: ParamValue;
	}) => Partial<TimelineElement>;
}): KeyframedParamPropertyResult {
	const editor = useEditor();
	const resolvedPropertyPath =
		propertyPath ?? buildGraphicParamPath({ paramKey: param.key });
	const hasAnimatedKeyframes = hasKeyframesForPath({
		animations,
		propertyPath: resolvedPropertyPath,
	});
	const keyframeAtTime = isPlayheadWithinElementRange
		? getKeyframeAtTime({
				animations,
				propertyPath: resolvedPropertyPath,
				time: localTime,
			})
		: null;
	const keyframeIdAtTime = keyframeAtTime?.id ?? null;
	const isKeyframedAtTime = keyframeAtTime !== null;
	const shouldUseAnimatedChannel =
		hasAnimatedKeyframes && isPlayheadWithinElementRange;

	/** The actual write. Called at most once per frame by useCoalescedPreview. */
	const applyPreview: KeyframedParamPropertyResult["onPreview"] = (value) => {
		if (shouldUseAnimatedChannel) {
			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId,
						updates: {
							animations: upsertPathKeyframe({
								animations,
								propertyPath: resolvedPropertyPath,
								time: localTime,
								value,
								channelLayout: getParamChannelLayout({ param }),
								coerceValue: ({ value: nextValue }) =>
									coerceParamValue({
										param,
										value: nextValue,
									}),
							}),
						},
					},
				],
			});
			return;
		}

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
			updates: buildBaseUpdates({ value }),
		});
	};

	/**
	 * Property scrubbing fires at pointer-event rate (125–1000 Hz). Each preview
	 * write fans out to a synchronous React commit, so uncollapsed input means
	 * several full editor commits per frame — the "drag one slider → fps halves"
	 * symptom. One write per frame is the most the compositor can show anyway.
	 */
	const { push: previewValue, flush: flushPreview } = useCoalescedPreview({
		apply: applyPreview,
	});

	const toggleKeyframe = () => {
		if (!isPlayheadWithinElementRange) {
			return;
		}

		if (keyframeIdAtTime) {
			editor.timeline.removeKeyframes({
				keyframes: [
					{
						trackId,
						elementId,
						propertyPath: resolvedPropertyPath,
						keyframeId: keyframeIdAtTime,
					},
				],
			});
			return;
		}

		editor.timeline.upsertKeyframes({
			keyframes: [
				{
					trackId,
					elementId,
					propertyPath: resolvedPropertyPath,
					time: localTime,
					value: resolvedValue,
				},
			],
		});
	};

	return {
		hasAnimatedKeyframes,
		isKeyframedAtTime,
		keyframeIdAtTime,
		onPreview: previewValue,
		onCommit: () => {
			// Commit reads the overlay: flush the pending frame first or the last
			// scrub value would be lost. commitPreview also clears live param state.
			flushPreview();
			editor.timeline.commitPreview();
		},
		toggleKeyframe,
	};
}
