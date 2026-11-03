/**
 * Generates the pieces the blend-mode headless page needs, using the *real*
 * module: fragment.js — three's real meshbasic_frag with the blender injected.
 *
 * Run: bun --preload ./test-preload.ts agent-scratch/blend-build.ts
 */
import { ShaderLib } from "three";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { injectBlendModeShader } from "@/services/renderer/compositor/blend-mode-material";

const here = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"agent-scratch",
	"blend-verify",
);

const injected = injectBlendModeShader({
	fragmentShader: ShaderLib.basic.fragmentShader,
});

if (!injected.includes("uBlendEnabled > 0.5")) {
	throw new Error("blender was not injected — anchors moved?");
}

writeFileSync(
	join(here, "fragment.js"),
	`export const FRAGMENT = ${JSON.stringify(injected)};\n`,
);

console.log(`fragment: ${injected.length} chars`);
