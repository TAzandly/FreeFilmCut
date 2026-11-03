const fs = require("fs");
function replaceOnce(s, from, to, label) {
  const i = s.indexOf(from);
  if (i < 0) throw new Error("missing " + label + ": " + JSON.stringify(from.slice(0, 120)));
  return s.slice(0, i) + to + s.slice(i + from.length);
}
const root = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src";

// ---- three-compositor ----
{
  let s = fs.readFileSync(root + "/services/renderer/compositor/three-compositor.ts", "utf8");
  const NL = s.includes("\r\n") ? "\r\n" : "\n";
  if (!s.includes("ensureEmbeddedTextAnimFromTemplatePack")) {
    s = replaceOnce(
      s,
      'import { samplePackAnimPostProcess } from "@/vfxpack/text-template-textanim";' + NL,
      'import { samplePackAnimPostProcess } from "@/vfxpack/text-template-textanim";' + NL +
        'import { ensureEmbeddedTextAnimFromTemplatePack } from "@/vfxpack/apply-text-template";' + NL +
        'import { embeddedTextAnimPackId } from "@/vfxpack/text-template-textanim";' + NL,
      "compositor-import"
    );
  }

  // Patch textAnimPayloadForPack to ensure missing embedded packs
  if (!s.includes("fcc-tl-flower-60: revive")) {
    const oldPayload =
      "\t\tconst textAnimPayloadForPack = (packId: string) => {" + NL +
      "\t\t\tconst pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);" + NL +
      "\t\t\tif (!pack) return null;" + NL;
    const newPayload =
      "\t\tconst textAnimPayloadForPack = (packId: string) => {" + NL +
      "\t\t\tlet pack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);" + NL +
      "\t\t\t// fcc-tl-flower-60: revive ::embedded-textanim after refresh (virtual pack not persisted)." + NL +
      "\t\tif (!pack && typeof packId === \"string\" && packId.endsWith(\"::embedded-textanim\")) {" + NL +
      "\t\t\t\tconst parentId = packId.slice(0, -\"::embedded-textanim\".length);" + NL +
      "\t\t\t\tconst parent = getPackRegistrySnapshot().packs.find((entry) => entry.id === parentId);" + NL +
      "\t\t\t\tif (parent && normalizeVfxPackType(parent.type) === \"text-template\") {" + NL +
      "\t\t\t\t\tensureEmbeddedTextAnimFromTemplatePack(parent);" + NL +
      "\t\t\t\t\tpack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);" + NL +
      "\t\t\t\t}" + NL +
      "\t\t\t}" + NL +
      "\t\t\tif (!pack) return null;" + NL;
    // Fix indentation - I used mixed tabs. Match file style (tabs).
    s = replaceOnce(s, oldPayload, newPayload, "payload-for-pack");
  }

  // Before activePack resolve: rehydrate textAnims from textTemplatePackId if missing
  if (!s.includes("fcc-tl-flower-60: rehydrate textAnims")) {
    const oldActive =
      "\t\tconst activePack = item.textAnims" + NL +
      "\t\t\t? resolveActiveTextAnimPack({" + NL +
      "\t\t\t\t\ttextAnims: item.textAnims," + NL +
      "\t\t\t\t\tlocalTimeSec: item.clipLocalTime ?? 0," + NL +
      "\t\t\t\t\tclipDurationSec: item.clipDurationSec ?? 0," + NL +
      "\t\t\t\t\tpayloadForPack: textAnimPayloadForPack," + NL +
      "\t\t\t\t})" + NL +
      "\t\t\t: null;" + NL;
    const newActive =
      "\t\t// fcc-tl-flower-60: rehydrate textAnims if lost, or ensure virtual pack for saved assignment." + NL +
      "\t\tlet textAnimsForClip = item.textAnims;" + NL +
      "\t\tif (props.textTemplatePackId) {" + NL +
      "\t\t\tconst tplPack = getPackRegistrySnapshot().packs.find(" + NL +
      "\t\t\t\t(e) => e.id === props.textTemplatePackId," + NL +
      "\t\t\t);" + NL +
      '\t\t\tif (tplPack && normalizeVfxPackType(tplPack.type) === "text-template") {' + NL +
      "\t\t\t\tconst ensured = ensureEmbeddedTextAnimFromTemplatePack(tplPack);" + NL +
      "\t\t\t\tconst hasAssign =" + NL +
      "\t\t\t\t\t!!(" + NL +
      "\t\t\t\t\t\ttextAnimsForClip?.in ||" + NL +
      "\t\t\t\t\t\ttextAnimsForClip?.out ||" + NL +
      "\t\t\t\t\t\ttextAnimsForClip?.loop" + NL +
      "\t\t\t\t\t);" + NL +
      "\t\t\t\tif (!hasAssign && ensured) textAnimsForClip = ensured;" + NL +
      "\t\t\t}" + NL +
      "\t\t}" + NL +
      "\t\tconst activePack = textAnimsForClip" + NL +
      "\t\t\t? resolveActiveTextAnimPack({" + NL +
      "\t\t\t\t\ttextAnims: textAnimsForClip," + NL +
      "\t\t\t\t\tlocalTimeSec: item.clipLocalTime ?? 0," + NL +
      "\t\t\t\t\tclipDurationSec: item.clipDurationSec ?? 0," + NL +
      "\t\t\t\t\tpayloadForPack: textAnimPayloadForPack," + NL +
      "\t\t\t\t})" + NL +
      "\t\t\t: null;" + NL;
    s = replaceOnce(s, oldActive, newActive, "active-pack");

    // Also replace later item.textAnims usages in this function with textAnimsForClip
    // Only the applyActiveTextAnimPack and hold-gap blocks that still use item.textAnims
    // Be careful not to replace type definitions etc.
    // Replace `if (item.textAnims)` block nearby and applyActiveTextAnimPack textAnims: item.textAnims
  }

  // After rehydrate, the later `if (item.textAnims)` and `textAnims: item.textAnims` in apply must use textAnimsForClip
  // Do targeted replacements within renderFlowerText scope by unique context
  if (s.includes("textAnimsForClip")) {
    // hold-gap / apply block still references item.textAnims — switch those in flower text path
    // Unique string: "if (item.textAnims) {\r\n\t\t\tpackPostProcess = activePack"
    const a = "if (item.textAnims) {" + NL + "\t\t\tpackPostProcess = activePack";
    const b = "if (textAnimsForClip) {" + NL + "\t\t\tpackPostProcess = activePack";
    if (s.includes(a)) s = replaceOnce(s, a, b, "if-textAnims");

    const c = "const assign = item.textAnims;" + NL;
    // might appear once in this function - check count
    let count = 0;
    let idx = 0;
    while ((idx = s.indexOf(c, idx)) >= 0) { count++; idx += c.length; }
    console.log("assign item.textAnims count", count);
    if (count === 1) {
      s = replaceOnce(s, c, "const assign = textAnimsForClip;" + NL, "assign");
    }

    const d =
      "\t\t\tconst uiPose = applyActiveTextAnimPack({" + NL +
      "\t\t\t\troot: built.root," + NL +
      "\t\t\t\ttextAnims: item.textAnims," + NL;
    const e =
      "\t\t\tconst uiPose = applyActiveTextAnimPack({" + NL +
      "\t\t\t\troot: built.root," + NL +
      "\t\t\t\ttextAnims: textAnimsForClip," + NL;
    if (s.includes(d)) s = replaceOnce(s, d, e, "apply-active");
  }

  // Remove unused embeddedTextAnimPackId import if we didn't use it - we imported but may not need
  if (s.includes('import { embeddedTextAnimPackId }') && !s.includes("embeddedTextAnimPackId(")) {
    s = s.replace('import { embeddedTextAnimPackId } from "@/vfxpack/text-template-textanim";' + NL, "");
  }

  fs.writeFileSync(root + "/services/renderer/compositor/three-compositor.ts", s);
  console.log("OK three-compositor");
}

