import type { EffectElement, TimelineElement } from "@/timeline";
import { parseVfxPackIdFromEffectType } from "@/vfxpack/effect-id";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import type { LoadedVfxPack } from "@/vfxpack/types";

export function isStickerPackEffectElement(
	element: TimelineElement,
): element is EffectElement {
	if (element.type !== "effect") return false;
	const packId = parseVfxPackIdFromEffectType({ effectType: element.effectType });
	if (!packId) return false;
	const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
	return pack != null && normalizeVfxPackType(pack.type) === "sticker";
}

/** Pixel size the sticker is rendered at before it is fitted onto the project canvas. */
export function stickerPackSourceSize({
	pack,
}: {
	pack: LoadedVfxPack;
}): { width: number; height: number } {
	return {
		width: Math.max(
			1,
			pack.scene?.resolution?.width || pack.manifest.resolution?.width || 1920,
		),
		height: Math.max(
			1,
			pack.scene?.resolution?.height || pack.manifest.resolution?.height || 1080,
		),
	};
}

export function stickerPackSourceSizeForElement({
	element,
}: {
	element: EffectElement;
}): { width: number; height: number } | null {
	const packId = parseVfxPackIdFromEffectType({ effectType: element.effectType });
	if (!packId) return null;
	const pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);
	if (!pack || normalizeVfxPackType(pack.type) !== "sticker") return null;
	return stickerPackSourceSize({ pack });
}
