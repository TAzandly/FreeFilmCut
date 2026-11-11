import type { BeautyAnalysisFrame } from "./types";

/** Matches `MediaTime` ticks per second (`rust/crates/time`). */
const TICKS_PER_SECOND = 120_000;

/** One timeline frame at 30 fps — analysis cache quantizes to this step. */
export const BEAUTY_ANALYSIS_TICK_QUANTUM = Math.round(TICKS_PER_SECOND / 30);

export const BEAUTY_ANALYSIS_CACHE_MAX = 64;

export function quantizeMediaTimeTicks(
	ticks: number,
	quantum = BEAUTY_ANALYSIS_TICK_QUANTUM,
): number {
	if (quantum <= 0) return ticks;
	return Math.floor(ticks / quantum) * quantum;
}

export function beautyAnalysisCacheKey(
	clipId: string,
	mediaTimeTicks: number,
): string {
	const quantizedTicks = quantizeMediaTimeTicks(mediaTimeTicks);
	return `${clipId}:${quantizedTicks}`;
}

export class BeautyAnalysisCache {
	private readonly max: number;
	private readonly map = new Map<string, BeautyAnalysisFrame>();

	constructor(max = BEAUTY_ANALYSIS_CACHE_MAX) {
		this.max = Math.max(1, max);
	}

	get size(): number {
		return this.map.size;
	}

	get(clipId: string, mediaTimeTicks: number): BeautyAnalysisFrame | undefined {
		const key = beautyAnalysisCacheKey(clipId, mediaTimeTicks);
		const hit = this.map.get(key);
		if (hit === undefined) return undefined;
		this.map.delete(key);
		this.map.set(key, hit);
		return hit;
	}

	set(
		clipId: string,
		mediaTimeTicks: number,
		frame: BeautyAnalysisFrame,
	): void {
		const key = beautyAnalysisCacheKey(clipId, mediaTimeTicks);
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, frame);
		while (this.map.size > this.max) {
			const oldest = this.map.keys().next().value as string;
			this.map.delete(oldest);
		}
	}

	invalidateClip(clipId: string): void {
		const prefix = `${clipId}:`;
		for (const key of [...this.map.keys()]) {
			if (key.startsWith(prefix)) this.map.delete(key);
		}
	}

	clear(): void {
		this.map.clear();
	}
}
