import { describe, expect, test } from "bun:test";
import { DEFAULT_BACKGROUND_FILL } from "@/background/fill";
import { DEFAULT_COLOR_CORRECTION_INTENSITY } from "@/color-correction";
import { DEFAULT_COLOR_GRADE } from "@/color-grade";
import type { MediaAsset } from "@/media/types";
import type { VideoElement, VideoTrack } from "@/timeline";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import {
	buildCutTransitionBindings,
	isInsideCutTransitionWindow,
	ownsCutTransition,
	pickOwnedCutTransition,
	resolveTransitionPlacement,
	transitionFrameLayout,
	transitionPackSampleTimeSec,
	type CutTransitionBinding,
	type TransitionMediaSource,
} from "../cut-transition";

function imageSide(): TransitionMediaSource {
	return {
		kind: "image",
		url: "blob:still",
		elementStart: mediaTimeFromSeconds({ seconds: 0 }),
		elementDuration: mediaTimeFromSeconds({ seconds: 2 }),
		trimStart: mediaTimeFromSeconds({ seconds: 0 }),
		trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
		transform: {
			scaleX: 1,
			scaleY: 1,
			position: { x: 0, y: 0 },
			rotate: 0,
		},
		opacity: 1,
		backgroundFill: DEFAULT_BACKGROUND_FILL,
		fillStyleUrl: null,
		colorGrade: DEFAULT_COLOR_GRADE,
		colorCorrection: {
			enabled: false,
			intensity: DEFAULT_COLOR_CORRECTION_INTENSITY,
			analysis: null,
		},
	};
}

function binding({
	role,
	cutSec,
	durationSec,
	edgeId = "edge",
}: {
	role: "from" | "to";
	cutSec: number;
	durationSec: number;
	edgeId?: string;
}): CutTransitionBinding {
	const side = imageSide();
	return {
		edgeId,
		packId: "dissolve",
		cutTime: mediaTimeFromSeconds({ seconds: cutSec }),
		duration: mediaTimeFromSeconds({ seconds: durationSec }),
		role,
		self: side,
		partner: side,
	};
}

describe("ownsCutTransition", () => {
	test("from owns the first half of the window, including the start", () => {
		const from = binding({ role: "from", cutSec: 2, durationSec: 1 });
		const start = mediaTimeFromSeconds({ seconds: 1.5 });
		const justBeforeCut = mediaTimeFromSeconds({ seconds: 1.99 });
		expect(ownsCutTransition({ binding: from, time: start })).toBe(true);
		expect(ownsCutTransition({ binding: from, time: justBeforeCut })).toBe(true);
		expect(
			ownsCutTransition({
				binding: from,
				time: mediaTimeFromSeconds({ seconds: 2 }),
			}),
		).toBe(false);
	});

	test("to owns from the cut through the inclusive window end", () => {
		const to = binding({ role: "to", cutSec: 2, durationSec: 1 });
		expect(
			ownsCutTransition({
				binding: to,
				time: mediaTimeFromSeconds({ seconds: 2 }),
			}),
		).toBe(true);
		expect(
			ownsCutTransition({
				binding: to,
				time: mediaTimeFromSeconds({ seconds: 2.5 }),
			}),
		).toBe(true);
		expect(
			ownsCutTransition({
				binding: to,
				time: mediaTimeFromSeconds({ seconds: 1.5 }),
			}),
		).toBe(false);
	});

	test("outside the window neither side owns", () => {
		const from = binding({ role: "from", cutSec: 2, durationSec: 1 });
		expect(
			ownsCutTransition({
				binding: from,
				time: mediaTimeFromSeconds({ seconds: 1.4 }),
			}),
		).toBe(false);
		expect(
			ownsCutTransition({
				binding: from,
				time: mediaTimeFromSeconds({ seconds: 2.6 }),
			}),
		).toBe(false);
	});
});

describe("isInsideCutTransitionWindow", () => {
	test("true for the full inclusive window regardless of role", () => {
		const from = binding({ role: "from", cutSec: 2, durationSec: 1 });
		expect(
			isInsideCutTransitionWindow({
				bindings: [from],
				time: mediaTimeFromSeconds({ seconds: 1.5 }),
			}),
		).toBe(true);
		expect(
			isInsideCutTransitionWindow({
				bindings: [from],
				time: mediaTimeFromSeconds({ seconds: 2 }),
			}),
		).toBe(true);
		expect(
			isInsideCutTransitionWindow({
				bindings: [from],
				time: mediaTimeFromSeconds({ seconds: 2.5 }),
			}),
		).toBe(true);
		expect(
			isInsideCutTransitionWindow({
				bindings: [from],
				time: mediaTimeFromSeconds({ seconds: 1.4 }),
			}),
		).toBe(false);
	});
});

describe("pickOwnedCutTransition", () => {
	test("picks the closer cut when two windows overlap", () => {
		const early = binding({
			role: "to",
			cutSec: 0,
			durationSec: 4,
			edgeId: "early",
		});
		const late = binding({
			role: "from",
			cutSec: 2,
			durationSec: 4,
			edgeId: "late",
		});
		const picked = pickOwnedCutTransition({
			bindings: [early, late],
			time: mediaTimeFromSeconds({ seconds: 0.4 }),
		});
		expect(picked?.edgeId).toBe("early");
	});
});

