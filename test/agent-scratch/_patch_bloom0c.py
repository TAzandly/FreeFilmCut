from pathlib import Path

comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
t = comp.read_text(encoding="utf-8")

# Texture FX loop — skip non-contributing (second similar loop)
old = """	for (const entry of normalized.effects) {
		if (!entry || entry.enabled === false) continue;
		const desc = getEffectDescriptor(entry.type);
		if (!desc) continue;
		const params = { ...desc.createDefaultParams(), ...(entry.params || {}) };
		const passes = desc.createPasses(ctx) || [];
"""
new = """	for (const entry of normalized.effects) {
		if (!entry || entry.enabled === false) continue;
		if (!effectContributes(entry)) continue;
		const desc = getEffectDescriptor(entry.type);
		if (!desc) continue;
		const params = { ...desc.createDefaultParams(), ...(entry.params || {}) };
		const passes = desc.createPasses(ctx) || [];
"""
if old not in t:
    # maybe already has contribute or different formatting
    if "if (!effectContributes(entry)) continue;\n\t\tconst desc = getEffectDescriptor(entry.type);\n\t\tif (!desc) continue;\n\t\tconst params = { ...desc.createDefaultParams(), ...(entry.params || {}) };\n\t\tconst passes = desc.createPasses(ctx)" in t:
        print("texture fx loop: already")
    else:
        raise SystemExit("texture fx loop needle missing")
else:
    t = t.replace(old, new, 1)
    comp.write_text(t, encoding="utf-8")
    print("texture fx loop: ok")

# Also early-out texture fx if nothing contributes
t = comp.read_text(encoding="utf-8")
old2 = """	const normalized = normalizeEffectStack(stack);
	if (!stackHasEnabledEffects(normalized)) return null;

	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));

	// HalfFloat: UnrealBloom soft falloff bands hard in UnsignedByte ping-pong.
"""
new2 = """	const normalized = normalizeEffectStack(stack);
	if (!stackHasEnabledEffects(normalized)) return null;
	if (!stackHasContributingEffects(normalized)) return null;

	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));

	// HalfFloat: UnrealBloom soft falloff bands hard in UnsignedByte ping-pong.
"""
if "if (!stackHasContributingEffects(normalized)) return null;" in t and "buildTextureFxComposer" in t:
    # check if already in texture fx specifically - count
    c = t.count("if (!stackHasContributingEffects(normalized)) return null;")
    if c >= 1 and "texture fx early" :
        # might only be once after our pack composer used liveStack not normalized
        if old2 in t:
            t = t.replace(old2, new2, 1)
            comp.write_text(t, encoding="utf-8")
            print("texture fx early: ok")
        else:
            print("texture fx early: skip/already", c)
else:
    if old2 not in t:
        raise SystemExit("texture fx early needle missing")
    t = t.replace(old2, new2, 1)
    comp.write_text(t, encoding="utf-8")
    print("texture fx early: ok")
