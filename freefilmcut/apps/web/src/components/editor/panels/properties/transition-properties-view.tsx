"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { DEFAULT_FPS } from "@/fps/defaults";
import type { SelectedTransition } from "@/selection/editor-selection";
import type { TransitionEdge } from "@/timeline";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { NumberField } from "@/components/ui/number-field";
import { usePropertyDraft } from "./hooks/use-property-draft";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import {
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	roundFrameTime,
	type MediaTime,
} from "@/wasm";
import type { FrameRate } from "opencut-wasm";

function fpsToStep({ fps }: { fps: FrameRate }): number {
	const fpsFloat = fps.numerator / fps.denominator;
	return 1 / fpsFloat;
}

function durationToDisplay({
	duration,
	step,
}: {
	duration: MediaTime;
	step: number;
}): string {
	const seconds = mediaTimeToSeconds({ time: duration });
	return formatNumberForDisplay({
		value: seconds,
		fractionDigits: getFractionDigitsForStep({ step }),
	});
}

function secondsToDuration({
	seconds,
	fps,
}: {
	seconds: number;
	fps: FrameRate;
}): MediaTime {
	return roundFrameTime({
		time: mediaTimeFromSeconds({ seconds }),
		fps,
	});
}

function TransitionDurationField({
	selection,
	edge,
	fps,
}: {
	selection: SelectedTransition;
	edge: TransitionEdge;
	fps: FrameRate;
}) {
	const editor = useEditor();
	const step = fpsToStep({ fps });
	const [previewSeconds, setPreviewSeconds] = useState<number | null>(null);
	const pendingSecondsRef = useRef(0);

	const sourceDuration = edge.duration;
	const displaySeconds =
		previewSeconds ?? mediaTimeToSeconds({ time: sourceDuration });

	const commitDuration = ({ seconds }: { seconds: number }) => {
		setPreviewSeconds(null);
		const duration = secondsToDuration({ seconds, fps });
		if (duration === sourceDuration) {
			return;
		}
		editor.timeline.setTransitionDuration({
			trackId: selection.trackId,
			transitionId: selection.transitionId,
			duration,
		});
	};

	const durationDraft = usePropertyDraft({
		displayValue: durationToDisplay({
			duration: mediaTimeFromSeconds({ seconds: displaySeconds }),
			step,
		}),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) {
				return null;
			}
			return snapToStep({ value: parsed, step });
		},
		onPreview: (seconds) => {
			pendingSecondsRef.current = seconds;
			setPreviewSeconds(seconds);
		},
		onCommit: () => {
			commitDuration({ seconds: pendingSecondsRef.current });
		},
	});

	return (
		<SectionField label="Duration">
			<NumberField
				value={durationDraft.displayValue}
				suffix="s"
				scrubRanges={[{ from: 0, to: 5, pixelsPerUnit: 80 }]}
				scrubClamp={{ min: step, max: 5 }}
				onFocus={() => {
					pendingSecondsRef.current = displaySeconds;
					durationDraft.onFocus();
				}}
				onChange={durationDraft.onChange}
				onBlur={durationDraft.onBlur}
				onScrub={durationDraft.scrubTo}
				onScrubEnd={() => {
					durationDraft.commitScrub();
				}}
			/>
		</SectionField>
	);
}

export function TransitionPropertiesView({
	selection,
}: {
	selection: SelectedTransition;
}) {
	const editor = useEditor();
	const edge = useEditor((currentEditor) => {
		const track = currentEditor.timeline.getTrackById({
			trackId: selection.trackId,
		});
		if (!track || track.type !== "video") {
			return null;
		}
		return (
			(track.transitions ?? []).find(
				(transition) => transition.id === selection.transitionId,
			) ?? null
		);
	});

	useEffect(() => {
		if (!edge) {
			editor.selection.setSelectedTransition({ selection: null });
		}
	}, [editor, edge]);
	const packId = edge?.packId ?? "";
	const packDisplayName = usePackRegistry((state) => {
		const pack = state.packs.find((entry) => entry.id === packId);
		return pack?.displayName ?? packId;
	});

	const fps =
		useEditor((currentEditor) => currentEditor.project.getActiveOrNull())
			?.settings.fps ?? DEFAULT_FPS;

	if (!edge) {
		return null;
	}

	return (
		<Section collapsible sectionKey={`transition:${edge.id}`}>
			<SectionHeader>
				<SectionTitle>Transition</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<SectionFields>
					<SectionField label="Pack">
						<p className="text-sm">{packDisplayName}</p>
					</SectionField>
					<TransitionDurationField
						selection={selection}
						edge={edge}
						fps={fps}
					/>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
