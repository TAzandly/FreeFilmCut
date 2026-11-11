import { describe, expect, test } from "bun:test";
import { BeautyAnalysisCache } from "@/beauty/analysis/cache";
import {
	analyzeBeautyFrame,
	clipMaskToFaceBoxes,
	type FaceBodyAnalysisDeps,
	mapCropFaceToFullImage,
	padBoxToPixelRect,
} from "@/beauty/analysis/face-body-analysis";
import { boxFromPoints } from "@/beauty/analysis/mediapipe-face";
import { skinMaskFromSegmentation } from "@/beauty/analysis/selfie-skin";
import type { BeautyImageSource } from "@/beauty/analysis/image-source";
import type { FaceBox, FaceLandmarks } from "@/beauty/analysis/types";
import {
	computeLetterbox,
	decodeYoloFaceOutput,
	nonMaxSuppression,
} from "@/beauty/analysis/yolo-face";

const IMAGE = { id: "image" } as unknown as BeautyImageSource;
const CROP = { id: "crop" } as unknown as BeautyImageSource;

/** 478 points all clustered near a centre so box / polygons are well-defined. */
function makeFace(cx: number, cy: number, r = 0.1): FaceLandmarks {
	const points = new Float32Array(478 * 2);
	for (let i = 0; i < 478; i++) {
		const a = (i / 478) * Math.PI * 2;
		points[i * 2] = cx + Math.cos(a) * r;
		points[i * 2 + 1] = cy + Math.sin(a) * r;
	}
	return { points, box: boxFromPoints(points) };
}

function makeDeps(
	overrides: Partial<FaceBodyAnalysisDeps> = {},
): FaceBodyAnalysisDeps {
	return {
		cache: new BeautyAnalysisCache(),
		detectFaces: async () => [],
		detectYoloBoxes: async () => [],
		segmentSkin: async () => null,
		cropImage: () => CROP,
		getImageSize: () => ({ width: 1000, height: 500 }),
		...overrides,
	};
}

describe("analyzeBeautyFrame", () => {
	test("returns cached frame without detecting", async () => {
		let calls = 0;
		const deps = makeDeps({
			detectFaces: async () => {
				calls++;
				return [makeFace(0.5, 0.5)];
			},
		});
		const params = { clipId: "c", mediaTimeTicks: 0, image: IMAGE };
		const a = await analyzeBeautyFrame(params, deps);
		const b = await analyzeBeautyFrame(params, deps);
		expect(b).toBe(a);
		expect(calls).toBe(1);
	});

	test("mediapipe faces + selfie skin -> source mediapipe, mask clipped to faces", async () => {
		const mask = new Uint8Array(256 * 256).fill(255);
		const deps = makeDeps({
			detectFaces: async () => [makeFace(0.5, 0.5, 0.1)],
			segmentSkin: async () => ({ width: 256, height: 256, mask }),
		});
		const frame = await analyzeBeautyFrame(
			{ clipId: "c", mediaTimeTicks: 0, image: IMAGE },
			deps,
		);
		expect(frame.source).toBe("mediapipe");
		expect(frame.faces).toHaveLength(1);
		expect(frame.skinWidth).toBe(256);
		expect(frame.skinMask[128 * 256 + 128]).toBe(255);
		expect(frame.skinMask[0]).toBe(0);
	});

	test("no faces -> yolo crop -> mediapipe on crop maps to full image", async () => {
		const yolo: FaceBox = { x: 0.4, y: 0.4, w: 0.2, h: 0.4 };
		const detectImages: BeautyImageSource[] = [];
		const deps = makeDeps({
			detectYoloBoxes: async () => [yolo],
			detectFaces: async (img) => {
				detectImages.push(img);
				return img === CROP ? [makeFace(0.5, 0.5, 0.2)] : [];
			},
		});
		const frame = await analyzeBeautyFrame(
			{ clipId: "c", mediaTimeTicks: 0, image: IMAGE },
			deps,
		);
		expect(detectImages).toEqual([IMAGE, CROP]);
		expect(frame.source).toBe("landmarks-only-mask");
		expect(frame.faces).toHaveLength(1);
		// Crop centre (0.5, 0.5) maps to the yolo box centre (0.5, 0.6).
		const face = frame.faces[0];
		const centerX = face.box.x + face.box.w / 2;
		const centerY = face.box.y + face.box.h / 2;
		expect(centerX).toBeCloseTo(0.5, 2);
		expect(centerY).toBeCloseTo(0.6, 2);
	});

	test("yolo+mediapipe source when selfie skin succeeds", async () => {
		const deps = makeDeps({
			detectYoloBoxes: async () => [{ x: 0.4, y: 0.3, w: 0.2, h: 0.4 }],
			detectFaces: async (img) =>
				img === CROP ? [makeFace(0.5, 0.5, 0.2)] : [],
			segmentSkin: async () => ({
				width: 256,
				height: 256,
				mask: new Uint8Array(256 * 256).fill(255),
			}),
		});
		const frame = await analyzeBeautyFrame(
			{ clipId: "c", mediaTimeTicks: 0, image: IMAGE },
			deps,
		);
		expect(frame.source).toBe("yolo+mediapipe");
	});

	test("skin fallback with faces uses landmarks-only-mask and fills the face", async () => {
		const deps = makeDeps({
			detectFaces: async () => [makeFace(0.5, 0.5, 0.2)],
		});
		const frame = await analyzeBeautyFrame(
			{ clipId: "c", mediaTimeTicks: 0, image: IMAGE },
			deps,
		);
		expect(frame.source).toBe("landmarks-only-mask");
		expect(frame.skinMask.length).toBe(frame.skinWidth * frame.skinHeight);
	});

	test("no faces anywhere and no skin model keeps detector source, empty mask", async () => {
		const frame = await analyzeBeautyFrame(
			{ clipId: "c", mediaTimeTicks: 0, image: IMAGE },
			makeDeps(),
		);
		expect(frame.source).toBe("mediapipe");
		expect(frame.faces).toHaveLength(0);
		expect(frame.skinMask.every((v) => v === 0)).toBe(true);
	});

	test("detector failure does not throw and is not cached", async () => {
		const cache = new BeautyAnalysisCache();
		const deps = makeDeps({
			cache,
			detectFaces: async () => {
				throw new Error("wasm failed");
			},
		});
		const frame = await analyzeBeautyFrame(
			{ clipId: "c", mediaTimeTicks: 0, image: IMAGE },
			deps,
		);
		expect(frame.faces).toHaveLength(0);
		expect(cache.size).toBe(0);
	});
});

