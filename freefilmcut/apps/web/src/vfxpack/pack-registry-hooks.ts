import type { LoadedVfxPack } from "@/vfxpack/types";

/**
 * fcc-tl-flower-61: hooks live in a cycle-free module.
 * Cycle was: pack-registry -> load-pack -> apply-text-template top-level
 * onPackRegistered while pack-registry afterRegisterHooks was still in TDZ.
 */
const afterRegisterHooks: Array<(pack: LoadedVfxPack) => void> = [];

export function onPackRegistered(fn: (pack: LoadedVfxPack) => void): () => void {
	afterRegisterHooks.push(fn);
	return () => {
		const i = afterRegisterHooks.indexOf(fn);
		if (i >= 0) afterRegisterHooks.splice(i, 1);
	};
}

export function runAfterRegister(pack: LoadedVfxPack): void {
	for (const fn of afterRegisterHooks) {
		try {
			fn(pack);
		} catch (err) {
			console.warn("[FreeFilmCut] onPackRegistered hook failed", err);
		}
	}
}