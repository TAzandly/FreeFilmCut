from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
lines = p.read_text(encoding="utf-8").splitlines()
for i in range(280, 450):
    print("%d|%s" % (i+1, lines[i]))
