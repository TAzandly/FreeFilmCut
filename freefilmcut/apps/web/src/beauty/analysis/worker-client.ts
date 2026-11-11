import {
	BEAUTY_ANALYSIS_TICK_QUANTUM,
	quantizeMediaTimeTicks,
} from "./cache";
import {
	type AnalyzeBeautyFrameParams,
	type BeautyFaceDetection,
	analyzeBeautyFrame,
	beautyAnalysisCache,
	beautyFrameFrom,
	composeSkinMask,
} from "./face-body-analysis";
import type { SkinSegmentation } from "./segment-skin";
import type { BeautyAnalysisFrame } from "./types";
import type {
	BeautyWorkerRequest,
	BeautyWorkerResponse,
	PriorSkin,
} from "./worker-protocol";

/** A prior full-frame skin mask is reused for at most this long (1 s). */
export const BEAUTY_PRIOR_SKIN_MAX_TICKS = 120_000;

type Job = Exclude<BeautyWorkerRequest, { type: "warmup" }>;
type JobResponse = Exclude<BeautyWorkerResponse, { type: "warmup" }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never;

/** One dedicated worker; `ready` resolves false when it cannot load its models. */
class WorkerLane {
	private worker: Worker | null = null;
	private ready: Promise<boolean> | null = null;
	private failed = false;
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (r: JobResponse) => void; reject: (e: Error) => void }
	>();

	constructor(private readonly lane: "faces" | "skin") {}

	/** Resolves true once the worker has loaded its models. */
	available(): Promise<boolean> {
		if (this.failed || typeof Worker === "undefined") return Promise.resolve(false);
		if (this.ready) return this.ready;
		let worker: Worker;
		try {
			worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
				type: "module",
			});
		} catch (error) {
			this.fail(error instanceof Error ? error.message : String(error));
			return Promise.resolve(false);
		}
		this.worker = worker;
		this.ready = new Promise<boolean>((resolve) => {
			worker.onmessage = (event: MessageEvent<BeautyWorkerResponse>) => {
				const message = event.data;
				if (message.type === "warmup") {
					if (!message.ok) this.fail(message.error);
					resolve(message.ok);
					return;
				}
				const job = this.pending.get(message.id);
				if (!job) return;
				this.pending.delete(message.id);
				job.resolve(message);
			};
			worker.onerror = (event) => {
				event.preventDefault();
				this.fail(event.message || "worker error");
				resolve(false);
			};
		});
		const warmup: BeautyWorkerRequest = { type: "warmup", lane: this.lane };
		worker.postMessage(warmup);
		return this.ready;
	}

	call(job: DistributiveOmit<Job, "id">, transfer: Transferable[]): Promise<JobResponse> {
		const worker = this.worker;
		if (!worker || this.failed) {
			return Promise.reject(new Error(`beauty ${this.lane} worker unavailable`));
		}
		const id = this.nextId++;
		return new Promise<JobResponse>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			worker.postMessage({ ...job, id } as Job, transfer);
		});
	}

	private fail(reason: string): void {
		if (this.failed) return;
		this.failed = true;
		if (this.lane === "faces") {
			console.warn(
				`[beauty] analysis worker unavailable (${reason}); analysing on the main thread`,
			);
		}
		this.worker?.terminate();
		this.worker = null;
		for (const job of this.pending.values()) {
			job.reject(new Error(`beauty ${this.lane} worker stopped`));
		}
		this.pending.clear();
	}
}

const facesLane = new WorkerLane("faces");
const skinLane = new WorkerLane("skin");

function isBitmap(image: unknown): image is ImageBitmap {
	return typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
}

type FacesResult = { frame: BeautyAnalysisFrame; cacheable: boolean };

async function runFacesJob(job: DistributiveOmit<Job, "id">, bitmap: ImageBitmap) {
	const response = await facesLane.call(job, [bitmap]);
	if (response.type !== "result") throw new Error("unexpected worker reply");
	if (!response.ok) throw new Error(response.error);
	return { frame: response.frame, cacheable: response.cacheable } as FacesResult;
}

/**
 * Exact analysis (export) in the worker; main-thread fallback for non-bitmap
 * sources or when the worker cannot load. Cacheable results are cached.
 */
export async function analyzeBeautyFrameOffThread(
	params: AnalyzeBeautyFrameParams,
): Promise<BeautyAnalysisFrame> {
	const { clipId, mediaTimeTicks, image } = params;
	if (!isBitmap(image) || !(await facesLane.available())) {
		return analyzeBeautyFrame(params);
	}
	const cached = beautyAnalysisCache.get(clipId, mediaTimeTicks);
	if (cached) {
		image.close();
		return cached;
	}
	const { frame, cacheable } = await runFacesJob(
		{ type: "analyze", clipId, mediaTimeTicks, bitmap: image },
		image,
	);
	if (cacheable) beautyAnalysisCache.set(clipId, mediaTimeTicks, frame);
	return frame;
}

// ---- Preview: fast face lane + slow skin lane --------------------------------

type SkinEntry = {
	clipId: string;
	mediaTimeTicks: number;
	generation: number;
	bitmap: ImageBitmap;
	faces: Promise<FacesResult | null>;
	onRefined?: () => void;
};

