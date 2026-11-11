import { afterEach, describe, expect, test } from "bun:test";
import {
	BEAUTY_MODEL_CACHE_NAME,
	BEAUTY_MODEL_DLMV,
	BEAUTY_MODEL_FACE_LANDMARKER,
	BEAUTY_MODEL_SELFIE,
} from "../model-catalog";
import {
	ensureBeautyModels,
	getBeautyModelStatus,
	resetBeautyModelEnsureForTests,
	resolveBeautyModelUrl,
	type EnsureBeautyModelsDeps,
} from "../ensure-models";

afterEach(() => {
	resetBeautyModelEnsureForTests();
});

function memoryCache() {
	const map = new Map<string, Response>();
	const cache = {
		match: async (request: RequestInfo) => {
			const key = typeof request === "string" ? request : request.url;
			const hit = map.get(key);
			return hit ? hit.clone() : undefined;
		},
		put: async (request: RequestInfo, response: Response) => {
			const key = typeof request === "string" ? request : request.url;
			map.set(key, response.clone());
		},
	} as unknown as Cache;
	return { cache, map };
}

function baseDeps(
	partial: Partial<EnsureBeautyModelsDeps> & {
		existsMap?: Record<string, boolean>;
		remoteBodies?: Record<string, Uint8Array>;
	} = {},
): EnsureBeautyModelsDeps & { fetches: string[]; configs: string[] } {
	const { cache, map } = memoryCache();
	const fetches: string[] = [];
	const configs: string[] = [];
	const existsMap = partial.existsMap ?? {};
	const remoteBodies = partial.remoteBodies ?? {};
	const deps: EnsureBeautyModelsDeps & {
		fetches: string[];
		configs: string[];
		map: Map<string, Response>;
	} = {
		fetches,
		configs,
		map,
		exists: async (url) => existsMap[url] === true,
		openCache: async () => cache,
		fetchRemote: async (url) => {
			fetches.push(url);
			const body = remoteBodies[url] ?? new Uint8Array([1, 2, 3, 4]);
			return new Response(body, {
				status: 200,
				headers: { "Content-Length": String(body.length) },
			});
		},
		createObjectURL: (blob) => `blob:test/${blob.size}`,
		configureFace: () => {
			configs.push("face");
		},
		configureDlmv: () => {
			configs.push("dlmv");
		},
		configureSelfie: () => {
			configs.push("selfie");
		},
		now: () => 0,
		...partial,
	};
	return deps;
}

describe("resolveBeautyModelUrl", () => {
	test("uses local path when the file exists", async () => {
		const deps = baseDeps({
			existsMap: { [BEAUTY_MODEL_FACE_LANDMARKER.localPath]: true },
		});
		const url = await resolveBeautyModelUrl(BEAUTY_MODEL_FACE_LANDMARKER, deps);
		expect(url).toBe(BEAUTY_MODEL_FACE_LANDMARKER.localPath);
		expect(deps.fetches).toEqual([]);
	});

	test("uses cache without fetching remote", async () => {
		const deps = baseDeps();
		await deps.openCache(BEAUTY_MODEL_CACHE_NAME).then((c) =>
			c.put(
				BEAUTY_MODEL_DLMV.localPath,
				new Response(new Uint8Array([9, 9]), {
					headers: { "Content-Type": "application/onnx" },
				}),
			),
		);
		// resolveAssetUrl may prefix origin; seed both keys used in practice.
		const cache = await deps.openCache(BEAUTY_MODEL_CACHE_NAME);
		await cache.put(
			BEAUTY_MODEL_DLMV.localPath,
			new Response(new Uint8Array([9, 9])),
		);
		const url = await resolveBeautyModelUrl(BEAUTY_MODEL_DLMV, deps);
		expect(url.startsWith("blob:")).toBe(true);
		expect(deps.fetches).toEqual([]);
	});

	test("downloads remote and stores in cache", async () => {
		const deps = baseDeps({
			remoteBodies: {
				[BEAUTY_MODEL_FACE_LANDMARKER.remoteUrl]: new Uint8Array([7, 7, 7]),
			},
		});
		const progress: number[] = [];
		const url = await resolveBeautyModelUrl(
			BEAUTY_MODEL_FACE_LANDMARKER,
			deps,
			(loaded) => progress.push(loaded),
		);
		expect(url.startsWith("blob:")).toBe(true);
		expect(deps.fetches).toEqual([BEAUTY_MODEL_FACE_LANDMARKER.remoteUrl]);
		expect(progress.some((n) => n > 0)).toBe(true);
		const cached = await (
			await deps.openCache(BEAUTY_MODEL_CACHE_NAME)
		).match(BEAUTY_MODEL_FACE_LANDMARKER.localPath);
		expect(cached).toBeTruthy();
	});
});

describe("ensureBeautyModels", () => {
	test("configures face + dlmv when both resolve", async () => {
		const deps = baseDeps({
			existsMap: {
				[BEAUTY_MODEL_FACE_LANDMARKER.localPath]: true,
				[BEAUTY_MODEL_DLMV.localPath]: true,
			},
		});
		const result = await ensureBeautyModels(deps);
		expect(result.faceLandmarkerUrl).toBe(BEAUTY_MODEL_FACE_LANDMARKER.localPath);
		expect(result.dlmvUrl).toBe(BEAUTY_MODEL_DLMV.localPath);
		expect(result.selfieUrl).toBeNull();
		expect(deps.configs).toEqual(["face", "dlmv"]);
		expect(getBeautyModelStatus()).toEqual({ phase: "ready" });
	});

	test("falls back to selfie when dlmv fails", async () => {
		const deps = baseDeps({
			existsMap: {
				[BEAUTY_MODEL_FACE_LANDMARKER.localPath]: true,
				[BEAUTY_MODEL_SELFIE.localPath]: true,
			},
			fetchRemote: async (url) => {
				if (url === BEAUTY_MODEL_DLMV.remoteUrl) {
					return new Response("missing", { status: 404 });
				}
				return new Response(new Uint8Array([1]), { status: 200 });
			},
		});
		const result = await ensureBeautyModels(deps);
		expect(result.dlmvUrl).toBeNull();
		expect(result.selfieUrl).toBe(BEAUTY_MODEL_SELFIE.localPath);
		expect(deps.configs).toEqual(["face", "selfie"]);
	});

	test("sets error status when face landmarker cannot be resolved", async () => {
		const deps = baseDeps({
			fetchRemote: async () => new Response("nope", { status: 500 }),
		});
		await expect(ensureBeautyModels(deps)).rejects.toThrow(/faceLandmarker|HTTP 500/);
		expect(getBeautyModelStatus().phase).toBe("error");
	});
});
