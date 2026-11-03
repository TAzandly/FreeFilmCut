import fs from "fs";
const p = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/load-pack.ts";
let s = fs.readFileSync(p, "utf8");
if (!s.includes("defaultScopeForType")) {
  s = s.replace(
    'import { normalizeVfxPackType } from "@/vfxpack/pack-placement";',
    `import { normalizeVfxPackType } from "@/vfxpack/pack-placement";

function defaultScopeForType(type: string): string {
	if (type === "filter" || type === "effect") return "below";
	return "stack";
}
`
  );
}
s = s.replace(
  /type: normalizeVfxPackType\(manifest\.type\),\s*scope: String\(manifest\.scope \|\| "[^"]+"\),/,
  `type: normalizeVfxPackType(manifest.type),
		scope: (() => {
			const type = normalizeVfxPackType(manifest.type);
			return String(manifest.scope || defaultScopeForType(type));
		})(),`
);
fs.writeFileSync(p, s);
console.log("load-pack patched");