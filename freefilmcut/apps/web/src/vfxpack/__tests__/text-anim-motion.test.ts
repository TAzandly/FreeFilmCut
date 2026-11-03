import { describe, expect, it } from "bun:test";
import {
	sampleTextAnimPack,
	resolveAppliedTextPose,
	textAnimSpans,
	TEXT_MOTION_IDENTITY,
} from "@/vfxpack/text-anim-motion";

describe("text-anim-motion", () => {
	it("spans match sticker head/tail/middle", () => {
		const spans = textAnimSpans({
			clipDuration: 5,
			inDuration: 0.5,
			outDuration: 0.5,
			hasLoop: true,
		});
		expect(spans.in).toEqual([0, 0.5]);
		expect(spans.out).toEqual([4.5, 5]);
		expect(spans.loop).toEqual([0.5, 4.5]);
	});

	it("samples charIn progress into opacity", () => {
		const pose0 = sampleTextAnimPack(
			{
				duration: 0.8,
				category: "in",
				components: [
					{
						id: "c1",
						type: "charIn",
						enabled: true,
						params: { opacity: 0, offsetY: -40, scale: 0.5 },
						channels: { opacity: true, offsetY: true, scale: true },
					},
				],
				tracks: [
					{
						path: "textAnim.c1.progress",
						keys: [
							{ t: 0, v: 0 },
							{ t: 0.8, v: 1 },
						],
					},
				],
			},
			0,
		);
		expect(pose0.opacity).toBeCloseTo(0, 3);
		expect(pose0.positionY).toBeCloseTo(-40, 3);
		expect(pose0.scale).toBeCloseTo(0.5, 3);

		const pose1 = sampleTextAnimPack(
			{
				duration: 0.8,
				category: "in",
				components: [
					{
						id: "c1",
						type: "charIn",
						enabled: true,
						params: { opacity: 0, offsetY: -40, scale: 0.5 },
						channels: { opacity: true, offsetY: true, scale: true },
					},
				],
				tracks: [
					{
						path: "textAnim.c1.progress",
						keys: [
							{ t: 0, v: 0 },
							{ t: 0.8, v: 1 },
						],
					},
				],
			},
			0.8,
		);
		expect(pose1.opacity).toBeCloseTo(1, 3);
		expect(pose1.positionY).toBeCloseTo(0, 3);
		expect(pose1.scale).toBeCloseTo(1, 3);
	});

	it("resolveAppliedTextPose picks in phase at t=0", () => {
		const pose = resolveAppliedTextPose({
			textAnims: { in: { packId: "in" } },
			localTimeSec: 0.1,
			clipDurationSec: 5,
			payloadForPack: (id) =>
				id === "in"
					? {
							duration: 0.5,
							category: "in",
							components: [
								{
									id: "c1",
									type: "charIn",
									enabled: true,
									params: { opacity: 0 },
									channels: { opacity: true },
								},
							],
							tracks: [
								{
									path: "textAnim.c1.progress",
									keys: [
										{ t: 0, v: 0 },
										{ t: 0.5, v: 1 },
									],
								},
							],
						}
					: null,
		});
		expect(pose.opacity).toBeLessThan(1);
		expect(pose).not.toEqual(TEXT_MOTION_IDENTITY);
	});


});
