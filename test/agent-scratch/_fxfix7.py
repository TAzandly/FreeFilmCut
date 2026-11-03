from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
t = comp.read_text(encoding="utf-8", errors="replace")
i = t.find("export type BuiltTextureFx")
print(t[i:i+3500])
