import { resolveAssetUrl } from "./asset-url";
import {
	withQuietNativeLogsAsync,
} from "./native-log-quiet";

export type OrtModule = typeof import("onnxruntime-web");
export type OrtSession = import("onnxruntime-web").InferenceSession;

/** Keep in sync with the `onnxruntime-web` version in package.json. */
export const ORT_WEB_VERSION = "1.31.1";

/** Same-origin files populated by `scripts/sync-beauty-vendor.mjs`. */
export const ORT_WASM_BASE = "/vendor/onnxruntime-web/";
/** WASM-only ESM build (no WebGPU/WebNN), loaded at runtime — never bundled. */
export const ORT_ESM_URL = `${ORT_WASM_BASE}ort.wasm.min.mjs`;

/** jsDelivr fallback (offline / CSP / China CDN issues → prefer local vendor). */
export const ORT_WASM_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WEB_VERSION}/dist/`;
export const ORT_ESM_CDN_URL = `${ORT_WASM_CDN_BASE}ort.wasm.min.mjs`;

export type OrtRuntimeConfig = {
	/** Directory that contains `ort-wasm-simd-threaded.wasm` (trailing slash optional). */
	wasmPaths?: string;
	/** Absolute URL or path to `ort.wasm.min.mjs`. */
	esmUrl?: string;
};

let ortPromise: Promise<OrtModule> | null = null;
let config: OrtRuntimeConfig = {};

/** Override ESM / wasm locations (call before first use). */
export function configureOrtRuntime(next: OrtRuntimeConfig): void {
	config = { ...config, ...next };
	ortPromise = null;
}

/** @deprecated Prefer `configureOrtRuntime({ wasmPaths })`. */
export function configureOrtWasmPaths(base: string | undefined): void {
	configureOrtRuntime({ wasmPaths: base });
}

function normalizeWasmBase(base: string): string {
	return base.endsWith("/") ? base : `${base}/`;
}

/** Lazy-load onnxruntime-web (browser only). */
export function loadOrt(): Promise<OrtModule> {
	if (typeof window === "undefined" && typeof self === "undefined") {
		return Promise.reject(new Error("onnxruntime-web requires a browser runtime"));
	}
	if (!ortPromise) {
		const esmUrl = resolveAssetUrl(config.esmUrl ?? ORT_ESM_URL);
		const wasmPaths = normalizeWasmBase(
			resolveAssetUrl(config.wasmPaths ?? ORT_WASM_BASE),
		);
		// Runtime URL import: keeps the package out of the Turbopack graph
		// (bundling it OOM-crashed `next dev` while compiling /editor).
		ortPromise = withQuietNativeLogsAsync(async () => {
			const ort = (await import(
				/* turbopackIgnore: true */ /* webpackIgnore: true */ esmUrl
			)) as OrtModule;
			ort.env.wasm.wasmPaths = wasmPaths;
			// Drop UpsampleBase deprecation spam from selfie ONNX (opset 13).
			ort.env.logLevel = "error";
			return ort;
		}).catch((error) => {
			ortPromise = null;
			throw error;
		});
	}
	return ortPromise;
}

export async function createOrtSession(modelUrl: string): Promise<OrtSession> {
	const ort = await loadOrt();
	return withQuietNativeLogsAsync(() =>
		ort.InferenceSession.create(resolveAssetUrl(modelUrl), {
			executionProviders: ["wasm"],
			graphOptimizationLevel: "all",
		}),
	);
}

/** HEAD-probe a model URL; returns false on 404 / network failure. */
export async function modelFileExists(url: string): Promise<boolean> {
	if (typeof fetch === "undefined") return false;
	try {
		const head = await fetch(resolveAssetUrl(url), { method: "HEAD" });
		if (!head.ok) return false;
		// Next dev servers answer unknown paths with an HTML 200 for some setups.
		const type = head.headers.get("content-type") ?? "";
		return !type.includes("text/html");
	} catch {
		return false;
	}
}
