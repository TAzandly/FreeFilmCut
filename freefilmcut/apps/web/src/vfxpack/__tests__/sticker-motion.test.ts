import { describe, expect, test } from "bun:test";
import {
	combineStickerPoses,
	resolveAppliedStickerPose,
	sampleStickerMotion,
	stickerAnimSpans,
	type StickerMotion,
} from "@/vfxpack/sticker-motion";

function motion(partial: Partial<StickerMotion> & Pick<StickerMotion, "tracks">): StickerMotion {
	return {
		duration: partial.duration ?? 0.5,
		loop: partial.loop ?? "clamp",
		tracks: partial.tracks,
	};
}

describe("sticker motion", () => {
	test("empty tracks stay at identity", () => {
		expect(sampleStickerMotion(motion({ tracks: [] }), 0.2)).toEqual({
			opacity: 1,
			scale: 1,
			rotate: 0,
			positionX: 0,
			positionY: 0,
		});
	});

	test("opacity interpolates and step holds the left key", () => {
		const fade = motion({
			tracks: [
				{ path: "sticker.opacity", keys: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] },
			],
		});
		expect(sampleStickerMotion(fade, 0.25).opacity).toBeCloseTo(0.5);
		const stepped = motion({
			tracks: [
				{
					path: "sticker.opacity",
					interp: "step",
					keys: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }],
				},
			],
		});
		expect(sampleStickerMotion(stepped, 0.25).opacity).toBe(0);
	});

	test("a scale track leaves the other channels alone", () => {
		const pose = sampleStickerMotion(
			motion({ tracks: [{ path: "sticker.scale", keys: [{ t: 0, v: 0.5 }] }] }),
			0,
		);
		expect(pose.scale).toBe(0.5);
		expect(pose.opacity).toBe(1);
		expect(pose.rotate).toBe(0);
	});

	test("poses multiply opacity and scale and add rotation and position", () => {
		expect(
			combineStickerPoses([
				{ opacity: 0.5, scale: 2, rotate: 10, positionX: 0.2, positionY: 0 },
				{ opacity: 0.5, scale: 0.5, rotate: -3, positionX: -0.1, positionY: 0.4 },
				{ opacity: 1, scale: 1, rotate: 0, positionX: 0, positionY: 0 },
			]),
		).toEqual({
			opacity: 0.25,
			scale: 1,
			rotate: 7,
			positionX: 0.1,
			positionY: 0.4,
		});
	});

	test("loop sits between in and out", () => {
		expect(
			stickerAnimSpans({
				clipDuration: 5,
				inDuration: 0.5,
				outDuration: 0.5,
				hasLoop: true,
			}),
		).toEqual({
			in: [0, 0.5],
			out: [4.5, 5],
			loop: [0.5, 4.5],
		});
	});

	test("loop fills whatever in and out leave open", () => {
		expect(
			stickerAnimSpans({ clipDuration: 5, inDuration: 0.5, outDuration: 0, hasLoop: true }).loop,
		).toEqual([0.5, 5]);
		expect(
			stickerAnimSpans({ clipDuration: 5, inDuration: 0, outDuration: 0.5, hasLoop: true }).loop,
		).toEqual([0, 4.5]);
		expect(
			stickerAnimSpans({ clipDuration: 5, inDuration: 0, outDuration: 0, hasLoop: true }).loop,
		).toEqual([0, 5]);
	});

	test("no loop gap when in and out cover the clip", () => {
		expect(
			stickerAnimSpans({
				clipDuration: 1,
				inDuration: 0.6,
				outDuration: 0.6,
				hasLoop: true,
			}).loop,
		).toBeNull();
	});

	test("hasLoop false draws no loop span", () => {
		const spans = stickerAnimSpans({
			clipDuration: 5,
			inDuration: 0.5,
			outDuration: 0.5,
			hasLoop: false,
		});
		expect(spans.loop).toBeNull();
		expect(spans.in).toEqual([0, 0.5]);
		expect(spans.out).toEqual([4.5, 5]);
	});

	test("only the active segment contributes", () => {
		const fade = motion({
			duration: 0.5,
			tracks: [{ path: "sticker.opacity", keys: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] }],
		});
		const packs = new Map<string, StickerMotion>([["in", fade]]);
		const pose = resolveAppliedStickerPose({
			stickerAnims: { in: { packId: "in" } },
			localTimeSec: 0.25,
			clipDurationSec: 5,
			motionForPack: (id) => packs.get(id) ?? null,
		});
		expect(pose.opacity).toBeCloseTo(0.5);
		const after = resolveAppliedStickerPose({
			stickerAnims: { in: { packId: "in" } },
			localTimeSec: 1,
			clipDurationSec: 5,
			motionForPack: (id) => packs.get(id) ?? null,
		});
		expect(after.opacity).toBe(1);
	});
});
