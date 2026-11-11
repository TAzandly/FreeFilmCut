export type OrtModule = typeof import("onnxruntime-web");
export type OrtSession = import("onnxruntime-web").InferenceSession;

/** Keep in sync with the `onnxruntime-web` version in package.json. */
export const ORT_WEB_VERSION = "1.31.1";
export const ORT_WASM_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WEB_VERSION}/dist/`;

let ortPromise: Promise<OrtModule> | null = null;
let wasmPathsOverride: string | undefined;

/** Override where ORT fetches its `.wasm` / `.mjs` runtime files (call before first use). */
export function configureOrtWasmPaths(base: string | undefined): void {
	wasmPathsOverride = base;
}

/** Lazy-load onnxruntime-web (browser only). */
export function loadOrt(): Promise<OrtModule> {
	if (typeof window === "undefined" && typeof self === "undefined") {
		return Promise.reject(new Error("onnxruntime-web requires a browser runtime"));
	}
	if (!ortPromise) {
		ortPromise = import("onnxruntime-web")
			.then((ort) => {
				ort.env.wasm.wasmPaths = wasmPathsOverride ?? ORT_WASM_CDN_BASE;
				return ort;
			})
			.catch((error) => {
				ortPromise = null;
				throw error;
			});
	}
	return ortPromise;
}

export async function createOrtSession(modelUrl: string): Promise<OrtSession> {
	const ort = await loadOrt();
	return ort.InferenceSession.create(modelUrl, {
		executionProviders: ["wasm"],
		graphOptimizationLevel: "all",
	});
}

/** HEAD-probe a model URL; returns false on 404 / network failure. */
export async function modelFileExists(url: string): Promise<boolean> {
	if (typeof fetch === "undefined") return false;
	try {
		const head = await fetch(url, { method: "HEAD" });
		if (!head.ok) return false;
		// Next dev servers answer unknown paths with an HTML 200 for some setups.
		const type = head.headers.get("content-type") ?? "";
		return !type.includes("text/html");
	} catch {
		return false;
	}
}
