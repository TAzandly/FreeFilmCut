const fs = require("fs");
const f = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/apply-text-template.ts";
let s = fs.readFileSync(f, "utf8");
const NL = s.includes("\r\n") ? "\r\n" : "\n";
const dup =
  "\tconst animRefs = (" + NL +
  "\t\ttpl as {" + NL +
  "\t\t\tanimRefs?: { in?: string | null; out?: string | null; loop?: string | null };" + NL +
  "\t\t} | null" + NL +
  "\t)?.animRefs;" + NL;
if (!s.includes(dup)) throw new Error("dup block missing");
s = s.replace(dup, "\tconst animRefs = animRefsEarly;" + NL);
fs.writeFileSync(f, s);
console.log("deduped animRefs");

// Also export onPackRegistered from index for completeness
let idx = fs.readFileSync("D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/index.ts", "utf8");
if (!idx.includes("onPackRegistered")) {
  idx = idx.replace(
    "subscribePackRegistry,",
    "subscribePackRegistry,\n\tonPackRegistered,"
  );
  // check if that export block exists
  if (!idx.includes("onPackRegistered")) {
    console.log("could not add onPackRegistered export - checking pack-registry reexport");
    const i = idx.indexOf("pack-registry");
    console.log(idx.slice(i-80, i+200));
  } else {
    fs.writeFileSync("D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/index.ts", idx);
    console.log("exported onPackRegistered");
  }
}
