from pathlib import Path

# Spot-check key files
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts").read_text(encoding="utf-8")
reg = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\registry.ts").read_text(encoding="utf-8")
tc = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts").read_text(encoding="utf-8")

checks = [
    ("composer NoColorSpace none wrap", "outputColorSpace = THREE.NoColorSpace" in comp),
    ("composer no contributing skip", "stackHasContributingEffects" not in comp),
    ("composer no effectContributes", "effectContributes" not in comp),
    ("composer still stackHasEnabledEffects", "stackHasEnabledEffects" in comp),
    ("composer LDR clamp kept", "LdrPreBloomClampPass" in comp),
    ("registry effectContributes no strength", "Math.abs(s) > 1e-5" not in reg),
    ("registry stackHasContributingEffects alias", "Use stackHasEnabledEffects" in reg),
    ("compositor useCameraPp enabled", "stackHasEnabledEffects(packPpStack)" in tc),
    ("compositor no contributing", "stackHasContributingEffects" not in tc),
]
for name, ok in checks:
    print(("OK" if ok else "FAIL"), name)

# Show OutputPass wrap snippet
idx = comp.find("const prevCS = rendererArg.outputColorSpace")
print("--- OutputPass wrap ---")
print(comp[idx-80:idx+520])
print("--- useCameraPp ---")
idx = tc.find("const useCameraPp")
print(tc[idx-200:idx+220])
