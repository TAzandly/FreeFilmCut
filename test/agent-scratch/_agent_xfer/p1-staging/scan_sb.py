from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
lines = p.read_text(encoding="utf-8").splitlines()
for i, l in enumerate(lines[:35], 1):
    print("%d|%s" % (i, l))
print("---")
for i, l in enumerate(lines):
    if "PACK_SCENE_BUILD_REV" in l:
        print("rev", i + 1, l)
    if 'uiType === "text"' in l:
        print("textstart", i + 1, l)
    if 'name = "__fccText"' in l or "name = '__fccText'" in l:
        print("fccText", i + 1, l)
    if "__fccSyncText" in l:
        print("sync", i + 1, l[:80])
