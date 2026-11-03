from pathlib import Path
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts").read_text(encoding="utf-8")
idx = comp.find("const prevCS = rendererArg.outputColorSpace")
print(comp[idx:idx+650])
print("---")
# ensure texture fx still builds bloom at strength 0 (no contribute gate)
assert "stackHasContributingEffects" not in comp
assert "if (!effectContributes" not in comp
print("texture/pack gates clean")
# index exports
idx_path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\index.ts")
print(idx_path.read_text(encoding="utf-8"))
