import { describe, expect, test } from "bun:test";
import type {
	ImageElement,
	SceneTracks,
	TextTrack,
	TransitionEdge,
	VideoElement,
	VideoTrack,
} from "@/timeline";
import {
	pruneAllTracks,
	pruneInvalidTransitions,
} from "@/timeline/transitions/prune";
import { mediaTime, ZERO_MEDIA_TIME } from "@/wasm";

function videoElement({
	id,
	start,
	duration,
}: {
	id: string;
	start: number;
	duration: number;
}): VideoElement {
	return {
		id,
		type: "video",
		name: id,
		startTime: mediaTime({ ticks: start }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: `media-${id}`,
		params: {},
	};
}

function imageElement({
	id,
	start,
	duration,
}: {
	id: string;
	start: number;
	duration: number;
}): ImageElement {
	return {
		id,
		type: "image",
		name: id,
		startTime: mediaTime({ ticks: start }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: `media-${id}`,
		params: {},
	};
}

function edge({
	id,
	trackId,
	fromElementId,
	toElementId,
}: {
	id: string;
	trackId: string;
	fromElementId: string;
	toElementId: string;
}): TransitionEdge {
	return {
		id,
		trackId,
		fromElementId,
		toElementId,
		packId: "pack-fade",
		duration: mediaTime({ ticks: 30 }),
	};
}

function videoTrack({
	id,
	elements,
	transitions,
}: {
	id: string;
	elements: VideoTrack["elements"];
	transitions: TransitionEdge[];
}): VideoTrack {
	return {
		id,
		name: id,
		type: "video",
		elements,
		transitions,
		muted: false,
		hidden: false,
	};
}

describe("pruneInvalidTransitions", () => {
	test("keeps an edge when the clips still meet at a cut", () => {
		const track = videoTrack({
			id: "main",
			elements: [
				videoElement({ id: "a", start: 0, duration: 100 }),
				videoElement({ id: "b", start: 100, duration: 80 }),
			],
			transitions: [
				edge({
					id: "edge-ab",
					trackId: "main",
					fromElementId: "a",
					toElementId: "b",
				}),
			],
		});

		const pruned = pruneInvalidTransitions({ track });

		expect(pruned.transitions).toEqual(track.transitions);
		expect(pruned.elements).toEqual(track.elements);
	});

	test("keeps an edge between an image and a video clip", () => {
		const track = videoTrack({
			id: "main",
			elements: [
				imageElement({ id: "still", start: 0, duration: 40 }),
				videoElement({ id: "clip", start: 40, duration: 60 }),
			],
			transitions: [
				edge({
					id: "edge-still",
					trackId: "main",
					fromElementId: "still",
					toElementId: "clip",
				}),
			],
		});

		expect(pruneInvalidTransitions({ track }).transitions).toEqual(
			track.transitions,
		);
	});

	test("drops an edge when a gap separates the clips", () => {
		const kept = edge({
			id: "edge-ab",
			trackId: "main",
			fromElementId: "a",
			toElementId: "b",
		});
		const gapped = edge({
			id: "edge-bc",
			trackId: "main",
			fromElementId: "b",
			toElementId: "c",
		});
		const track = videoTrack({
			id: "main",
			elements: [
				videoElement({ id: "a", start: 0, duration: 100 }),
				videoElement({ id: "b", start: 100, duration: 50 }),
				videoElement({ id: "c", start: 160, duration: 40 }),
			],
			transitions: [kept, gapped],
		});

		expect(pruneInvalidTransitions({ track }).transitions).toEqual([kept]);
	});

	test("drops an edge when either clip is missing", () => {
		const track = videoTrack({
			id: "main",
			elements: [videoElement({ id: "a", start: 0, duration: 100 })],
			transitions: [
				edge({
					id: "missing-to",
					trackId: "main",
					fromElementId: "a",
					toElementId: "gone",
				}),
				edge({
					id: "missing-from",
					trackId: "main",
					fromElementId: "gone",
					toElementId: "a",
				}),
			],
		});

		expect(pruneInvalidTransitions({ track }).transitions).toEqual([]);
	});

	test("drops an edge when the clips overlap instead of meeting", () => {
		const track = videoTrack({
			id: "main",
			elements: [
				videoElement({ id: "a", start: 0, duration: 100 }),
				videoElement({ id: "b", start: 90, duration: 50 }),
			],
			transitions: [
				edge({
					id: "overlap",
					trackId: "main",
					fromElementId: "a",
					toElementId: "b",
				}),
			],
		});

		expect(pruneInvalidTransitions({ track }).transitions).toEqual([]);
	});

	test("drops an edge stored in the reverse direction of the cut", () => {
		const track = videoTrack({
			id: "main",
			elements: [
				videoElement({ id: "a", start: 0, duration: 100 }),
				videoElement({ id: "b", start: 100, duration: 50 }),
			],
			transitions: [
				edge({
					id: "reversed",
					trackId: "main",
					fromElementId: "b",
					toElementId: "a",
				}),
			],
		});

		expect(pruneInvalidTransitions({ track }).transitions).toEqual([]);
	});

	test("does not mutate the input track", () => {
		const transitions = [
			edge({
				id: "stale",
				trackId: "main",
				fromElementId: "a",
				toElementId: "missing",
			}),
		];
		const track = videoTrack({
			id: "main",
			elements: [videoElement({ id: "a", start: 0, duration: 100 })],
			transitions,
		});

		pruneInvalidTransitions({ track });

		expect(track.transitions).toBe(transitions);
		expect(track.transitions).toHaveLength(1);
	});
});

describe("pruneAllTracks", () => {
	test("prunes the main track and overlay video tracks", () => {
		const valid = edge({
			id: "valid",
			trackId: "main",
			fromElementId: "a",
			toElementId: "b",
		});
		const staleMain = edge({
			id: "stale-main",
			trackId: "main",
			fromElementId: "b",
			toElementId: "missing",
		});
		const staleOverlay = edge({
			id: "stale-overlay",
			trackId: "overlay-video",
			fromElementId: "c",
			toElementId: "d",
		});
		const textTrack: TextTrack = {
			id: "titles",
			name: "Titles",
			type: "text",
			hidden: false,
			elements: [],
		};
		const tracks: SceneTracks = {
			main: videoTrack({
				id: "main",
				elements: [
					videoElement({ id: "a", start: 0, duration: 100 }),
					videoElement({ id: "b", start: 100, duration: 40 }),
				],
				transitions: [valid, staleMain],
			}),
			overlay: [
				textTrack,
				videoTrack({
					id: "overlay-video",
					elements: [
						videoElement({ id: "c", start: 0, duration: 20 }),
						videoElement({ id: "d", start: 30, duration: 20 }),
					],
					transitions: [staleOverlay],
				}),
			],
			audio: [],
		};

		const pruned = pruneAllTracks({ tracks });

		expect(pruned.main.transitions).toEqual([valid]);
		expect(pruned.overlay[0]).toBe(textTrack);
		expect((pruned.overlay[1] as VideoTrack).transitions).toEqual([]);
		expect(tracks.main.transitions).toEqual([valid, staleMain]);
		expect((tracks.overlay[1] as VideoTrack).transitions).toEqual([
			staleOverlay,
		]);
	});
});
