import { create } from "zustand";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { revokePackObjectUrls } from "@/vfxpack/load-pack";
import { runAfterRegister, onPackRegistered } from "@/vfxpack/pack-registry-hooks";

/** fcc-tl-flower-61: re-export; hook storage is in cycle-free pack-registry-hooks. */
export { onPackRegistered };

type PackRegistryState = {
	packs: LoadedVfxPack[];
	/** Optional force-overlay peek (timeline clips are the real path). */
	activeOverlayIds: string[];
	registerPack: (pack: LoadedVfxPack) => void;
	removePack: (packId: string) => void;
	setOverlayActive: (args: { packId: string; active: boolean }) => void;
	getPack: (packId: string) => LoadedVfxPack | undefined;
};

export const usePackRegistry = create<PackRegistryState>((set, get) => ({
	packs: [],
	activeOverlayIds: [],
	registerPack: (pack) => {
		const fileKey = String(pack.sourceFileName || "")
			.trim()
			.toLowerCase();
		const toReplace = get().packs.filter((p) => {
			if (p.id === pack.id) return true;
			if (!fileKey) return false;
			return String(p.sourceFileName || "").trim().toLowerCase() === fileKey;
		});
		for (const existing of toReplace) {
			revokePackObjectUrls({ pack: existing });
		}
		const dropIds = new Set(toReplace.map((p) => p.id));
		dropIds.add(pack.id);
		set((state) => ({
			packs: [...state.packs.filter((p) => !dropIds.has(p.id)), pack],
		}));
		runAfterRegister(pack);
	},
	removePack: (packId) => {
		const pack = get().packs.find((p) => p.id === packId);
		if (pack) revokePackObjectUrls({ pack });
		const embeddedId = `${packId}::embedded-textanim`;
		const embedded = get().packs.find((p) => p.id === embeddedId);
		if (embedded) revokePackObjectUrls({ pack: embedded });
		void import("@/vfxpack/persisted-user-packs").then((mod) =>
			mod.removePersistedUserVfxPack({ packId }),
		);
		set((state) => ({
			packs: state.packs.filter((p) => p.id !== packId && p.id !== embeddedId),
			activeOverlayIds: state.activeOverlayIds.filter(
				(id) => id !== packId && id !== embeddedId,
			),
		}));
	},
	setOverlayActive: ({ packId, active }) => {
		set((state) => {
			const has = state.activeOverlayIds.includes(packId);
			if (active && !has) {
				return { activeOverlayIds: [...state.activeOverlayIds, packId] };
			}
			if (!active && has) {
				return {
					activeOverlayIds: state.activeOverlayIds.filter((id) => id !== packId),
				};
			}
			return state;
		});
	},
	getPack: (packId) => get().packs.find((p) => p.id === packId),
}));

/** Non-React access for the compositor render loop. */
export function getPackRegistrySnapshot(): Pick<
	PackRegistryState,
	"packs" | "activeOverlayIds"
> {
	const { packs, activeOverlayIds } = usePackRegistry.getState();
	return { packs, activeOverlayIds };
}

export function subscribePackRegistry(listener: () => void): () => void {
	return usePackRegistry.subscribe(listener);
}
