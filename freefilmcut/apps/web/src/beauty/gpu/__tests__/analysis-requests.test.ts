import { describe, expect, test } from "bun:test";
import { BeautyAnalysisCache } from "@/beauty/analysis/cache";
import type { BeautyAnalysisFrame } from "@/beauty/analysis/types";
import {
	BEAUTY_RETRY_MS,
	BEAUTY_STALE_MAX_TICKS,
	BeautyAnalysisRequester,
	type BeautyAnalysisRequest,
} from "@/beauty/gpu/analysis-requests";

const QUANTUM = 4000;

function frame(clipId: string, ticks: number): BeautyAnalysisFrame {
	return {
		clipId,
		mediaTimeTicks: ticks,
		faces: [],
		skinWidth: 1,
		skinHeight: 1,
		skinMask: new Uint8Array([255]),
		source: "mediapipe",
	};
}

function req(clipId: string, ticks: number): BeautyAnalysisRequest {
	return {
		clipId,
		mediaTimeTicks: ticks,
		source: {} as CanvasImageSource,
		width: 10,
		height: 10,
	};
}

function setup({ cacheResults = true } = {}) {
	const cache = new BeautyAnalysisCache();
	const calls: Array<{ clipId: string; ticks: number }> = [];
	const resolvers: Array<() => void> = [];
	let ready = 0;
	let clock = 0;
	const requester = new BeautyAnalysisRequester({
		cache,
		snapshot: () => ({}) as never,
		now: () => clock,
		onReady: () => {
			ready++;
		},
		analyze: ({ clipId, mediaTimeTicks }) =>
			new Promise((resolve) => {
				calls.push({ clipId, ticks: mediaTimeTicks });
				resolvers.push(() => {
					const f = frame(clipId, mediaTimeTicks);
					if (cacheResults) cache.set(clipId, mediaTimeTicks, f);
					resolve(f);
				});
			}),
	});
	return {
		requester,
		calls,
		cache,
		ready: () => ready,
		advance: (ms: number) => {
			clock += ms;
		},
		finishNext: async () => {
			resolvers.shift()?.();
			await new Promise((r) => setTimeout(r, 0));
		},
	};
}

describe("BeautyAnalysisRequester", () => {
	test("first request returns null and analyzes once per clip", async () => {
		const t = setup();
		expect(t.requester.request(req("a", 0))).toBeNull();
		expect(t.requester.request(req("a", QUANTUM * 2))).toBeNull();
		expect(t.calls).toHaveLength(1);
		await t.finishNext();
		expect(t.ready()).toBe(1);
		expect(t.requester.request(req("a", 0))?.clipId).toBe("a");
		// a second clip is independent
		expect(t.requester.request(req("b", 0))).toBeNull();
		expect(t.calls).toHaveLength(2);
	});

	test("reuses the latest result within the stale window and refreshes", async () => {
		const t = setup();
		t.requester.request(req("a", 0));
		await t.finishNext();
		const stale = t.requester.request(req("a", 10_000));
		expect(stale?.mediaTimeTicks).toBe(0);
		expect(t.calls).toHaveLength(2); // refresh started for the new frame
		await t.finishNext();
		expect(t.requester.request(req("a", 10_000))?.mediaTimeTicks).toBe(10_000);
	});

	test("does not reuse results beyond the stale window", async () => {
		const t = setup();
		t.requester.request(req("a", 0));
		await t.finishNext();
		expect(t.requester.request(req("a", BEAUTY_STALE_MAX_TICKS + 10_000))).toBeNull();
	});

	test("ensure resolves with exact analysis and does not wake the preview", async () => {
		const t = setup();
		const p = t.requester.ensure(req("a", 0));
		await t.finishNext();
		expect((await p)?.clipId).toBe("a");
		expect(t.ready()).toBe(0);
		// now a cache hit
		expect((await t.requester.ensure(req("a", 0)))?.clipId).toBe("a");
		expect(t.calls).toHaveLength(1);
	});

	test("ensure waits out an in-flight analysis of another frame", async () => {
		const t = setup();
		t.requester.request(req("a", 0));
		const p = t.requester.ensure(req("a", 40_000));
		await t.finishNext(); // frame 0 done
		await t.finishNext(); // export's frame
		expect((await p)?.mediaTimeTicks).toBe(40_000);
		expect(t.calls.map((c) => c.ticks)).toEqual([0, 40_000]);
	});

	test("invalidateClip drops a late in-flight result and evicts it from the cache", async () => {
		const t = setup();
		t.requester.request(req("a", 0));
		t.requester.invalidateClip("a");
		await t.finishNext(); // stale analysis resolves
		expect(t.ready()).toBe(0);
		expect(t.cache.get("a", 0)).toBeUndefined();
		expect(t.requester.peek("a", 0)).toBeNull();
		// a fresh request starts a new analysis
		expect(t.requester.request(req("a", 0))).toBeNull();
		expect(t.calls).toHaveLength(2);
		await t.finishNext();
		expect(t.requester.request(req("a", 0))?.clipId).toBe("a");
	});

	test("clear ignores late in-flight results for every clip", async () => {
		const t = setup();
		t.requester.request(req("a", 0));
		t.requester.request(req("b", 0));
		t.requester.clear();
		await t.finishNext();
		await t.finishNext();
		expect(t.ready()).toBe(0);
		expect(t.requester.peek("a", 0)).toBeNull();
		expect(t.requester.peek("b", 0)).toBeNull();
	});

	test("ensure re-analyzes when the clip is invalidated mid-analysis", async () => {
		const t = setup();
		const p = t.requester.ensure(req("a", 0));
		t.requester.invalidateClip("a");
		await t.finishNext(); // stale
		await t.finishNext(); // retry
		expect((await p)?.clipId).toBe("a");
		expect(t.calls).toHaveLength(2);
	});

	test("uncached results are not re-analyzed every frame, only after retry delay", async () => {
		const t = setup({ cacheResults: false });
		t.requester.request(req("a", 0));
		await t.finishNext();
		t.requester.request(req("a", 0));
		t.requester.request(req("a", 0));
		expect(t.calls).toHaveLength(1);
		t.advance(BEAUTY_RETRY_MS + 1);
		t.requester.request(req("a", 0));
		expect(t.calls).toHaveLength(2);
	});
});
