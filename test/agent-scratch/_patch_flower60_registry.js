const fs = require("fs");

function mustInclude(s, needle, label) {
  if (!s.includes(needle)) throw new Error("missing " + label + ": " + needle.slice(0, 80));
}
function replaceOnce(s, from, to, label) {
  mustInclude(s, from, label);
  const i = s.indexOf(from);
  return s.slice(0, i) + to + s.slice(i + from.length);
}

const root = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src";

// ---- pack-registry.ts ----
{
  let s = fs.readFileSync(root + "/vfxpack/pack-registry.ts", "utf8");
  if (!s.includes("onPackRegistered")) {
    s = replaceOnce(
      s,
      'import { revokePackObjectUrls } from "@/vfxpack/load-pack";\n',
      'import { revokePackObjectUrls } from "@/vfxpack/load-pack";\n\n' +
        "/** fcc-tl-flower-60: after text-template register, re-bind embedded textAnim virtual pack. */\n" +
        "const afterRegisterHooks: Array<(pack: LoadedVfxPack) => void> = [];\n" +
        "export function onPackRegistered(fn: (pack: LoadedVfxPack) => void): () => void {\n" +
        "\tafterRegisterHooks.push(fn);\n" +
        "\treturn () => {\n" +
        "\t\tconst i = afterRegisterHooks.indexOf(fn);\n" +
        "\t\tif (i >= 0) afterRegisterHooks.splice(i, 1);\n" +
        "\t};\n" +
        "}\n" +
        "function runAfterRegister(pack: LoadedVfxPack) {\n" +
        "\tfor (const fn of afterRegisterHooks) {\n" +
        "\t\ttry {\n" +
        "\t\t\tfn(pack);\n" +
        "\t\t} catch (err) {\n" +
        '\t\t\tconsole.warn("[FreeFilmCut] onPackRegistered hook failed", err);\n' +
        "\t\t}\n" +
        "\t}\n" +
        "}\n",
      "registry-import"
    );
    s = replaceOnce(
      s,
      "\t\tset((state) => ({\n" +
        "\t\t\tpacks: [...state.packs.filter((p) => p.id !== pack.id), pack],\n" +
        "\t\t}));\n" +
        "\t},\n" +
        "\tremovePack: (packId) => {\n",
      "\t\tset((state) => ({\n" +
        "\t\t\tpacks: [...state.packs.filter((p) => p.id !== pack.id), pack],\n" +
        "\t\t}));\n" +
        "\t\trunAfterRegister(pack);\n" +
        "\t},\n" +
        "\tremovePack: (packId) => {\n",
      "registry-register"
    );
    s = replaceOnce(
      s,
      "\tremovePack: (packId) => {\n" +
        "\t\tconst pack = get().packs.find((p) => p.id === packId);\n" +
        "\t\tif (pack) revokePackObjectUrls({ pack });\n" +
        "\t\tset((state) => ({\n" +
        "\t\t\tpacks: state.packs.filter((p) => p.id !== packId),\n" +
        "\t\t\tactiveOverlayIds: state.activeOverlayIds.filter((id) => id !== packId),\n" +
        "\t\t}));\n" +
        "\t},\n",
      "\tremovePack: (packId) => {\n" +
        "\t\tconst pack = get().packs.find((p) => p.id === packId);\n" +
        "\t\tif (pack) revokePackObjectUrls({ pack });\n" +
        "\t\tconst embeddedId = `${packId}::embedded-textanim`;\n" +
        "\t\tconst embedded = get().packs.find((p) => p.id === embeddedId);\n" +
        "\t\tif (embedded) revokePackObjectUrls({ pack: embedded });\n" +
        "\t\tset((state) => ({\n" +
        "\t\t\tpacks: state.packs.filter((p) => p.id !== packId && p.id !== embeddedId),\n" +
        "\t\t\tactiveOverlayIds: state.activeOverlayIds.filter(\n" +
        "\t\t\t\t(id) => id !== packId && id !== embeddedId,\n" +
        "\t\t\t),\n" +
        "\t\t}));\n" +
        "\t},\n",
      "registry-remove"
    );
    fs.writeFileSync(root + "/vfxpack/pack-registry.ts", s);
    console.log("OK pack-registry");
  } else console.log("SKIP pack-registry");
}
