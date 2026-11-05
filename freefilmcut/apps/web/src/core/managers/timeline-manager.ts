import type { EditorCore } from "@/core";
import { toast } from "sonner";
import { flushPendingPreviews } from "@/timeline/preview-flush";
import type { ElementBounds } from "@/preview/element-bounds";
import type { ParamValues } from "@/params";
import type {
	SceneTracks,
	TrackType,
	TimelineTrack,
	TimelineElement,
	RetimeConfig,
} from "@/timeline";
import { calculateTotalDuration } from "@/timeline";
import {
	buildFreezeRippleUpdates,
	buildMirrorPatches,
	buildRotate90Patches,
	FREEZE_DURATION_SECONDS,
	resolveFreezeSourceTime,
} from "@/timeline/clip-quick-actions";
import { TimelineDragSource } from "@/timeline/drag-source";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import {
	addMediaTime,
	lastFrameMediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	type MediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";
import {
	canElementBeHidden,
	canElementHaveAudio,
} from "@/timeline/element-utils";
import { isElementMuted } from "@/timeline/audio-state";
import type {
	AnimationPath,
	AnimationInterpolation,
	ScalarCurveKeyframePatch,
} from "@/animation/types";
import type { ParamValue } from "@/params";
import {
	getElementLocalTime,
	resolveAnimationPathValueAtTime,
} from "@/animation";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { incrementCounter, measureSpanSync } from "@/diagnostics/render-perf";
import { BatchCommand } from "@/commands";
import { AddMediaAssetCommand } from "@/commands/media";
import {
	buildFreezeImageAsset,
	buildFreezeImageElement,
	captureFreezeFrameStill,
	freezeSampleKey,
} from "@/commands/timeline/element/freeze-frame";
import {
	AddTrackCommand,
	RemoveTrackCommand,
	ToggleTrackMuteCommand,
	ToggleTrackVisibilityCommand,
	InsertElementCommand,
	DeleteElementsCommand,
	DuplicateElementsCommand,
	UpdateElementsCommand,
	SplitElementsCommand,
	MoveElementCommand,
	TracksSnapshotCommand,
	UpsertKeyframeCommand,
	RemoveKeyframeCommand,
	RetimeKeyframeCommand,
	UpdateScalarKeyframeCurveCommand,
	AddClipEffectCommand,
	DeleteFreeformPathMaskPointsCommand,
	InsertFreeformPathMaskPointCommand,
	RemoveClipEffectCommand,
	UpdateClipEffectParamsCommand,
	ToggleClipEffectCommand,
	ReorderClipEffectsCommand,
	RemoveMaskCommand,
	ToggleMaskInvertedCommand,
	UpsertEffectParamKeyframeCommand,
	RemoveEffectParamKeyframeCommand,
	ToggleSourceAudioSeparationCommand,
	UpsertTransitionCommand,
	RemoveTransitionCommand,
	SetTransitionDurationCommand,
} from "@/commands/timeline";
import type { InsertElementParams } from "@/commands/timeline/element/insert-element";
import type {
	PlannedElementMove,
	PlannedTrackCreation,
} from "@/timeline/group-move";

/**
 * Why the timeline store notified its subscribers.
 *
 * `"preview"` means only the transient overlay changed (a drag in progress);
 * committed state is untouched. Subscribers that rebuild expensive resources
 * (audio decode caches, scene nodes) should ignore it.
 */
export type TimelineChangeReason = "commit" | "preview";

export class TimelineManager {
	private listeners = new Set<(reason: TimelineChangeReason) => void>();
	private previewOverlay = new Map<string, Partial<TimelineElement>>();
	private previewTracks: SceneTracks | null = null;
	public readonly dragSource = new TimelineDragSource();
	/**
	 * Duration cache keyed by the `tracks` object identity.
	 *
	 * `updateSceneTracks` always installs a brand-new `SceneTracks`, so identity
	 * change is a sound invalidation signal. Both `getTotalDuration` and
	 * `getLastFrameTime` are called from the playback rAF loop and the preview
	 * render loop every single frame; before this cache each frame walked every
	 * element twice and allocated a fresh track array twice
	 * (`calculateTotalDuration` spreads overlay+main+audio).
	 */
	private durationCache: {
		tracks: SceneTracks;
		duration: MediaTime;
		fpsKey: unknown;
		lastFrameTime: MediaTime | null;
	} | null = null;
	private freezeFrameInFlight = false;

	constructor(private editor: EditorCore) {}

	addTrack({ type, index }: { type: TrackType; index?: number }): string {
		const command = new AddTrackCommand({ type, index });
		this.editor.command.execute({ command });
		return command.getTrackId();
	}

	removeTrack({ trackId }: { trackId: string }): void {
		const command = new RemoveTrackCommand(trackId);
		this.editor.command.execute({ command });
	}

	insertElement({ element, placement }: InsertElementParams): void {
		const command = new InsertElementCommand({ element, placement });
		this.editor.command.execute({ command });
	}

	updateElementTrim({
		elementId,
		trimStart,
		trimEnd,
		startTime,
		duration,
		pushHistory = true,
	}: {
		elementId: string;
		trimStart: MediaTime;
		trimEnd: MediaTime;
		startTime?: MediaTime;
		duration?: MediaTime;
		pushHistory?: boolean;
	}): void {
		const trackId = this.findTrackIdForElement({ elementId });
		if (!trackId) {
			return;
		}

		const nextUpdates: Partial<TimelineElement> = {
			trimStart,
			trimEnd,
		};
		if (startTime !== undefined) {
			nextUpdates.startTime = startTime;
		}
		if (duration !== undefined) {
			nextUpdates.duration = duration;
		}

		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: nextUpdates,
				},
			],
			pushHistory,
		});
	}

	updateElementRetime({
		trackId,
		elementId,
		retime,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		retime?: RetimeConfig;
		pushHistory?: boolean;
	}): void {
		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: {
						retime,
					},
				},
			],
			pushHistory,
		});
	}

	moveElements({
		moves,
		createTracks,
	}: {
		moves: PlannedElementMove[];
		createTracks?: PlannedTrackCreation[];
	}): void {
		if (moves.length === 0) {
			return;
		}

		const command = new MoveElementCommand({
			moves,
			createTracks,
		});
		this.editor.command.execute({ command });
	}

	toggleTrackMute({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackMuteCommand(trackId);
		this.editor.command.execute({ command });
	}

	toggleTrackVisibility({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackVisibilityCommand(trackId);
		this.editor.command.execute({ command });
	}

	splitElements({
		elements,
		splitTime,
		retainSide = "both",
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTime: MediaTime;
		retainSide?: "both" | "left" | "right";
	}): { trackId: string; elementId: string }[] {
		const command = new SplitElementsCommand({
			elements,
			splitTime,
			retainSide,
		});
		this.editor.command.execute({ command });
		return command.getRightSideElements();
	}

	getTotalDuration(): MediaTime {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return ZERO_MEDIA_TIME;
		}

		const tracks = activeScene.tracks;
		const cached = this.durationCache;
		if (cached && cached.tracks === tracks) {
			return cached.duration;
		}

		const duration = calculateTotalDuration({ tracks });
		this.durationCache = {
			tracks,
			duration,
			fpsKey: null,
			lastFrameTime: null,
		};
		return duration;
	}

	getLastFrameTime(): MediaTime {
		const duration = this.getTotalDuration();
		const fps = this.editor.project.getActive()?.settings.fps;
		if (!fps || duration <= 0) return duration;

		const cached = this.durationCache;
		if (cached && cached.fpsKey === fps && cached.lastFrameTime !== null) {
			return cached.lastFrameTime;
		}

		const lastFrameTime = lastFrameMediaTime({ duration, fps });
		if (cached) {
			cached.fpsKey = fps;
			cached.lastFrameTime = lastFrameTime;
		}
		return lastFrameTime;
	}

	getTrackById({ trackId }: { trackId: string }): TimelineTrack | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}

		return findTrackInSceneTracks({ tracks: activeScene.tracks, trackId });
	}

	getElementsWithTracks({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): Array<{ track: TimelineTrack; element: TimelineElement }> {
		const result: Array<{ track: TimelineTrack; element: TimelineElement }> =
			[];

		for (const { trackId, elementId } of elements) {
			const track = this.getTrackById({ trackId });
			const element = track?.elements.find(
				(trackElement) => trackElement.id === elementId,
			);

			if (track && element) {
				result.push({ track, element });
			}
		}

		return result;
	}

	deleteElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const command = new DeleteElementsCommand({ elements });
		this.editor.command.execute({ command });
	}

	toggleSourceAudioSeparation({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const command = new ToggleSourceAudioSeparationCommand({
			trackId,
			elementId,
		});
		this.editor.command.execute({ command });
	}

	updateElements({
		updates,
		pushHistory = true,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}>;
		pushHistory?: boolean;
	}): void {
		if (updates.length === 0) {
			return;
		}

		const command = new UpdateElementsCommand({
			updates,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	addClipEffect({
		trackId,
		elementId,
		effectType,
	}: {
		trackId: string;
		elementId: string;
		effectType: string;
	}): string {
		const command = new AddClipEffectCommand({
			trackId,
			elementId,
			effectType,
		});
		this.editor.command.execute({ command });
		return command.getEffectId() ?? "";
	}

	removeClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new RemoveClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	upsertTransition({
		trackId,
		fromElementId,
		toElementId,
		packId,
		duration,
	}: {
		trackId: string;
		fromElementId: string;
		toElementId: string;
		packId: string;
		duration?: MediaTime;
	}): string {
		const command = new UpsertTransitionCommand({
			trackId,
			fromElementId,
			toElementId,
			packId,
			duration,
		});
		this.editor.command.execute({ command });
		return command.getTransitionId() ?? "";
	}

	removeTransition({
		trackId,
		transitionId,
	}: {
		trackId: string;
		transitionId: string;
	}): void {
		const command = new RemoveTransitionCommand({ trackId, transitionId });
		this.editor.command.execute({ command });
	}

	setTransitionDuration({
		trackId,
		transitionId,
		duration,
	}: {
		trackId: string;
		transitionId: string;
		duration: MediaTime;
	}): void {
		const command = new SetTransitionDurationCommand({
			trackId,
			transitionId,
			duration,
		});
		this.editor.command.execute({ command });
	}

	removeMask({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new RemoveMaskCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	deleteFreeformPathMaskPoints({
		trackId,
		elementId,
		maskId,
		pointIds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		pointIds: string[];
	}): void {
		if (pointIds.length === 0) {
			return;
		}
		const command = new DeleteFreeformPathMaskPointsCommand({
			trackId,
			elementId,
			maskId,
			pointIds,
		});
		this.editor.command.execute({ command });
	}

	insertFreeformPathMaskPoint({
		trackId,
		elementId,
		maskId,
		segmentIndex,
		canvasPoint,
		bounds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		segmentIndex: number;
		canvasPoint: { x: number; y: number };
		bounds: ElementBounds;
	}): void {
		const command = new InsertFreeformPathMaskPointCommand({
			trackId,
			elementId,
			maskId,
			segmentIndex,
			canvasPoint,
			bounds,
		});
		this.editor.command.execute({ command });
	}

	updateClipEffectParams({
		trackId,
		elementId,
		effectId,
		params,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		params: Partial<ParamValues>;
		pushHistory?: boolean;
	}): void {
		const command = new UpdateClipEffectParamsCommand({
			trackId,
			elementId,
			effectId,
			params,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	toggleClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new ToggleClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	toggleMaskInverted({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new ToggleMaskInvertedCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	reorderClipEffects({
		trackId,
		elementId,
		fromIndex,
		toIndex,
	}: {
		trackId: string;
		elementId: string;
		fromIndex: number;
		toIndex: number;
	}): void {
		const command = new ReorderClipEffectsCommand({
			trackId,
			elementId,
			fromIndex,
			toIndex,
		});
		this.editor.command.execute({ command });
	}

	upsertKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			time: MediaTime;
			value: ParamValue;
			interpolation?: AnimationInterpolation;
			keyframeId?: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({
				trackId,
				elementId,
				propertyPath,
				time,
				value,
				interpolation,
				keyframeId,
			}) =>
				new UpsertKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					time,
					value,
					interpolation,
					keyframeId,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	removeKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			keyframeId: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		// Pre-sample values at playhead for each (element, property) pair.
		// This preserves "what you see is what you get" when all keyframes are deleted.
		const playheadTime = this.editor.playback.getCurrentTime();
		const valueAtPlayheadMap = new Map<string, ParamValue | null>();

		for (const { trackId, elementId, propertyPath } of keyframes) {
			const key = `${elementId}:${propertyPath}`;
			if (valueAtPlayheadMap.has(key)) {
				continue;
			}

			const element = this.getElementByRef({ trackId, elementId });
			if (!element) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const localTime = getElementLocalTime({
				timelineTime: playheadTime,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});

			const target = resolveAnimationTarget({ element, path: propertyPath });
			const baseValue = target?.getBaseValue() ?? null;
			if (baseValue === null) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const value = resolveAnimationPathValueAtTime({
				animations: element.animations,
				propertyPath,
				localTime,
				fallbackValue: baseValue,
			});
			valueAtPlayheadMap.set(key, value);
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, keyframeId }) =>
				new RemoveKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					keyframeId,
					valueAtPlayhead:
						valueAtPlayheadMap.get(`${elementId}:${propertyPath}`) ?? null,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	retimeKeyframe({
		trackId,
		elementId,
		propertyPath,
		keyframeId,
		time,
	}: {
		trackId: string;
		elementId: string;
		propertyPath: AnimationPath;
		keyframeId: string;
		time: MediaTime;
	}): void {
		const command = new RetimeKeyframeCommand({
			trackId,
			elementId,
			propertyPath,
			keyframeId,
			nextTime: time,
		});
		this.editor.command.execute({ command });
	}

	updateKeyframeCurves({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			componentKey: string;
			keyframeId: string;
			patch: ScalarCurveKeyframePatch;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, componentKey, keyframeId, patch }) =>
				new UpdateScalarKeyframeCurveCommand({
					trackId,
					elementId,
					propertyPath,
					componentKey,
					keyframeId,
					patch,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	upsertEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		time,
		value,
		interpolation,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		time: MediaTime;
		value: number;
		interpolation?: "linear" | "hold";
		keyframeId?: string;
	}): void {
		const command = new UpsertEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			time,
			value,
			interpolation,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	removeEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		keyframeId: string;
	}): void {
		const command = new RemoveEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	isPreviewActive(): boolean {
		return this.previewOverlay.size > 0;
	}

	previewElements({
		updates,
	}: {
		updates: readonly {
			trackId: string;
			elementId: string;
			updates: Partial<TimelineElement>;
		}[];
	}): void {
		let changedOverlayCount = 0;
		for (const { elementId, updates: elementUpdates } of updates) {
			const existingOverlay = this.previewOverlay.get(elementId);
			const changed = Object.entries(elementUpdates).some(([key, value]) => {
				return !Object.is(
					existingOverlay?.[key as keyof TimelineElement],
					value,
				);
			});
			if (changed) {
				changedOverlayCount += 1;
				const mergedOverlay = {
					...existingOverlay,
					...elementUpdates,
				} as Partial<TimelineElement>;
				this.previewOverlay.set(elementId, mergedOverlay);
			}
		}
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!committedTracks) {
			return;
		}
		if (changedOverlayCount === 0) {
			return;
		}
		// O(all tracks + elements): every preview frame rebuilds every track array,
		// so subscriber identity checks below all come back "changed". Measured so a
		// per-frame drag can be split into "rebuild overlay" vs "React render".
		this.previewTracks = measureSpanSync({
			name: "timeline:applyPreviewOverlay",
			fn: () => this.applyPreviewOverlay(committedTracks),
		});
		this.notify("preview");
	}

	commitPreview(): void {
		// Drain frame-coalesced property writes first: a value still waiting for
		// its animation frame would otherwise be dropped by the commit (the UI
		// would show the new number while the project keeps the old one).
		flushPendingPreviews();
		if (this.previewOverlay.size === 0) return;
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!committedTracks) {
			return;
		}
		const afterTracks =
			this.previewTracks ?? this.applyPreviewOverlay(committedTracks);
		const command = new TracksSnapshotCommand({
			before: committedTracks,
			after: afterTracks,
		});
		this.editor.command.push({ command });
		this.previewOverlay.clear();
		this.previewTracks = null;
		this.updateTracks(afterTracks);
	}

	discardPreview(): void {
		flushPendingPreviews();
		if (this.previewOverlay.size === 0) return;
		this.previewOverlay.clear();
		this.previewTracks = null;
		this.notify("preview");
	}

	private applyPreviewOverlay(tracks: SceneTracks): SceneTracks {
		if (this.previewOverlay.size === 0) return tracks;

		const applyTrackOverlay = <TTrack extends TimelineTrack>(
			track: TTrack,
		): TTrack => {
			const hasOverlay = track.elements.some((element) =>
				this.previewOverlay.has(element.id),
			);
			if (!hasOverlay) {
				return track;
			}

			const nextElements = track.elements.map((element) => {
				const overlay = this.previewOverlay.get(element.id);
				return overlay
					? ({ ...element, ...overlay } as TimelineElement)
					: element;
			});

			return { ...track, elements: nextElements } as TTrack;
		};

		return {
			overlay: tracks.overlay.map((track) => applyTrackOverlay(track)),
			main: applyTrackOverlay(tracks.main),
			audio: tracks.audio.map((track) => applyTrackOverlay(track)),
		};
	}

	duplicateElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): { trackId: string; elementId: string }[] {
		const command = new DuplicateElementsCommand({ elements });
		this.editor.command.execute({ command });
		return command.getDuplicatedElements();
	}

	toggleElementsVisibility({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldHide = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return element && canElementBeHidden(element) && !element.hidden;
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementBeHidden(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { hidden: shouldHide },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	toggleElementsMuted({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldMute = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return (
				element && canElementHaveAudio(element) && !isElementMuted({ element })
			);
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementHaveAudio(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { params: { muted: shouldMute } },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	mirrorElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const items = this.getElementsWithTracks({ elements });
		const updates = buildMirrorPatches({
			items: items.map(({ track, element }) => ({
				trackId: track.id,
				elementId: element.id,
				element,
			})),
		});
		this.updateElements({ updates });
	}

	rotateElements90({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const items = this.getElementsWithTracks({ elements });
		const updates = buildRotate90Patches({
			items: items.map(({ track, element }) => ({
				trackId: track.id,
				elementId: element.id,
				element,
			})),
		});
		this.updateElements({ updates });
	}

	toggleReverse({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const element = this.getElementByRef({ trackId, elementId });
		if (!element || element.type !== "video") return;
		const next = !(element.reversed === true);
		const updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}> = [{ trackId, elementId, patch: { reversed: next } }];

		const scene = this.editor.scenes.getActiveScene();
		for (const track of scene.tracks.audio) {
			for (const audio of track.elements) {
				if (
					audio.type === "audio" &&
					"mediaId" in audio &&
					audio.mediaId === element.mediaId &&
					audio.startTime === element.startTime &&
					audio.duration === element.duration
				) {
					updates.push({
						trackId: track.id,
						elementId: audio.id,
						patch: { reversed: next },
					});
				}
			}
		}
		this.updateElements({ updates });
	}

	async freezeFrame({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): Promise<void> {
		if (this.freezeFrameInFlight) return;
		this.freezeFrameInFlight = true;
		try {
			await this.insertFreezeFrame({ trackId, elementId });
		} catch (error) {
			console.error("Freeze frame failed:", error);
			toast.error("Couldn't capture a freeze frame");
		} finally {
			this.freezeFrameInFlight = false;
		}
	}

	getPreviewTracks(): SceneTracks | null {
		return (
			this.previewTracks ??
			this.editor.scenes.getActiveSceneOrNull()?.tracks ??
			null
		);
	}

	subscribe(listener: (reason: TimelineChangeReason) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Live preview overlay for a single element, or undefined when the element
	 * has no in-progress edits.
	 */
	getPreviewOverlay(elementId: string): Partial<TimelineElement> | undefined {
		return this.previewOverlay.get(elementId);
	}

	private notify(reason: TimelineChangeReason = "commit"): void {
		if (reason === "preview") {
			// How many store subscribers one drag frame wakes. Every one of them
			// re-evaluates its selector through useEditor's useSyncExternalStore.
			incrementCounter({
				name: "preview:notifyReceivers",
				by: this.listeners.size,
			});
		}
		this.listeners.forEach((fn) => {
			fn(reason);
		});
	}

	private async insertFreezeFrame({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): Promise<void> {
		const located = this.getElementsWithTracks({
			elements: [{ trackId, elementId }],
		})[0];
		if (!located || located.element.type !== "video") return;

		const video = located.element;
		const mediaAsset =
			this.editor.media
				.getAssets()
				.find((asset) => asset.id === video.mediaId) ?? null;
		if (!mediaAsset?.file) {
			toast.error("Couldn't capture a freeze frame");
			return;
		}

		const project = this.editor.project.getActive();
		const sampleKey = freezeSampleKey({ element: video });
		const sourceSeconds = Math.max(
			0,
			mediaTimeToSeconds({
				time: resolveFreezeSourceTime({
					duration: video.duration,
					trimStart: video.trimStart,
					retime: video.retime,
					reversed: video.reversed === true,
					fps: project.settings.fps,
				}),
			}),
		);

		const still = await captureFreezeFrameStill({
			mediaId: video.mediaId,
			file: mediaAsset.file,
			timeSeconds: sourceSeconds,
		});
		if (!still) {
			toast.error("Couldn't capture a freeze frame");
			return;
		}

		const fresh = this.getElementsWithTracks({
			elements: [{ trackId, elementId }],
		})[0];
		const activeProject = this.editor.project.getActiveOrNull();
		if (
			!fresh ||
			fresh.element.type !== "video" ||
			!activeProject ||
			activeProject.metadata.id !== project.metadata.id ||
			freezeSampleKey({ element: fresh.element }) !== sampleKey
		) {
			toast.error("Couldn't capture a freeze frame");
			return;
		}

		const duration = mediaTimeFromSeconds({ seconds: FREEZE_DURATION_SECONDS });
		const startTime = addMediaTime({
			a: fresh.element.startTime,
			b: fresh.element.duration,
		});
		const asset = buildFreezeImageAsset({
			file: still.file,
			width: still.width,
			height: still.height,
			thumbnailUrl: still.thumbnailUrl,
		});
		const addMedia = new AddMediaAssetCommand({
			projectId: activeProject.metadata.id,
			asset,
		});
		const imageElement = buildFreezeImageElement({
			mediaId: addMedia.getAssetId(),
			name: asset.name,
			startTime,
			duration,
			sourceParams: fresh.element.params,
		});
		const rippleUpdates = buildFreezeRippleUpdates({
			trackId: fresh.track.id,
			elements: fresh.track.elements,
			afterTime: startTime,
			delta: duration,
			excludeElementId: fresh.element.id,
		});

		this.editor.command.execute({
			command: new BatchCommand([
				addMedia,
				new UpdateElementsCommand({ updates: rippleUpdates }),
				new InsertElementCommand({
					element: imageElement,
					placement: { mode: "explicit", trackId: fresh.track.id },
				}),
			]),
		});
	}

	private getElementByRef({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): TimelineElement | undefined {
		return this.getTrackById({ trackId })?.elements.find(
			(element) => element.id === elementId,
		);
	}

	private findTrackIdForElement({
		elementId,
	}: {
		elementId: string;
	}): string | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}

		if (
			activeScene.tracks.main.elements.some(
				(element) => element.id === elementId,
			)
		) {
			return activeScene.tracks.main.id;
		}

		for (const track of activeScene.tracks.overlay) {
			if (track.elements.some((element) => element.id === elementId)) {
				return track.id;
			}
		}

		for (const track of activeScene.tracks.audio) {
			if (track.elements.some((element) => element.id === elementId)) {
				return track.id;
			}
		}

		return null;
	}

	updateTracks(newTracks: SceneTracks): void {
		this.previewOverlay.clear();
		this.previewTracks = null;
		this.editor.scenes.updateSceneTracks({ tracks: newTracks });
		this.notify();
	}
}
