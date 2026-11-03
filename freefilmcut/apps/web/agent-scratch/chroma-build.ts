/**
 * Generates the pieces the headless page needs, using the *real* modules:
 *  - fragment.js  — three's real meshbasic_frag with the keyer injected
 *  - cases.js     — uniform values produced by readChromaKeyFromParams +
 *                   resolveChromaKeyUniformValues (the real slider mapping)
 *
 * Run: bun agent-scratch/chroma-verify/build.ts
 */
import { ShaderLib } from "three";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readChromaKeyFromParams } from "@/chroma-key";
import {
	injectChromaKeyShader,
	resolveChromaKeyUniformValues,
} from "@/services/renderer/compositor/chroma-key-material";

const here = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"agent-scratch",
	"chroma-verify",
);

const injected = injectChromaKeyShader({
	fragmentShader: ShaderLib.basic.fragmentShader,
});

if (!injected.includes("uChromaSoften > 0.01")) {
	throw new Error("keyer was not injected — anchors moved?");
}

writeFileSync(
	join(here, "fragment.js"),
	`export const FRAGMENT = ${JSON.stringify(injected)};\n`,
);

const CASES = [
	{ name: "defaults", intensity: 45, feather: 25, soften: 30, shadow: 0, edgeCleanup: 20 },
	{ name: "old-defaults", intensity: 20, feather: 0, soften: 0, shadow: 0, edgeCleanup: 0 },
	{ name: "hard", intensity: 45, feather: 0, soften: 0, shadow: 0, edgeCleanup: 20 },
	{ name: "feather100", intensity: 45, feather: 100, soften: 0, shadow: 0, edgeCleanup: 20 },
	{ name: "soften100", intensity: 45, feather: 0, soften: 100, shadow: 0, edgeCleanup: 20 },
	{ name: "both100", intensity: 45, feather: 100, soften: 100, shadow: 0, edgeCleanup: 20 },
	{ name: "shadow100", intensity: 45, feather: 0, soften: 0, shadow: 100, edgeCleanup: 20 },
	{ name: "spill0", intensity: 45, feather: 0, soften: 0, shadow: 0, edgeCleanup: 0 },
	{ name: "spill50", intensity: 45, feather: 25, soften: 30, shadow: 0, edgeCleanup: 50 },
	{ name: "spill100", intensity: 45, feather: 25, soften: 30, shadow: 0, edgeCleanup: 100 },
].map(({ name, ...sliders }) => {
	const chromaKey = readChromaKeyFromParams({
		params: {
			"chromaKey.enabled": true,
			"chromaKey.color": "#00FF00",
			"chromaKey.intensity": sliders.intensity,
			"chromaKey.feather": sliders.feather,
			"chromaKey.soften": sliders.soften,
			"chromaKey.shadow": sliders.shadow,
			"chromaKey.edgeCleanup": sliders.edgeCleanup,
		},
	});
	const values = resolveChromaKeyUniformValues({ chromaKey });
	return {
		name,
		sliders,
		keyColor: chromaKey.keyColor,
		values,
	};
});

writeFileSync(
	join(here, "cases.js"),
	`export const CASES = ${JSON.stringify(CASES, null, "\t")};\n`,
);

console.log(`fragment: ${injected.length} chars, ${CASES.length} cases`);
