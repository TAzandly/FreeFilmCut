import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";

/**
 * Registered for timeline playback / legacy clips.
 * Not listed in the Effects library (see EffectsView `showBuiltInEffects={false}`).
 */
const defaultEffects = [blurEffectDefinition];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition,
		});
	}
}