// ---- index export ----
{
  let s = fs.readFileSync(root + "/vfxpack/index.ts", "utf8");
  const NL = s.includes("\r\n") ? "\r\n" : "\n";
  if (!s.includes("ensureEmbeddedTextAnimFromTemplatePack")) {
    s = replaceOnce(
      s,
      "\tbuildTextTemplateApply," + NL +
        "\tdescribeTextTemplateApply," + NL +
        "\tresolveTextTemplatePayload," + NL,
      "\tbuildTextTemplateApply," + NL +
        "\tensureEmbeddedTextAnimFromTemplatePack," + NL +
        "\tdescribeTextTemplateApply," + NL +
        "\tresolveTextTemplatePayload," + NL,
      "index-export"
    );
    fs.writeFileSync(root + "/vfxpack/index.ts", s);
    console.log("OK index");
  } else console.log("SKIP index");
}

// ---- version bumps ----
{
  let s = fs.readFileSync(root + "/vfxpack/timeline-flower-text.ts", "utf8");
  if (s.includes("rev: 59,")) {
    s = s.replace(
      "rev: 59, // fcc-tl-flower-59: export text-template pack video audio",
      "rev: 60, // fcc-tl-flower-60: rebind embedded textAnim after refresh"
    );
    fs.writeFileSync(root + "/vfxpack/timeline-flower-text.ts", s);
    console.log("OK rev");
  } else if (s.includes("rev: 60,")) console.log("SKIP rev");
  else throw new Error("rev marker not found");
}
{
  let s = fs.readFileSync(root + "/vfxpack/scene-builder.ts", "utf8");
  if (s.includes("sigRev: 49,")) {
    s = s.replace(
      "sigRev: 49, // fcc-tl-flower-59: export text-template pack video audio",
      "sigRev: 50, // fcc-tl-flower-60: rebind embedded textAnim after refresh"
    );
    fs.writeFileSync(root + "/vfxpack/scene-builder.ts", s);
    console.log("OK sigRev");
  } else if (s.includes("sigRev: 50,")) console.log("SKIP sigRev");
  else throw new Error("sigRev marker not found");
}
