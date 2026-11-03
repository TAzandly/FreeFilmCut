from pathlib import Path
import json
pkg = json.loads(Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\node_modules\troika-three-text\package.json").read_text(encoding="utf-8"))
print("deps", pkg.get("dependencies"))
# find utils anywhere under apps/web/node_modules
root = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\node_modules")
found = list(root.glob("**/troika-three-utils/package.json"))
print("found", found[:5])
# also check if createDerivedMaterial is re-exported from troika-three-text
esm = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\node_modules\troika-three-text\dist\troika-three-text.esm.js").read_text(encoding="utf-8")
print("createDerivedMaterial in esm", "createDerivedMaterial" in esm)
print("export createTextDerivedMaterial", "createTextDerivedMaterial" in esm[-500:])
idx = esm.rfind("export {")
print(esm[idx:idx+400] if idx>0 else "no export")
