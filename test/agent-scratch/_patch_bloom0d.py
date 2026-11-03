from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
t = p.read_text(encoding="utf-8")
old = """	const normalized = normalizeEffectStack(stack ?? null);
	if (!stackHasEnabledEffects(normalized)) return inputTexture;
"""
new = """	const normalized = normalizeEffectStack(stack ?? null);
	if (!stackHasEnabledEffects(normalized)) return inputTexture;
	if (!stackHasContributingEffects(normalized)) return inputTexture;
"""
if "if (!stackHasContributingEffects(normalized)) return inputTexture;" in t:
    print("renderTextureFx: already")
elif old not in t:
    raise SystemExit("renderTextureFx needle missing")
else:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("renderTextureFx: ok")
