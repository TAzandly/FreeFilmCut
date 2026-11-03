from pathlib import Path
rt = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js").read_text(encoding="utf-8")
print(rt[rt.find("import {"):rt.find("from './TextAnim.js")+80])
print("wipeOn block:")
i = rt.find("wipeOn")
print(rt[i-120:i+400])
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
import re
print("caches", re.findall(r"Text(LayerRT|AnimRuntime)\.js\?v=[^\"]+", vp))
