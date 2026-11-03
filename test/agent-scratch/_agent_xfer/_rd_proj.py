from pathlib import Path
rt_path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js")
rt = rt_path.read_text(encoding="utf-8")
# Add camera.updateMatrixWorld before projection loop
needle = "\t// Project world ? RT pixels via overlay ortho (same camera as text RT draw).\n"
# find Project world
i = rt.find("Project world")
print("idx", i)
print(repr(rt[i-50:i+200]))
