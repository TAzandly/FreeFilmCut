const fs = require("fs");
const f = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/apply-text-template.ts";
let s = fs.readFileSync(f, "utf8");
const NL = s.includes("\r\n") ? "\r\n" : "\n";

// Update import to include embeddedTextAnimPackId and usePackRegistry get
if (!s.includes("embeddedTextAnimPackId")) {
  s = s.replace(
    'import {\r\n\tregisterEmbeddedTextAnimPack,\r\n\tenrichTextAnimWithPackTracks,\r\n\ttype TextAnimAssignment,\r\n} from "@/vfxpack/text-template-textanim";',
    'import {\r\n\tregisterEmbeddedTextAnimPack,\r\n\tenrichTextAnimWithPackTracks,\r\n\tembeddedTextAnimPackId,\r\n\ttype TextAnimAssignment,\r\n} from "@/vfxpack/text-template-textanim";'
  );
  s = s.replace(
    'import { onPackRegistered } from "@/vfxpack/pack-registry";',
    'import { onPackRegistered, usePackRegistry } from "@/vfxpack/pack-registry";'
  );
}

const oldStart =
  "export function ensureEmbeddedTextAnimFromTemplatePack(" + NL +
  "\tpack: LoadedVfxPack," + NL +
  "): TextAnimAssignment | null {" + NL +
  "\tconst { tpl } = resolveTextTemplatePayload(pack);" + NL +
  "\tif (!tpl) return null;" + NL;

const newStart =
  "export function ensureEmbeddedTextAnimFromTemplatePack(" + NL +
  "\tpack: LoadedVfxPack," + NL +
  "): TextAnimAssignment | null {" + NL +
  "\tconst { tpl } = resolveTextTemplatePayload(pack);" + NL +
  "\tif (!tpl) return null;" + NL +
  NL +
  "\tconst animRefsEarly = (" + NL +
  "\t\ttpl as {" + NL +
  "\t\t\tanimRefs?: { in?: string | null; out?: string | null; loop?: string | null };" + NL +
  "\t\t} | null" + NL +
  "\t)?.animRefs;" + NL +
  "\t// Fast path: virtual pack already in registry (common after first ensure / each compose)." + NL +
  "\tif (!(animRefsEarly && (animRefsEarly.in || animRefsEarly.out || animRefsEarly.loop))) {" + NL +
  "\t\tconst existingId = embeddedTextAnimPackId(pack.id);" + NL +
  "\t\tconst existing = usePackRegistry.getState().getPack(existingId);" + NL +
  "\t\tconst ta = existing?.manifest?.textAnim as" + NL +
  "\t\t\t| { category?: string; components?: unknown[] }" + NL +
  "\t\t\t| undefined;" + NL +
  "\t\tif (existing && ta && (Array.isArray(ta.components) ? ta.components.length > 0 : true)) {" + NL +
  '\t\t\tconst catRaw = String(ta.category || "in").toLowerCase();' + NL +
  '\t\t\tconst category = catRaw === "out" || catRaw === "loop" ? catRaw : "in";' + NL +
  "\t\t\treturn { [category]: { packId: existingId } };" + NL +
  "\t\t}" + NL +
  "\t}" + NL;

if (!s.includes("Fast path: virtual pack already")) {
  if (!s.includes(oldStart)) throw new Error("ensure start not found");
  s = s.replace(oldStart, newStart);
  fs.writeFileSync(f, s);
  console.log("OK fast path");
} else console.log("SKIP fast path");

// Quick sanity: duplicate animRefs declaration later in function?
const m = s.match(/const animRefsEarly[\s\S]*?const animRefs = /);
console.log("has both animRefsEarly and animRefs", !!m);
