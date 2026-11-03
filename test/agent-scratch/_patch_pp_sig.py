from pathlib import Path

idx = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\index.ts")
t = idx.read_text(encoding="utf-8")
needle = "\tpackComposerSignature,\n"
insert = "\tpackComposerSignature,\n\tapplyPackComposerParams,\n"
if "applyPackComposerParams" not in t:
    if needle not in t:
        raise SystemExit("needle not in postprocess/index.ts")
    t = t.replace(needle, insert, 1)
    idx.write_text(t, encoding="utf-8")
    print("postprocess/index.ts OK")
else:
    print("postprocess/index.ts already")

vi = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\index.ts")
vt = vi.read_text(encoding="utf-8")
if "applyPackComposerParams" not in vt:
    if needle not in vt:
        raise SystemExit("needle not in vfxpack/index.ts")
    vi.write_text(vt.replace(needle, insert, 1), encoding="utf-8")
    print("vfxpack/index.ts OK")
else:
    print("vfxpack/index.ts already")