/** A momentary MediaPipe miss keeps the last faces this long (0.5 s). */
export const BEAUTY_FACE_HOLD_TICKS = 60_000;

const priors = new Map<string, { ticksKey: number; prior: PriorSkin }>();
const heldFaces = new Map<string, { ticksKey: number; frame: BeautyAnalysisFrame }>();
const generations = new Map<string, number>();
let skinBusy = false;
let skinNext: SkinEntry | null = null;

function generationOf(clipId: string): number {
	return generations.get(clipId) ?? 0;
}

/** Drop a clip's prior masks and ignore its in-flight skin results. */
export function invalidateBeautyPreviewClip(clipId: string | null): void {
	if (clipId === null) {
		const known = [...generations.keys(), ...priors.keys(), ...heldFaces.keys()];
		if (skinNext) known.push(skinNext.clipId);
		for (const id of new Set(known)) {
			generations.set(id, generationOf(id) + 1);
		}
		priors.clear();
		heldFaces.clear();
		return;
	}
	generations.set(clipId, generationOf(clipId) + 1);
	priors.delete(clipId);
	heldFaces.delete(clipId);
}

function priorFor(clipId: string, ticksKey: number): PriorSkin | null {
	const entry = priors.get(clipId);
	if (!entry) return null;
	return Math.abs(entry.ticksKey - ticksKey) <= BEAUTY_PRIOR_SKIN_MAX_TICKS
		? entry.prior
		: null;
}

function queueSkin(entry: SkinEntry): void {
	if (!skinBusy) {
		void runSkin(entry);
		return;
	}
	// Only the newest frame matters; the skipped snapshot is released.
	skinNext?.bitmap.close();
	skinNext = entry;
}

async function runSkin(entry: SkinEntry): Promise<void> {
	skinBusy = true;
	try {
		const faces = await entry.faces;
		const needFaces = !faces || faces.frame.faces.length === 0;
		// Faceless frames are often blank mid-seek; prefer a newer queued frame.
		if (needFaces && skinNext) {
			entry.bitmap.close();
			return;
		}
		let seg: SkinSegmentation | null = null;
		let detection: BeautyFaceDetection | null = null;
		try {
			const response = await skinLane.call(
				{ type: "skin", bitmap: entry.bitmap, detectFaces: needFaces },
				[entry.bitmap],
			);
			if (response.type === "skin" && response.ok) {
				seg = response.seg;
				detection = response.detection;
			}
		} catch {
			seg = null;
		}
		const { clipId, mediaTimeTicks } = entry;
		if (!seg || generationOf(clipId) !== entry.generation) return;
		if (!detection) {
			if (!faces) return;
			detection = {
				faces: faces.frame.faces,
				boxes:
					faces.frame.skinBoxes ?? faces.frame.faces.map((f) => f.box),
				source:
					faces.frame.source === "landmarks-only-mask"
						? "mediapipe"
						: faces.frame.source,
				failed: !faces.cacheable,
			};
		}
		priors.set(clipId, {
			ticksKey: quantizeMediaTimeTicks(
				mediaTimeTicks,
				BEAUTY_ANALYSIS_TICK_QUANTUM,
			),
			prior: { ...seg, faces: detection.faces },
		});
		if (!detection.failed) {
			beautyAnalysisCache.set(
				clipId,
				mediaTimeTicks,
				beautyFrameFrom(
					clipId,
					mediaTimeTicks,
					detection,
					composeSkinMask(detection.faces, seg, detection.boxes),
				),
			);
		}
		entry.onRefined?.();
	} finally {
		skinBusy = false;
		const next = skinNext;
		skinNext = null;
		if (next) void runSkin(next);
	}
}

/**
 * Preview analysis that keeps up with playback: faces are detected every call
 * (fast lane) for warp; the skin mask is the latest full-frame segmentation
 * (slow lane). When the skin lane finishes, the frame is cached and
 * `onRefined` fires.
 */
export async function analyzeBeautyPreviewOffThread(
	params: AnalyzeBeautyFrameParams,
	onRefined?: () => void,
): Promise<BeautyAnalysisFrame> {
	const { clipId, mediaTimeTicks, image } = params;
	if (!isBitmap(image) || !(await facesLane.available())) {
		return analyzeBeautyFrame(params);
	}
	const generation = generationOf(clipId);
	const skinCopy = (await skinLane.available())
		? await createImageBitmap(image).catch(() => null)
		: null;
	const ticksKey = quantizeMediaTimeTicks(mediaTimeTicks, BEAUTY_ANALYSIS_TICK_QUANTUM);
	const faces = runFacesJob(
		{
			type: "faces",
			clipId,
			mediaTimeTicks,
			bitmap: image,
			prior: priorFor(clipId, ticksKey),
		},
		image,
	);
	if (skinCopy) {
		queueSkin({
			clipId,
			mediaTimeTicks,
			generation,
			bitmap: skinCopy,
			faces: faces.catch(() => null),
			onRefined,
		});
	}
	const { frame } = await faces;
	const held = heldFaces.get(clipId);
	if (frame.faces.length > 0) {
		heldFaces.set(clipId, { ticksKey, frame });
		return frame;
	}
	return held &&
		generationOf(clipId) === generation &&
		Math.abs(held.ticksKey - ticksKey) <= BEAUTY_FACE_HOLD_TICKS
		? held.frame
		: frame;
}
