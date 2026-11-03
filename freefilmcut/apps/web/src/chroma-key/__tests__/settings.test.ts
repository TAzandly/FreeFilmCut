import { describe, expect, test } from "bun:test";
import { ZERO_MEDIA_TIME } from "@/wasm";
import {
	DEFAULT_CHROMA_KEY_COLOR,
	parseHexColorToSrgb,
	readChromaKeyFromParams,
	resolveChromaKeyAtTime,
} from "@/chroma-key/settings";

describe("parseHexColorToSrgb", () => {
	test("parses six-digit hex", () => {
		expect(parseHexColorToSrgb({ hex: "#00FF00" })).toEqual([0, 1, 0]);
		expect(parseHexColorToSrgb({ hex: "FF0000" })).toEqual([1, 0, 0]);
	});

	test("expands three-digit hex", () => {
		const [r, g, b] = parseHexColorToSrgb({ hex: "#0f0" });
		expect(r).toBe(0);
		expect(g).toBe(1);
		expect(b).toBe(0);
	});

	test("falls back to the default key colour on garbage", () => {
		expect(parseHexColorToSrgb({ hex: "not-a-colour" })).toEqual(
			parseHexColorToSrgb({ hex: DEFAULT_CHROMA_KEY_COLOR }),
		);
	});
});

describe("readChromaKeyFromParams", () => {
	test("defaults to disabled, but with a key that works once switched on", () => {
		const settings = readChromaKeyFromParams({ params: {} });
		expect(settings.enabled).toBe(false);
		expect(settings.keyColor).toEqual([0, 1, 0]);
		expect(settings.intensity).toBe(45);
		expect(settings.feather).toBe(25);
		expect(settings.soften).toBe(30);
		expect(settings.shadow).toBe(0);
		expect(settings.edgeCleanup).toBe(20);
	});

	test("keeps the 0..100 authoring units the sliders write", () => {
		const settings = readChromaKeyFromParams({
			params: {
				"chromaKey.enabled": true,
				"chromaKey.color": "#0000FF",
				"chromaKey.intensity": 50,
				"chromaKey.shadow": 100,
				"chromaKey.feather": 25,
				"chromaKey.soften": 60,
				"chromaKey.edgeCleanup": 75,
			},
		});
		expect(settings.enabled).toBe(true);
		expect(settings.keyColor).toEqual([0, 0, 1]);
		expect(settings.intensity).toBe(50);
		expect(settings.shadow).toBe(100);
		expect(settings.feather).toBe(25);
		expect(settings.soften).toBe(60);
		expect(settings.edgeCleanup).toBe(75);
	});

	test("clamps out-of-range values instead of trusting the project file", () => {
		const settings = readChromaKeyFromParams({
			params: {
				"chromaKey.enabled": true,
				"chromaKey.intensity": 999,
				"chromaKey.soften": -40,
				"chromaKey.shadow": -40,
			},
		});
		expect(settings.intensity).toBe(100);
		expect(settings.soften).toBe(0);
		expect(settings.shadow).toBe(0);
	});
});

describe("resolveChromaKeyAtTime", () => {
	test("returns the base settings untouched when disabled", () => {
		const base = readChromaKeyFromParams({ params: {} });
		const resolved = resolveChromaKeyAtTime({
			base,
			animations: undefined,
			localTime: ZERO_MEDIA_TIME,
		});
		expect(resolved).toBe(base);
	});

	test("keeps the key colour constant while sampling the sliders", () => {
		const base = readChromaKeyFromParams({
			params: {
				"chromaKey.enabled": true,
				"chromaKey.color": "#FF00FF",
				"chromaKey.intensity": 20,
			},
		});
		const resolved = resolveChromaKeyAtTime({
			base,
			animations: undefined,
			localTime: ZERO_MEDIA_TIME,
		});
		expect(resolved.enabled).toBe(true);
		expect(resolved.keyColor).toEqual([1, 0, 1]);
		// No keyframes → the sampled value equals the base percent.
		expect(resolved.intensity).toBe(20);
		expect(resolved.soften).toBe(base.soften);
	});
});
