const fs = require("fs");
function replaceOnce(s, from, to, label) {
  const i = s.indexOf(from);
  if (i < 0) throw new Error("missing " + label + ": " + JSON.stringify(from.slice(0, 100)));
  return s.slice(0, i) + to + s.slice(i + from.length);
}
const root = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src";
let s = fs.readFileSync(root + "/vfxpack/apply-text-template.ts", "utf8");
if (s.includes("ensureEmbeddedTextAnimFromTemplatePack")) {
  console.log("SKIP apply already");
  process.exit(0);
}
const NL = s.includes("\r\n") ? "\r\n" : "\n";

s = replaceOnce(
  s,
  'from "@/vfxpack/text-template-textanim";' + NL + NL,
  'from "@/vfxpack/text-template-textanim";' + NL +
    'import { onPackRegistered } from "@/vfxpack/pack-registry";' + NL +
    'import { normalizeVfxPackType } from "@/vfxpack/pack-placement";' + NL + NL,
  "imports"
);

const ensureFn =
  "/**" + NL +
  " * fcc-tl-flower-60: (re)register virtual text-anim pack for a text-template." + NL +
  " * Called on apply AND whenever the template pack is registered (refresh/builtin load)," + NL +
  " * so timeline textAnims.{in|out|loop}.packId keeps resolving after page reload." + NL +
  " */" + NL +
  "export function ensureEmbeddedTextAnimFromTemplatePack(" + NL +
  "\tpack: LoadedVfxPack," + NL +
  "): TextAnimAssignment | null {" + NL +
  "\tconst { tpl } = resolveTextTemplatePayload(pack);" + NL +
  "\tif (!tpl) return null;" + NL +
  NL +
  "\tconst fxFromText =" + NL +
  "\t\ttpl.textFxStack &&" + NL +
  '\t\ttypeof tpl.textFxStack === "object" &&' + NL +
  "\t\tArray.isArray(tpl.textFxStack.effects) &&" + NL +
  "\t\ttpl.textFxStack.effects.length" + NL +
  '\t\t\t? (tpl.textFxStack as Record<string, unknown>)' + NL +
  "\t\t\t: null;" + NL +
  "\tconst fxFromPp =" + NL +
  "\t\ttpl.postProcess &&" + NL +
  '\t\ttypeof tpl.postProcess === "object" &&' + NL +
  "\t\tArray.isArray(tpl.postProcess.effects) &&" + NL +
  "\t\ttpl.postProcess.effects.length" + NL +
  '\t\t\t? (tpl.postProcess as Record<string, unknown>)' + NL +
  "\t\t\t: null;" + NL +
  "\tconst textFxStack = fxFromText || fxFromPp;" + NL +
  NL +
  "\tconst animRefs = (" + NL +
  "\t\ttpl as {" + NL +
  "\t\t\tanimRefs?: { in?: string | null; out?: string | null; loop?: string | null };" + NL +
  "\t\t} | null" + NL +
  "\t)?.animRefs;" + NL +
  "\tconst enrichedTextAnim = tpl.textAnim" + NL +
  "\t\t? enrichTextAnimWithPackTracks(pack, tpl.textAnim)" + NL +
  "\t\t: null;" + NL +
  "\tif (enrichedTextAnim) tpl.textAnim = enrichedTextAnim as typeof tpl.textAnim;" + NL +
  "\tif (!(enrichedTextAnim || animRefs)) return null;" + NL +
  NL +
  "\tconst registered = registerEmbeddedTextAnimPack({" + NL +
  "\t\ttemplatePackId: pack.id," + NL +
  "\t\tdisplayName: pack.displayName || pack.id," + NL +
  "\t\ttextAnim: enrichedTextAnim || tpl.textAnim," + NL +
  "\t\tanimRefs: animRefs || null," + NL +
  "\t\tpostProcess:" + NL +
  '\t\t\t(textFxStack as import("@/vfxpack/text-anim-motion").TextAnimPackPayload["postProcess"] | null) ||' + NL +
  "\t\t\tnull," + NL +
  "\t\tbackground:" + NL +
  '\t\t\t(tpl as { background?: import("@/vfxpack/text-anim-motion").TextAnimPackPayload["background"] } | null)' + NL +
  "\t\t\t\t?.background || null," + NL +
  "\t\toutput:" + NL +
  '\t\t\t(tpl as { output?: import("@/vfxpack/text-anim-motion").TextAnimPackPayload["output"] } | null)?.output ||' + NL +
  "\t\t\tnull," + NL +
  "\t});" + NL +
  "\treturn registered?.textAnims ?? null;" + NL +
  "}" + NL + NL;

s = replaceOnce(
  s,
  "/**" + NL + " * Build apply payload from a loaded text-template pack." + NL + " */" + NL +
    "export function buildTextTemplateApply(pack: LoadedVfxPack): TextTemplateApplyResult {",
  ensureFn +
    "/**" + NL + " * Build apply payload from a loaded text-template pack." + NL + " */" + NL +
    "export function buildTextTemplateApply(pack: LoadedVfxPack): TextTemplateApplyResult {",
  "insert-ensure"
);

// Find and replace textAnims block by regex for robustness
const re = /\tlet textAnims: TextAnimAssignment \| null = null;\r?\n\tconst animRefs = \(tpl as \{ animRefs\?:[\s\S]*?\tif \(registered\) textAnims = registered\.textAnims;\r?\n\t\}\r?\n/;
if (!re.test(s)) throw new Error("textAnims block not found");
s = s.replace(
  re,
  "\t// fcc-tl-flower-60: shared ensure (also runs on pack register / refresh)." + NL +
    "\tconst textAnims = ensureEmbeddedTextAnimFromTemplatePack(pack);" + NL
);

if (!s.includes("onPackRegistered((pack)")) {
  s = s.replace(/\s*$/, "") + NL + NL +
    "// fcc-tl-flower-60: refresh / builtin load re-registers text-template packs without" + NL +
    "// re-running apply — re-bind ::embedded-textanim so saved textAnims packIds resolve." + NL +
    "onPackRegistered((pack) => {" + NL +
    '\tif (normalizeVfxPackType(pack.type) !== "text-template") return;' + NL +
    "\tensureEmbeddedTextAnimFromTemplatePack(pack);" + NL +
    "});" + NL;
}

fs.writeFileSync(root + "/vfxpack/apply-text-template.ts", s);
console.log("OK apply-text-template");
