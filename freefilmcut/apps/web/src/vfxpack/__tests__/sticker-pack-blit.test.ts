import { afterEach, describe, expect, test } from "bun:test";
import {
	resolveStickerPackRenderSize,
	scaleStickerPlacementToBuffer,
	stickerBlitCenterInBuffer,
} from "@/vfxpack/sticker-pack-blit";
import { stickerPackSourceSize } from "@/vfxpack/sticker-canvas";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import type { LoadedVfxPack } from "@/vfxpack/types";

function pack({
	id,
	resolution,
}: {
	id: string;
	resolution: { width: number; height: number };
}): LoadedVfxPack {
	return {
		id,
		displayName: id,
		type: "sticker",
		scope: "stack",
		manifest: {
			schema: "freecapcut.vfxpack/1",
			id,
			version: "1",
			displayName: id,
			type: "sticker",
			resolution,
		},
		scene: null,
		files: new Map(),
		objectUrls: new Map(),
		sourceFileName: `${id}.vfxpack`,
	};
}

describe("sticker pack blit placement", () => {
	afterEach(() => {
		usePackRegistry.setState({ packs: [], activeOverlayIds: [] });
	});

	test("logical position scales into buffer space by contentScale", () => {
		const scaled = scaleStickerPlacementToBuffer({
			placement: {
				scaleX: 1,
				scaleY: 1,
				positionX: 40,
				positionY: -10,
				rotate: 15,
			},
			contentScale: 0.5,
		});
		expect(scaled.positionX).toBeCloseTo(20);
		expect(scaled.positionY).toBeCloseTo(-5);
		expect(scaled.rotate).toBe(15);
	});

	test("400×400 pack render size matches selection-bounds source size", () => {
		const heart = pack({
			id: "heart",
			resolution: { width: 400, height: 400 },
		});
		usePackRegistry.getState().registerPack(heart);

		const renderSize = resolveStickerPackRenderSize({
			packId: "heart",
			builtResolution: { width: 1920, height: 1080 },
		});
		const boundsSize = stickerPackSourceSize({ pack: heart });

		expect(renderSize).toEqual(boundsSize);
		expect(renderSize.width).toBe(400);
		expect(renderSize.height).toBe(400);
	});

	test("blit center matches bounds center mapped through contentScale", () => {
		const logicalW = 1080;
		const logicalH = 1920;
		const contentScale = 0.5;
		const bufferW = logicalW * contentScale;
		const bufferH = logicalH * contentScale;
		const sourceW = 400;
		const sourceH = 400;
		const posX = 40;
		const posY = -10;

		// Selection bounds (logical canvas)
		const containLogical = Math.min(logicalW / sourceW, logicalH / sourceH);
		const boundsCx = logicalW / 2 + posX;
		const boundsCy = logicalH / 2 + posY;
		const boundsW = sourceW * containLogical;

		const blit = stickerBlitCenterInBuffer({
			bufferWidth: bufferW,
			bufferHeight: bufferH,
			sourceWidth: sourceW,
			sourceHeight: sourceH,
			logicalPositionX: posX,
			logicalPositionY: posY,
			contentScale,
		});

		expect(blit.x).toBeCloseTo(boundsCx * contentScale);
		expect(blit.y).toBeCloseTo(boundsCy * contentScale);
		expect(blit.width).toBeCloseTo(boundsW * contentScale);
	});

	test("never falls back to canvas size when pack resolution is 400", () => {
		usePackRegistry.getState().registerPack(
			pack({ id: "heart", resolution: { width: 400, height: 400 } }),
		);
		const size = resolveStickerPackRenderSize({
			packId: "heart",
			builtResolution: { width: 1080, height: 1920 },
		});
		expect(size).toEqual({ width: 400, height: 400 });
	});

	test("manifest 400 wins over scene rewritten to project canvas", () => {
		const heart = pack({
			id: "heart",
			resolution: { width: 400, height: 400 },
		});
		heart.scene = {
			schema: "freecapcut.scene/1",
			revision: 1,
			nodes: [],
			resolution: { width: 1080, height: 1920 },
		} as LoadedVfxPack["scene"];
		usePackRegistry.getState().registerPack(heart);

		expect(stickerPackSourceSize({ pack: heart })).toEqual({
			width: 400,
			height: 400,
		});
		expect(
			resolveStickerPackRenderSize({
				packId: "heart",
				builtResolution: { width: 1080, height: 1920 },
			}),
		).toEqual({ width: 400, height: 400 });
	});
});
