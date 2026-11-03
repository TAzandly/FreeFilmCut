import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks } from "@/timeline";
import {
	requireVideoTrack,
	updateVideoTrackInSceneTracks,
} from "./video-track";

export class RemoveTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly transitionId: string;

	constructor({
		trackId,
		transitionId,
	}: {
		trackId: string;
		transitionId: string;
	}) {
		super();
		this.trackId = trackId;
		this.transitionId = transitionId;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		requireVideoTrack({ tracks, trackId: this.trackId });
		this.savedState = tracks;

		const updatedTracks = updateVideoTrackInSceneTracks({
			tracks,
			trackId: this.trackId,
			update: (videoTrack) => ({
				...videoTrack,
				transitions: videoTrack.transitions.filter(
					(edge) => edge.id !== this.transitionId,
				),
			}),
		});

		editor.timeline.updateTracks(updatedTracks);

		const selected = editor.selection.getSelectedTransition();
		if (
			selected &&
			selected.trackId === this.trackId &&
			selected.transitionId === this.transitionId
		) {
			return {
				selection: {
					selectedTransition: null,
				},
			};
		}
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
