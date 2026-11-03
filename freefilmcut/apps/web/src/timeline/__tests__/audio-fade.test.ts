import { describe, expect, test } from "bun:test";
import {
	needsTimeVaryingAudioGain,
	resolveAudioFadeEnvelope,
	resolveEffectiveAudioGain,
} from "@/timeline/audio-state";
import { mediaTimeFromSeconds } from "@/wasm";
import type { VideoElement } from "@/timeline";

function makeVideo({
	durationSec,
	fadeInSec = 0,
	fadeOutSec = 0,
	volumeDb = 0,
}: {
	durationSec: number;
	fadeInSec?: number;
	fadeOutSec?: number;
	volumeDb?: number;
}): VideoElement {
	return {
		id: "v1",
		type: "video",
		name: "clip",
		mediaId: "m1",
		startTime: mediaTimeFromSeconds({ seconds: 0 }),
		duration: mediaTimeFromSeconds({ seconds: durationSec }),
		trimStart: mediaTimeFromSeconds({ seconds: 0 }),
		trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
		params: {
			volume: volumeDb,
			fadeInSec,
			fadeOutSec,
		},
	} as VideoElement;
}

describe("audio fade envelope", () => {
	test("fade in ramps 0 → 1 over the first second", () => {
		const element = makeVideo({ durationSec: 5, fadeInSec: 1 });
		expect(resolveAudioFadeEnvelope({ element, localTime: 0 })).toBe(0);
		expect(resolveAudioFadeEnvelope({ element, localTime: 0.5 })).toBeCloseTo(
			0.5,
			5,
		);
		expect(resolveAudioFadeEnvelope({ element, localTime: 1 })).toBe(1);
		expect(resolveAudioFadeEnvelope({ element, localTime: 2 })).toBe(1);
	});

	test("fade out ramps 1 → 0 over the last second", () => {
		const element = makeVideo({ durationSec: 5, fadeOutSec: 1 });
		expect(resolveAudioFadeEnvelope({ element, localTime: 3 })).toBe(1);
		expect(resolveAudioFadeEnvelope({ element, localTime: 4.5 })).toBeCloseTo(
			0.5,
			5,
		);
		expect(resolveAudioFadeEnvelope({ element, localTime: 5 })).toBe(0);
	});

	test("effective gain multiplies volume dB by the envelope", () => {
		const element = makeVideo({
			durationSec: 4,
			fadeInSec: 1,
			volumeDb: 0,
		});
		expect(resolveEffectiveAudioGain({ element, localTime: 0 })).toBe(0);
		expect(resolveEffectiveAudioGain({ element, localTime: 0.5 })).toBeCloseTo(
			0.5,
			5,
		);
		expect(resolveEffectiveAudioGain({ element, localTime: 2 })).toBeCloseTo(
			1,
			5,
		);
	});

	test("needsTimeVaryingAudioGain when fade is set", () => {
		expect(
			needsTimeVaryingAudioGain({
				element: makeVideo({ durationSec: 3, fadeInSec: 1 }),
			}),
		).toBe(true);
		expect(
			needsTimeVaryingAudioGain({
				element: makeVideo({ durationSec: 3 }),
			}),
		).toBe(false);
	});
});
