import type { FrameRate } from "opencut-wasm";
import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks, TransitionEdge } from "@/timeline";
import {
	clampTransitionDuration,
	defaultTransitionDuration,
	findAdjacentCut,
} from "@/timeline/transitions";
import { generateUUID as generateId } from "@/utils/id";
import type { MediaTime } from "@/wasm";
import {
	readTransitionFps,
	requireVideoTrack,
	updateVideoTrackInSceneTracks,
} from "./video-track";

export class UpsertTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	private transitionId: string | null = null;
	private readonly trackId: string;
	private readonly fromElementId: string;
	private readonly toElementId: string;
	private readonly packId: string;
	private readonly duration: MediaTime | undefined;

	constructor({
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
	}) {
		super();
		this.trackId = trackId;
		this.fromElementId = fromElementId;
		this.toElementId = toElementId;
		this.packId = packId;
		this.duration = duration;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		const track = requireVideoTrack({ tracks, trackId: this.trackId });
		const fromElement = track.elements.find(
			(element) => element.id === this.fromElementId,
		);
		const toElement = track.elements.find(
			(element) => element.id === this.toElementId,
		);
		const cut = findAdjacentCut({
			elements: track.elements,
			fromId: this.fromElementId,
			toId: this.toElementId,
		});
		if (!fromElement || !toElement || !cut) {
			throw new Error("Clips are not adjacent");
		}

		this.savedState = tracks;
		this.transitionId ??= generateId();
		const existing = track.transitions.find(
			(edge) =>
				edge.fromElementId === this.fromElementId &&
				edge.toElementId === this.toElementId,
		);
		const duration = resolveUpsertDuration({
			duration: this.duration,
			existing,
			packId: this.packId,
			fromDuration: fromElement.duration,
			toDuration: toElement.duration,
			fps: readTransitionFps(),
		});
		const edge: TransitionEdge = {
			id: this.transitionId,
			trackId: this.trackId,
			fromElementId: this.fromElementId,
			toElementId: this.toElementId,
			packId: this.packId,
			duration,
		};

		const updatedTracks = updateVideoTrackInSceneTracks({
			tracks,
			trackId: this.trackId,
			update: (videoTrack) => ({
				...videoTrack,
				transitions: [
					...videoTrack.transitions.filter(
						(existing) =>
							existing.fromElementId !== this.fromElementId ||
							existing.toElementId !== this.toElementId,
					),
					edge,
				],
			}),
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}

	getTransitionId(): string | null {
		return this.transitionId;
	}
}

function resolveUpsertDuration({
	duration,
	existing,
	packId,
	fromDuration,
	toDuration,
	fps,
}: {
	duration: MediaTime | undefined;
	existing: TransitionEdge | undefined;
	packId: string;
	fromDuration: MediaTime;
	toDuration: MediaTime;
	fps: FrameRate;
}): MediaTime {
	if (duration !== undefined) {
		return clampTransitionDuration({
			duration,
			fromDuration,
			toDuration,
			fps,
		});
	}
	if (!existing || existing.packId !== packId) {
		return clampTransitionDuration({
			duration: defaultTransitionDuration(),
			fromDuration,
			toDuration,
			fps,
		});
	}
	return existing.duration;
}
