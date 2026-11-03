import { describe, expect, test } from "bun:test";
import {
	activeMediaAnimAtTime,
	mediaAnimPackTime,
	mediaAnimSpans,
} from "@/vfxpack/media-anim";

describe("mediaAnimSpans", () => {
	test("combo uses assignment duration, not full clip", () => {
		const spans = mediaAnimSpans({
			clipDurationSec: 4,
			assignment: {
				combo: { packId: "c", durationSec: 1 },
			},
		});
		expect(spans.combo).toEqual([0, 1]);
		expect(spans.in).toBeNull();
		expect(spans.out).toBeNull();
	});

	test("combo clamps to clip length", () => {
		const spans = mediaAnimSpans({
			clipDurationSec: 2,
			assignment: {
				combo: { packId: "c", durationSec: 5 },
			},
		});
		expect(spans.combo).toEqual([0, 2]);
	});

	test("compresses overlapping in+out symmetrically", () => {
		const spans = mediaAnimSpans({
			clipDurationSec: 2,
			assignment: {
				in: { packId: "i", durationSec: 2 },
				out: { packId: "o", durationSec: 2 },
			},
		});
		expect(spans.in?.[0]).toBeCloseTo(0, 5);
		expect(spans.in?.[1]).toBeCloseTo(1, 5);
		expect(spans.out?.[0]).toBeCloseTo(1, 5);
		expect(spans.out?.[1]).toBeCloseTo(2, 5);
	});

	test("remaps pack time across a span", () => {
		expect(
			mediaAnimPackTime({
				localTimeSec: 0.5,
				span: [0, 1],
				packNativeDurationSec: 2,
			}),
		).toBeCloseTo(1, 5);
	});

	test("picks active slot by local time", () => {
		const active = activeMediaAnimAtTime({
			assignment: {
				in: { packId: "i", durationSec: 1 },
				out: { packId: "o", durationSec: 1 },
			},
			localTimeSec: 0.25,
			clipDurationSec: 3,
		});
		expect(active?.phase).toBe("in");
		expect(active?.slot.packId).toBe("i");
	});
});
