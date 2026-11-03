from pathlib import Path
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
# Current wipe apply + viewport wipe block
vp = (ROOT/"Viewport.js").read_text(encoding="utf-8")
i = vp.find("if ( wipeInfo )")
print(vp[i:i+1200])
print("====")
tl = (ROOT/"ui/TextLayerRT.js").read_text(encoding="utf-8")
print("exports:", [l for l in tl.splitlines() if l.startswith("export ")])
print("applyWipe layout wiring:")
i = tl.find("const layout = args.layout")
print(tl[i:i+700] if i>=0 else "not found")
