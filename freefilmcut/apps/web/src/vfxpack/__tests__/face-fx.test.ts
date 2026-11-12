import { describe, expect, test } from "bun:test";
import {
	createDefaultFaceFx,
	normalizeFaceFx,
} from "@/vfxpack/face-fx";
import {
	getVfxPackPlacement,
	normalizeVfxPackType,
} from "@/vfxpack/pack-placement";
import { packNeedsBelowInput } from "@/vfxpack/below-input";

describe("face-fx pack type", () => {
	test("normalizeVfxPackType accepts face-fx and aliases", () => {
		expect(normalizeVfxPackType("face-fx")).toBe("face-fx");
		expect(normalizeVfxPackType("Face-FX")).toBe("face-fx");
		expect(normalizeVfxPackType("facefx")).toBe("face-fx");
		expect(normalizeVfxPackType("face_fx")).toBe("face-fx");
	});

	test("placement matches filter (effect track)", () => {
		const p = getVfxPackPlacement({ type: "face-fx" });
		expect(p.type).toBe("face-fx");
		expect(p.insertTrackType).toBe("effect");
		expect(p.targetElementTypes).toEqual([]);
		expect(p.dragHint).toContain("effect track");
	});

	test("packNeedsBelowInput is true for face-fx + below", () => {
		expect(packNeedsBelowInput({ type: "face-fx", scope: null })).toBe(true);
		expect(packNeedsBelowInput({ type: "face-fx", scope: "" })).toBe(true);
		expect(packNeedsBelowInput({ type: "face-fx", scope: "below" })).toBe(
			true,
		);
		expect(packNeedsBelowInput({ type: "face-fx", scope: "stack" })).toBe(
			false,
		);
	});
});

describe("normalizeFaceFx", () => {
	test("null yields empty default", () => {
		expect(normalizeFaceFx(null)).toEqual(createDefaultFaceFx());
		expect(normalizeFaceFx(undefined).layers).toEqual([]);
	});

	test("keeps valid layers and drops unknown kinds", () => {
		const cfg = normalizeFaceFx({
			driver: { landmarks: true, transformationMatrix: false, maxFaces: 2 },
			layers: [
				{
					id: "ears",
					kind: "anchor3d",
					asset: "models/ears.glb",
					bind: "forehead",
					offset: [0, 0.02, 0],
					scale: 1.2,
				},
				{
					id: "laser",
					kind: "eyeRay",
					color: "#00ff88",
					length: 1.5,
					width: 0.02,
				},
				{
					id: "fun",
					kind: "warp2d",
					preset: "stretchY",
					strength: 0.8,
					region: "cheeks",
				},
				{ id: "bad", kind: "particles" },
			],
		});
		expect(cfg.driver).toEqual({
			landmarks: true,
			transformationMatrix: false,
			maxFaces: 2,
		});
		expect(cfg.layers.map((l) => l.kind)).toEqual([
			"anchor3d",
			"eyeRay",
			"warp2d",
		]);
		expect(cfg.layers[0]).toMatchObject({
			id: "ears",
			asset: "models/ears.glb",
			bind: "forehead",
			scale: 1.2,
		});
		expect(cfg.layers[1]).toMatchObject({
			kind: "eyeRay",
			color: "#00ff88",
			length: 1.5,
		});
		expect(cfg.layers[2]).toMatchObject({
			kind: "warp2d",
			preset: "stretchY",
			region: "cheeks",
		});
	});

	test("clamps maxFaces and defaults bad bind/preset", () => {
		const cfg = normalizeFaceFx({
			driver: { maxFaces: 99 },
			layers: [
				{ kind: "anchor3d", bind: "chin", asset: "a.glb" },
				{ kind: "warp2d", preset: "melt", strength: 9 },
			],
		});
		expect(cfg.driver.maxFaces).toBe(8);
		expect(cfg.layers[0]).toMatchObject({ bind: "forehead" });
		expect(cfg.layers[1]).toMatchObject({
			preset: "bulge",
			strength: 2,
		});
	});
});
