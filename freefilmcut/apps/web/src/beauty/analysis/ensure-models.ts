import {
	BEAUTY_MODEL_CACHE_NAME,
	BEAUTY_MODEL_DLMV,
	BEAUTY_MODEL_FACE_LANDMARKER,
	BEAUTY_MODEL_REQUIRED,
	BEAUTY_MODEL_SELFIE,
	type BeautyModelEntry,
} from "./model-catalog";
import { configureDlmvSkin } from "./dlmv-skin";
import { configureMediapipeFace } from "./mediapipe-face";
import { configureSelfieSkin } from "./selfie-skin";
import { modelFileExists } from "./ort-runtime";

export type BeautyModelStatus =
	| { phase: "idle" }
	| { phase: "downloading"; percent: number }
	| { phase: "ready" }
	| { phase: "error"; message: string };

export type EnsureBeautyModelsResult = {
	faceLandmarkerUrl: string;
	dlmvUrl: string | null;
	selfieUrl: string | null;
};

export type EnsureBeautyModelsDeps = {
	exists: (url: string) => Promise<boolean>;
	openCache: (name: string) => Promise<Cache>;
	fetchRemote: (url: string) => Promise<Response>;
	createObjectURL: (blob: Blob) => string;
	configureFace: (opts: { modelUrl: string }) => void;
	configureDlmv: (opts: { modelUrl: string }) => void;
	configureSelfie: (opts: { modelUrl: string }) => void;
	now: () => number;
};

const defaultDeps = (): EnsureBeautyModelsDeps => ({
	exists: modelFileExists,
	openCache: (name) => caches.open(name),
	fetchRemote: (url) => fetch(url, { redirect: "follow" }),
	createObjectURL: (blob) => URL.createObjectURL(blob),
	configureFace: (opts) => configureMediapipeFace(opts),
	configureDlmv: (opts) => configureDlmvSkin(opts),
	configureSelfie: (opts) => configureSelfieSkin(opts),
	now: () => Date.now(),
});

let status: BeautyModelStatus = { phase: "idle" };
const listeners = new Set<(next: BeautyModelStatus) => void>();
let inflight: Promise<EnsureBeautyModelsResult> | null = null;
let lastResult: EnsureBeautyModelsResult | null = null;
/** Blob URLs created in this realm (kept for the page lifetime). */
const ownedBlobs = new Set<string>();

export function getBeautyModelStatus(): BeautyModelStatus {
	return status;
}

export function subscribeBeautyModelStatus(
	listener: (next: BeautyModelStatus) => void,
): () => void {
	listeners.add(listener);
	listener(status);
	return () => {
		listeners.delete(listener);
	};
}

function setStatus(next: BeautyModelStatus): void {
	status = next;
	for (const listener of listeners) listener(next);
}

function revokeOwnedBlobs(): void {
	for (const url of ownedBlobs) {
		try {
			URL.revokeObjectURL(url);
		} catch {
			/* ignore */
		}
	}
	ownedBlobs.clear();
}

function rememberBlob(url: string): string {
	if (url.startsWith("blob:")) ownedBlobs.add(url);
	return url;
}

async function readBodyWithProgress(
	response: Response,
	approxBytes: number,
	onBytes: (loaded: number, total: number) => void,
): Promise<Blob> {
	const totalHeader = Number(response.headers.get("content-length") || 0);
	const total = totalHeader > 0 ? totalHeader : approxBytes;
	if (!response.body || typeof response.body.getReader !== "function") {
		const blob = await response.blob();
		onBytes(blob.size, Math.max(total, blob.size));
		return blob;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			loaded += value.byteLength;
			onBytes(loaded, Math.max(total, loaded));
		}
	}
	return new Blob(chunks as BlobPart[]);
}

export type ResolveModelProgress = {
	/** Bytes completed across the whole ensure session. */
	completedBytes: number;
	/** Planned bytes for this ensure session. */
	plannedBytes: number;
};

/**
 * Resolve one model to a usable URL (local path or blob from Cache API).
 * Pure enough to unit-test with injected deps.
 */
