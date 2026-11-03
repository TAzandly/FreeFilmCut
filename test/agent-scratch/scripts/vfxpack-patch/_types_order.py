from pathlib import Path
t = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\types.ts").read_text(encoding="utf-8")
for name in ["VfxManifest", "VfxPackRenderSettings", "VfxSceneFile", "LoadedVfxPack"]:
    print(name, t.find(f"export interface {name}"), t.find(f"export type {name}"))
# show if manifest has render
i = t.find("export interface VfxManifest")
print(t[i:i+800])
