from pathlib import Path
tc = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
src = tc.read_text(encoding="utf-8")
# Remove unused helper (restores are inlined at call sites).
start = src.find("\t/** Push/pop renderer viewport+scissor so tight text FBO sizes cannot leak to other clips. */")
if start < 0:
    print("helper not found (ok)")
else:
    end = src.find("\tprivate presentAccum() {", start)
    if end < 0:
        raise SystemExit("presentAccum after helper not found")
    src = src[:start] + src[end:]
    tc.write_text(src, encoding="utf-8")
    print("removed unused withFullTargetViewport")

# Verify critical snippets exist
checks = [
    "renderer.setViewport(0, 0, accumRT.width, accumRT.height);",
    "EffectComposer sets viewport to its FBO size",
    "prevScissorTestBlit",
    "viewportScratch",
]
src2 = tc.read_text(encoding="utf-8")
for c in checks:
    print(("OK" if c in src2 else "MISSING"), c)

tl = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\text-layer-rt.ts").read_text(encoding="utf-8")
print(("OK" if "renderer.setViewport(prevViewport);" in tl else "MISSING"), "text-layer-rt restore")
print(("OK" if "getScissorTest" in tl else "MISSING"), "text-layer-rt scissorTest")
