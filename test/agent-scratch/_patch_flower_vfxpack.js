const fs = require("fs");

function bump(path, pairs) {
  let s = fs.readFileSync(path, "utf8");
  let n = 0;
  for (const [a, b] of pairs) {
    if (!s.includes(a)) {
      console.log("MISS", path, JSON.stringify(a).slice(0, 80));
      continue;
    }
    s = s.split(a).join(b);
    n++;
  }
  fs.writeFileSync(path, s);
  console.log("bumped", path, n);
}

bump("freefilmcut/apps/web/src/vfxpack/timeline-flower-text.ts", [
  [
    "rev: 36, // fcc-tl-flower-36: RT wrapMode selectable",
    "rev: 37, // fcc-tl-flower-37: flower catalog loads .vfxpack directly",
  ],
]);

bump("freefilmcut/apps/web/src/vfxpack/scene-builder.ts", [
  [
    "sigRev: 33, // fcc-tl-flower-36: RT wrapMode clamp/repeat/mirroredRepeat",
    "sigRev: 34, // fcc-tl-flower-37: flower catalog loads .vfxpack directly",
  ],
]);

const indexPath = "freefilmcut/apps/web/src/vfxpack/index.ts";
let idx = fs.readFileSync(indexPath, "utf8");
if (!idx.includes("FLOWER_CATALOG_REV")) {
  const needle =
    'extractFlowerStyleFromVfxpackBytes,\n} from "@/vfxpack/flower-pack-catalog";';
  const repl =
    'extractFlowerStyleFromVfxpackBytes,\n\tFLOWER_CATALOG_REV,\n} from "@/vfxpack/flower-pack-catalog";';
  if (!idx.includes(needle)) {
    // try CRLF
    const needle2 = needle.replace(/\n/g, "\r\n");
    const repl2 = repl.replace(/\n/g, "\r\n");
    if (idx.includes(needle2)) {
      idx = idx.split(needle2).join(repl2);
      fs.writeFileSync(indexPath, idx);
      console.log("index export added (crlf)");
    } else {
      console.log("index needle missing; dump nearby:");
      const i = idx.indexOf("extractFlowerStyleFromVfxpackBytes");
      console.log(JSON.stringify(idx.slice(i, i + 120)));
    }
  } else {
    idx = idx.split(needle).join(repl);
    fs.writeFileSync(indexPath, idx);
    console.log("index export added");
  }
} else {
  console.log("index already exports FLOWER_CATALOG_REV");
}
