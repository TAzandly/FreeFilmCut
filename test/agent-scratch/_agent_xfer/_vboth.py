from pathlib import Path
rt = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js").read_text(encoding="utf-8")
tl = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js").read_text(encoding="utf-8")
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
print("pixelOrtho", "pixelOrtho" in rt)
print("raw py", "px = worldPts[ i ]" in rt)
print("debug text*reveal", "c.rgb * reveal" in tl[tl.find("uDebug"):tl.find("uDebug")+800])
print("Show masked text", "Show masked text" in tl or "masked text" in tl)
print("caches", "fcc-ui-19" in vp, "fcc-ui-12" in vp)
