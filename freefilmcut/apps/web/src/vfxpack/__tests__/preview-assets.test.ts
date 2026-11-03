import { describe, expect, test } from "bun:test";
import { packLibraryThumb, resolvePackPreviewUrls } from "@/vfxpack/preview-assets";
import type { LoadedVfxPack, VfxManifest } from "@/vfxpack/types";

function manifest(preview?: VfxManifest["preview"]): VfxManifest {
	return {
		schema: "vfxpack/1.3",
		id: "pack",
		version: "1",
		displayName: "Pack",
		type: "effect",
		preview,
	};
}

describe("pack library preview", () => {
	test("uses the exported poster and hover gif", () => {
		const objectUrls = new Map([
			["textures/atlas.png", "blob:atlas"],
			["preview/poster.png", "blob:poster"],
			["preview/hover.gif", "blob:hover"],
		]);
		expect(
			resolvePackPreviewUrls({
				manifest: manifest({
					poster: "preview/poster.png",
					hover: "preview/hover.gif",
				}),
				objectUrls,
			}),
		).toEqual({ poster: "blob:poster", hover: "blob:hover" });
	});

	test("keeps poster when hover gif is missing", () => {
		const pack = {
			manifest: manifest({ poster: "preview/poster.png" }),
			objectUrls: new Map([
				["preview/poster.png", "blob:poster"],
				["textures/atlas.png", "blob:atlas"],
			]),
		} as LoadedVfxPack;
		expect(packLibraryThumb({ pack })).toEqual({
			poster: "blob:poster",
			hover: null,
		});
	});

	test("returns null poster when cover png is missing so UI can show default icon", () => {
		const pack = {
			manifest: manifest(),
			objectUrls: new Map([
				["shaders/main.frag.glsl", "blob:shader"],
				["textures/atlas.png", "blob:atlas"],
			]),
		} as LoadedVfxPack;
		expect(packLibraryThumb({ pack })).toEqual({
			poster: null,
			hover: null,
		});
	});

	test("does not invent a poster from hover gif alone", () => {
		const pack = {
			manifest: manifest({ hover: "preview/hover.gif" }),
			objectUrls: new Map([["preview/hover.gif", "blob:hover"]]),
		} as LoadedVfxPack;
		expect(packLibraryThumb({ pack })).toEqual({
			poster: null,
			hover: "blob:hover",
		});
	});
});