describe("transitionPackSampleTimeSec", () => {
	test("maps the window onto the pack timeline duration", () => {
		const cutTime = mediaTimeFromSeconds({ seconds: 2 });
		const duration = mediaTimeFromSeconds({ seconds: 1 });
		const mid = transitionPackSampleTimeSec({
			timelineTime: mediaTimeFromSeconds({ seconds: 2 }),
			cutTime,
			duration,
			packTimelineDurationSec: 2,
		});
		expect(mid).toBeCloseTo(1, 5);
	});

	test("uses transition duration when the pack has no timeline", () => {
		const duration = mediaTimeFromSeconds({ seconds: 1 });
		const atEnd = transitionPackSampleTimeSec({
			timelineTime: mediaTimeFromSeconds({ seconds: 2.5 }),
			cutTime: mediaTimeFromSeconds({ seconds: 2 }),
			duration,
			packTimelineDurationSec: null,
		});
		expect(atEnd).toBeCloseTo(mediaTimeToSeconds({ time: duration }), 5);
	});
});

describe("buildCutTransitionBindings", () => {
	function videoElement({
		id,
		startSec,
	}: {
		id: string;
		startSec: number;
	}): VideoElement {
		return {
			id,
			name: id,
			type: "video",
			mediaId: "m1",
			startTime: mediaTimeFromSeconds({ seconds: startSec }),
			duration: mediaTimeFromSeconds({ seconds: 2 }),
			trimStart: mediaTimeFromSeconds({ seconds: 0 }),
			trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
			params: {},
		};
	}

	function trackWith(elements: VideoElement[], durationSec: number): VideoTrack {
		const [from, to] = elements;
		return {
			id: "track",
			name: "Video",
			type: "video",
			muted: false,
			hidden: false,
			elements,
			transitions: from && to
				? [
						{
							id: "edge",
							trackId: "track",
							fromElementId: from.id,
							toElementId: to.id,
							packId: "dissolve",
							duration: mediaTimeFromSeconds({ seconds: durationSec }),
						},
					]
				: [],
		};
	}

	const mediaMap = new Map<string, MediaAsset>([
		[
			"m1",
			{
				id: "m1",
				name: "clip",
				type: "video",
				file: new File(["x"], "clip.mp4", { type: "video/mp4" }),
				url: "blob:clip",
			},
		],
	]);

	test("attaches from and to bindings on an adjacent cut", () => {
		const from = videoElement({ id: "a", startSec: 0 });
		const to = videoElement({ id: "b", startSec: 2 });
		const track = trackWith([from, to], 1);
		const fromBindings = buildCutTransitionBindings({
			track,
			element: from,
			mediaMap,
		});
		const toBindings = buildCutTransitionBindings({
			track,
			element: to,
			mediaMap,
		});
		expect(fromBindings).toHaveLength(1);
		expect(fromBindings[0]?.role).toBe("from");
		expect(fromBindings[0]?.packId).toBe("dissolve");
		expect(fromBindings[0]?.partner.kind).toBe("video");
		expect(toBindings[0]?.role).toBe("to");
		expect(toBindings[0]?.self.kind).toBe("video");
	});

	test("skips a transition whose clips are no longer adjacent", () => {
		const from = videoElement({ id: "a", startSec: 0 });
		const to = videoElement({ id: "b", startSec: 3 });
		const track = trackWith([from, to], 1);
		expect(
			buildCutTransitionBindings({ track, element: from, mediaMap }),
		).toEqual([]);
	});

	test("keeps the clip position on the transition source", () => {
		const from = videoElement({ id: "a", startSec: 0 });
		from.params = { "transform.positionX": 40, "transform.rotate": 15 };
		const to = videoElement({ id: "b", startSec: 2 });
		const track = trackWith([from, to], 1);
		const bindings = buildCutTransitionBindings({
			track,
			element: from,
			mediaMap,
		});
		expect(bindings[0]?.self.transform.position.x).toBe(40);
		expect(bindings[0]?.self.transform.rotate).toBe(15);
	});
});

describe("resolveTransitionPlacement", () => {
	test("uses the animated pose inside the clip and holds the edge outside it", () => {
		const media = imageSide();
		media.animations = {
			"transform.positionX": {
				keys: [
					{
						id: "a",
						time: mediaTimeFromSeconds({ seconds: 0 }),
						value: 0,
						segmentToNext: "linear",
						tangentMode: "auto",
					},
					{
						id: "b",
						time: mediaTimeFromSeconds({ seconds: 2 }),
						value: 200,
						segmentToNext: "linear",
						tangentMode: "auto",
					},
				],
			},
		};

		const mid = resolveTransitionPlacement({
			media,
			timelineTime: mediaTimeFromSeconds({ seconds: 1 }),
		});
		const before = resolveTransitionPlacement({
			media,
			timelineTime: mediaTimeFromSeconds({ seconds: -1 }),
		});
		const after = resolveTransitionPlacement({
			media,
			timelineTime: mediaTimeFromSeconds({ seconds: 3 }),
		});

		expect(mid.transform.position.x).toBeCloseTo(100, 4);
		expect(before.transform.position.x).toBeCloseTo(0, 4);
		expect(after.transform.position.x).toBeCloseTo(200, 4);
	});
});

describe("transitionFrameLayout", () => {
	test("contains a 16:9 frame in a 9:16 canvas and applies position and rotation", () => {
		const layout = transitionFrameLayout({
			canvasWidth: 1080,
			canvasHeight: 1920,
			sourceWidth: 1920,
			sourceHeight: 1080,
			transform: {
				scaleX: 1,
				scaleY: 1,
				position: { x: 20, y: -10 },
				rotate: 15,
			},
		});
		expect(layout.width).toBeCloseTo(1080, 4);
		expect(layout.height).toBeCloseTo(607.5, 4);
		expect(layout.centerX).toBeCloseTo(560, 4);
		expect(layout.centerY).toBeCloseTo(950, 4);
		expect(layout.rotationDegrees).toBe(15);
		expect(layout.flipX).toBe(false);
	});
});
