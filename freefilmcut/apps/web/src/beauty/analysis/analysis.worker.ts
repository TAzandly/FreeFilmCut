/// <reference lib="webworker" />

import {
	analyzeBeautyFrame,
	beautyFrameFrom,
	composeSkinMask,
	detectBeautyFaces,
} from "./face-body-analysis";
import { preloadMediapipeFace } from "./mediapipe-face";
import { preloadSkinSegmentation, segmentSkin } from "./segment-skin";
import type { BeautyAnalysisFrame } from "./types";
import type {
	BeautyWorkerRequest,
	BeautyWorkerResponse,
	PriorSkin,
} from "./worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: BeautyWorkerResponse, transfer: Transferable[] = []) {
	scope.postMessage(message, transfer);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function frameBuffers(frame: BeautyAnalysisFrame): Transferable[] {
	const buffers = new Set<ArrayBuffer>();
	buffers.add(frame.skinMask.buffer as ArrayBuffer);
	for (const face of frame.faces) buffers.add(face.points.buffer as ArrayBuffer);
	return [...buffers];
}

async function analyzeExact(
	clipId: string,
	mediaTimeTicks: number,
	bitmap: ImageBitmap,
): Promise<{ frame: BeautyAnalysisFrame; cacheable: boolean }> {
	// The main thread owns the cache; this only records whether the result
	// would have been cached (i.e. detection did not fail).
	let cacheable = false;
	const cache = {
		get: () => undefined,
		set: () => {
			cacheable = true;
		},
	};
	const frame = await analyzeBeautyFrame(
		{ clipId, mediaTimeTicks, image: bitmap },
		{ cache },
	);
	return { frame, cacheable };
}

async function analyzeFaces(
	clipId: string,
	mediaTimeTicks: number,
	bitmap: ImageBitmap,
	prior: PriorSkin | null,
): Promise<{ frame: BeautyAnalysisFrame; cacheable: boolean }> {
	const detection = await detectBeautyFaces(bitmap);
	// Smooth/whiten use full-frame skin; hold the last mask until the skin
	// lane refreshes (no face-mesh re-alignment — body skin must stay put).
	const seg = prior
		? { width: prior.width, height: prior.height, mask: prior.mask }
		: null;
	const frame = beautyFrameFrom(
		clipId,
		mediaTimeTicks,
		detection,
		composeSkinMask(detection.faces, seg, detection.boxes),
	);
	// The client never caches this approximate frame; `cacheable` only tells it
	// whether the exact frame built from these faces may be cached.
	return { frame, cacheable: !detection.failed };
}

async function handle(message: BeautyWorkerRequest): Promise<void> {
	if (message.type === "warmup") {
		try {
			if (message.lane === "faces") await preloadMediapipeFace();
			else await preloadSkinSegmentation();
			post({ type: "warmup", ok: true });
		} catch (error) {
			post({ type: "warmup", ok: false, error: errorText(error) });
		}
		return;
	}

	if (message.type === "skin") {
		const { id, bitmap } = message;
		try {
			const detection = message.detectFaces ? await detectBeautyFaces(bitmap) : null;
			const seg = await segmentSkin(bitmap);
			const transfer: Transferable[] = seg ? [seg.mask.buffer as ArrayBuffer] : [];
			for (const face of detection?.faces ?? []) {
				transfer.push(face.points.buffer as ArrayBuffer);
			}
			post({ type: "skin", id, ok: true, seg, detection }, transfer);
		} catch (error) {
			post({ type: "skin", id, ok: false, error: errorText(error) });
		} finally {
			bitmap.close();
		}
		return;
	}

	const { id, clipId, mediaTimeTicks, bitmap } = message;
	try {
		const { frame, cacheable } =
			message.type === "analyze"
				? await analyzeExact(clipId, mediaTimeTicks, bitmap)
				: await analyzeFaces(clipId, mediaTimeTicks, bitmap, message.prior);
		post({ type: "result", id, ok: true, frame, cacheable }, frameBuffers(frame));
	} catch (error) {
		post({ type: "result", id, ok: false, error: errorText(error) });
	} finally {
		bitmap.close();
	}
}

// One job at a time: ORT sessions must not run concurrently.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent<BeautyWorkerRequest>) => {
	queue = queue.then(() => handle(event.data));
};
