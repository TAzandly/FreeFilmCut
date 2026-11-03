/**
 * Timeline effectType bridge for imported .vfxpack scenes.
 * Convention: effectType === `vfxpack:<packId>`
 */
export const VFXPACK_EFFECT_PREFIX = "vfxpack:";

export function toVfxPackEffectType({ packId }: { packId: string }): string {
	return `${VFXPACK_EFFECT_PREFIX}${packId}`;
}

export function isVfxPackEffectType({
	effectType,
}: {
	effectType: string;
}): boolean {
	return effectType.startsWith(VFXPACK_EFFECT_PREFIX);
}

export function parseVfxPackIdFromEffectType({
	effectType,
}: {
	effectType: string;
}): string | null {
	if (!isVfxPackEffectType({ effectType })) return null;
	const id = effectType.slice(VFXPACK_EFFECT_PREFIX.length);
	return id.length > 0 ? id : null;
}

/** Sentinel shader name; Three compositor treats this as a scene pack, not GLSL. */
export const VFXPACK_SCENE_SHADER = "vfxpack-scene";