describe("helpers", () => {
	test("padBoxToPixelRect pads 1.3x and clamps", () => {
		const rect = padBoxToPixelRect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1000, 1000);
		expect(rect.w).toBe(260);
		expect(rect.x).toBe(370);
		const clamped = padBoxToPixelRect({ x: 0, y: 0, w: 0.2, h: 0.2 }, 1000, 1000);
		expect(clamped.x).toBe(0);
	});

	test("mapCropFaceToFullImage", () => {
		const face = makeFace(0.5, 0.5, 0.1);
		const mapped = mapCropFaceToFullImage(
			face,
			{ x: 100, y: 200, w: 200, h: 100 },
			1000,
			500,
		);
		expect(mapped.points[0]).toBeCloseTo((100 + face.points[0] * 200) / 1000, 5);
		expect(mapped.points[1]).toBeCloseTo((200 + face.points[1] * 100) / 500, 5);
	});

	test("clipMaskToFaceBoxes", () => {
		const mask = new Uint8Array(100).fill(255);
		const out = clipMaskToFaceBoxes(mask, 10, 10, [
			{ box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } },
		]);
		expect(out[5 * 10 + 5]).toBe(255);
		expect(out[0]).toBe(0);
	});
});

describe("yolo decode", () => {
	test("NMS removes overlapping lower-score boxes", () => {
		const kept = nonMaxSuppression([
			{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, score: 0.9 },
			{ x: 0.11, y: 0.11, w: 0.2, h: 0.2, score: 0.8 },
			{ x: 0.6, y: 0.6, w: 0.2, h: 0.2, score: 0.7 },
		]);
		expect(kept).toHaveLength(2);
		expect(kept[0].score).toBe(0.9);
	});

	test("decodes channels-first [1,5,N] with letterbox mapping", () => {
		// 1000x500 image -> scale .64, padY = (640-320)/2 = 160
		const { scale, padY } = computeLetterbox(1000, 500);
		expect(scale).toBeCloseTo(0.64);
		const n = 32;
		const data = new Float32Array(5 * n);
		// box 0: centre (320, 320) in input space, 128x128, score .9
		data.set([320, 0, 0], 0);
		data.set([320, 0, 0], n);
		data.set([128, 0, 0], 2 * n);
		data.set([128, 0, 0], 3 * n);
		data.set([0.9, 0.1, 0.1], 4 * n);
		const boxes = decodeYoloFaceOutput({
			data,
			dims: [1, 5, n],
			imageWidth: 1000,
			imageHeight: 500,
		});
		expect(boxes).toHaveLength(1);
		expect(boxes[0].x).toBeCloseTo((320 - 64) / scale / 1000, 4);
		expect(boxes[0].y).toBeCloseTo((320 - 64 - padY) / scale / 500, 4);
	});

	test("decodes channels-last [1,N,16] (YOLOv5-face layout)", () => {
		const n = 32;
		const c = 16;
		const data = new Float32Array(n * c);
		data.set([320, 320, 100, 100, 0.8], 0);
		data.set([10, 10, 5, 5, 0.01], c);
		const boxes = decodeYoloFaceOutput({
			data,
			dims: [1, n, c],
			imageWidth: 640,
			imageHeight: 640,
		});
		expect(boxes).toHaveLength(1);
		expect(boxes[0].w).toBeCloseTo(100 / 640, 4);
	});
});

describe("selfie skin decode", () => {
	test("NHWC argmax marks skin classes 2 and 3", () => {
		const h = 1;
		const w = 4;
		const data = new Float32Array(h * w * 6);
		const setClass = (i: number, c: number) => {
			data[i * 6 + c] = 1;
		};
		setClass(0, 0); // background
		setClass(1, 2); // body-skin
		setClass(2, 3); // face-skin
		setClass(3, 4); // clothes
		const result = skinMaskFromSegmentation(data, [1, h, w, 6]);
		expect(Array.from(result?.mask ?? [])).toEqual([0, 255, 255, 0]);
	});

	test("NCHW layout is supported", () => {
		const w = 2;
		const data = new Float32Array(6 * w);
		data[3 * w + 0] = 1; // pixel 0 face-skin
		data[0 * w + 1] = 1; // pixel 1 background
		const result = skinMaskFromSegmentation(data, [1, 6, 1, w]);
		expect(Array.from(result?.mask ?? [])).toEqual([255, 0]);
	});

	test("unexpected shape returns null", () => {
		expect(skinMaskFromSegmentation(new Float32Array(4), [1, 2, 2, 1])).toBeNull();
	});
});