export async function resolveBeautyModelUrl(
	entry: BeautyModelEntry,
	deps: EnsureBeautyModelsDeps,
	onProgress?: (deltaLoaded: number, fileTotal: number) => void,
): Promise<string> {
	const local = entry.localPath;
	if (await deps.exists(local)) return local;

	if (typeof caches === "undefined" && !deps.openCache) {
		throw new Error(`Cache API unavailable; cannot download ${entry.id}`);
	}

	const cache = await deps.openCache(BEAUTY_MODEL_CACHE_NAME);
	// Stable same-origin path key (not absolute URL) so main + worker share hits.
	const cacheKey = local;
	const cached = await cache.match(cacheKey);
	if (cached) {
		const blob = await cached.blob();
		onProgress?.(blob.size, blob.size);
		return rememberBlob(deps.createObjectURL(blob));
	}

	const response = await deps.fetchRemote(entry.remoteUrl);
	if (!response.ok) {
		throw new Error(
			`Failed to download ${entry.id}: HTTP ${response.status}`,
		);
	}
	const blob = await readBodyWithProgress(
		response,
		entry.approxBytes,
		(loaded, total) => onProgress?.(loaded, total),
	);
	await cache.put(
		cacheKey,
		new Response(blob, {
			headers: {
				"Content-Type":
					blob.type ||
					(entry.id === "faceLandmarker"
						? "application/octet-stream"
						: "application/onnx"),
				"Content-Length": String(blob.size),
			},
		}),
	);
	return rememberBlob(deps.createObjectURL(blob));
}

function planBytes(includeSelfie: boolean): number {
	let total = 0;
	for (const entry of BEAUTY_MODEL_REQUIRED) total += entry.approxBytes;
	if (includeSelfie) total += BEAUTY_MODEL_SELFIE.approxBytes;
	return total;
}

/**
 * Ensure face + skin models are reachable. Local files win; otherwise Cache API
 * / upstream download. Single-flight per realm.
 */
export async function ensureBeautyModels(
	overrides: Partial<EnsureBeautyModelsDeps> = {},
): Promise<EnsureBeautyModelsResult> {
	if (inflight) return inflight;
	if (lastResult && status.phase === "ready" && Object.keys(overrides).length === 0) {
		return lastResult;
	}
	const deps: EnsureBeautyModelsDeps = { ...defaultDeps(), ...overrides };

	inflight = (async () => {
		setStatus({ phase: "downloading", percent: 0 });

		let completed = 0;
		// Face + DLMV planned first; selfie added only if needed.
		let planned = planBytes(false);
		const bump = (fileLoaded: number, fileTotal: number, baseCompleted: number) => {
			const capped = Math.min(fileLoaded, fileTotal || fileLoaded);
			const overall = Math.min(
				100,
				Math.round(((baseCompleted + capped) / Math.max(1, planned)) * 100),
			);
			setStatus({ phase: "downloading", percent: overall });
		};

		try {
			const faceBase = completed;
			const faceLandmarkerUrl = await resolveBeautyModelUrl(
				BEAUTY_MODEL_FACE_LANDMARKER,
				deps,
				(loaded, total) => bump(loaded, total, faceBase),
			);
			completed += BEAUTY_MODEL_FACE_LANDMARKER.approxBytes;
			deps.configureFace({ modelUrl: faceLandmarkerUrl });

			let dlmvUrl: string | null = null;
			try {
				const dlmvBase = completed;
				dlmvUrl = await resolveBeautyModelUrl(
					BEAUTY_MODEL_DLMV,
					deps,
					(loaded, total) => bump(loaded, total, dlmvBase),
				);
				completed += BEAUTY_MODEL_DLMV.approxBytes;
				deps.configureDlmv({ modelUrl: dlmvUrl });
			} catch (error) {
				console.warn(
					"[beauty] DLMV download failed; trying selfie fallback:",
					error,
				);
				dlmvUrl = null;
			}

			let selfieUrl: string | null = null;
			if (!dlmvUrl) {
				planned = planBytes(true);
				const selfieBase = completed;
				selfieUrl = await resolveBeautyModelUrl(
					BEAUTY_MODEL_SELFIE,
					deps,
					(loaded, total) => bump(loaded, total, selfieBase),
				);
				deps.configureSelfie({ modelUrl: selfieUrl });
			}

			const result = { faceLandmarkerUrl, dlmvUrl, selfieUrl };
			lastResult = result;
			setStatus({ phase: "ready" });
			return result;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			lastResult = null;
			setStatus({ phase: "error", message });
			throw error;
		} finally {
			inflight = null;
		}
	})();

	return inflight;
}

/** Clear memoized success so the next ensure retries (e.g. panel Retry). */
export function resetBeautyModelEnsure(): void {
	inflight = null;
	lastResult = null;
	if (status.phase !== "downloading") {
		setStatus({ phase: "idle" });
	}
}

/** Test helper: reset module status / single-flight / blobs. */
export function resetBeautyModelEnsureForTests(): void {
	inflight = null;
	lastResult = null;
	revokeOwnedBlobs();
	setStatus({ phase: "idle" });
}
