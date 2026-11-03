import { afterEach, describe, expect, test } from "bun:test";
import { getVisibleElementsWithBounds } from "@/preview/element-bounds";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import type { EffectElement, SceneTracks } from "@/timeline";
import { toVfxPackEffectType } from "@/vfxpack/effect-id";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { mediaTime, ZERO_MEDIA_TIME } from "@/wasm";

function pack({
	id,
	type,
}: {
	id: string;
	type: string;
}): LoadedVfxPack {
	return {
		id,
		displayName: id,
		type,
		scope: "stack",
		manifest: {
			schema: "freecapcut.vfxpack/1",
			id,
			version: "1",
			displayName: id,
			type,
			resolution: { width: 400, height: 400 },
		},
		scene: null,
		files: new Map(),
		objectUrls: new Map(),
		sourceFileName: `${id}.vfxpack`,
	};
}

function effectElement({
	packId,
	params = {},
}: {
	packId: string;
	params?: EffectElement["params"];
}): EffectElement {
	return {
		id: "clip",
		type: "effect",
		name: packId,
		effectType: toVfxPackEffectType({ packId }),
		startTime: ZERO_MEDIA_TIME,
		duration: mediaTime({ ticks: 100 }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params,
	};
}

function tracks(element: EffectElement): SceneTracks {
	return {
		overlay: [
			{
				id: "fx",
				name: "Effect",
				type: "effect",
				hidden: false,
				elements: [element],
			},
		],
		main: {
			id: "main",
			name: "Main",
			type: "video",
			elements: [],
			transitions: [],
			muted: false,
			hidden: false,
		},
		audio: [],
	};
}

describe("sticker pack canvas", () => {
	afterEach(() => {
		usePackRegistry.setState({ packs: [], activeOverlayIds: [] });
	});

	test("a sticker can be hit on the canvas at its placed size", () => {
		usePackRegistry.getState().registerPack(pack({ id: "heart", type: "sticker" }));
		const visible = getVisibleElementsWithBounds({
			tracks: tracks(
				effectElement({
					packId: "heart",
					params: {
						"transform.positionX": 40,
						"transform.positionY": -10,
						"transform.scaleX": 1,
						"transform.scaleY": 1,
						"transform.rotate": 15,
					},
				}),
			),
			currentTime: 0,
			canvasSize: { width: 1080, height: 1920 },
			mediaAssets: [],
		});

		expect(visible).toHaveLength(1);
		expect(visible[0]?.bounds.width).toBeCloseTo(1080);
		expect(visible[0]?.bounds.height).toBeCloseTo(1080);
		expect(visible[0]?.bounds.cx).toBeCloseTo(580);
		expect(visible[0]?.bounds.cy).toBeCloseTo(950);
		expect(visible[0]?.bounds.rotation).toBe(15);
	});

	test("an effect pack does not get a canvas box", () => {
		usePackRegistry.getState().registerPack(pack({ id: "glow", type: "effect" }));
		const visible = getVisibleElementsWithBounds({
			tracks: tracks(effectElement({ packId: "glow" })),
			currentTime: 0,
			canvasSize: { width: 1080, height: 1920 },
			mediaAssets: [],
		});
		expect(visible).toHaveLength(0);
	});

	test("sticker scale, position, and rotation can be keyframed", () => {
		usePackRegistry.getState().registerPack(pack({ id: "heart", type: "sticker" }));
		const element = effectElement({ packId: "heart" });
		expect(
			resolveAnimationTarget({ element, path: "transform.positionX" }),
		).not.toBeNull();
		expect(
			resolveAnimationTarget({ element, path: "transform.rotate" }),
		).not.toBeNull();
		expect(
			resolveAnimationTarget({ element, path: "transform.scaleY" }),
		).not.toBeNull();
	});
});
