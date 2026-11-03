# -*- coding: utf-8 -*-
from pathlib import Path
SCENE_BUILDER = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
text = SCENE_BUILDER.read_text(encoding="utf-8")
i = text.find("vertUrl")
print(repr(text[i-10:i+350]))
