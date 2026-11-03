from pathlib import Path

# postprocess/index.ts
idx = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\index.ts")
t = idx.read_text(encoding="utf-8")
old = """export {
	registerBuiltinPostEffects,
	getEffectDescriptor,
	stackHasEnabledEffects,
	normalizeEffectStack,
	ensureTextFxStack,
	listEffectTypes,
} from \"./registry\";"""
new = """export {
	registerBuiltinPostEffects,
	getEffectDescriptor,
	stackHasEnabledEffects,
	effectContributes,
	stackHasContributingEffects,
	normalizeEffectStack,
	ensureTextFxStack,
	listEffectTypes,
} from \"./registry\";"""
if "stackHasContributingEffects" in t:
    print("pp index: already")
elif old not in t:
    raise SystemExit("pp index needle missing")
else:
    idx.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("pp index: ok")

# vfxpack/index.ts
vidx = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\index.ts")
t = vidx.read_text(encoding="utf-8")
old = """export {
	buildPackComposer,
	packComposerSignature,
	buildTextureFxComposer,
	renderTextureFx,
	applyExposedMaterialParams,
	applyExposedTextParams,
	stackHasEnabledEffects,
	normalizeEffectStack,
	ensureTextFxStack,
	type PostProcessStackData,
	type BuiltPostProcess,
	type BuiltTextureFx,
	type TextureFxCache,
} from \"@/vfxpack/postprocess\";"""
new = """export {
	buildPackComposer,
	packComposerSignature,
	buildTextureFxComposer,
	renderTextureFx,
	applyExposedMaterialParams,
	applyExposedTextParams,
	stackHasEnabledEffects,
	effectContributes,
	stackHasContributingEffects,
	normalizeEffectStack,
	ensureTextFxStack,
	type PostProcessStackData,
	type BuiltPostProcess,
	type BuiltTextureFx,
	type TextureFxCache,
} from \"@/vfxpack/postprocess\";"""
if "stackHasContributingEffects" in t and "from \"@/vfxpack/postprocess\"" in t:
    # check specifically in export block
    if "stackHasContributingEffects," in t or "stackHasContributingEffects\n" in t:
        print("vfxpack index: already")
    else:
        if old not in t:
            raise SystemExit("vfxpack index needle missing")
        vidx.write_text(t.replace(old, new, 1), encoding="utf-8")
        print("vfxpack index: ok")
elif old not in t:
    raise SystemExit("vfxpack index needle missing")
else:
    vidx.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("vfxpack index: ok")

# three-compositor.ts
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
t = comp.read_text(encoding="utf-8")
old_imp = """	stackHasEnabledEffects,"""
new_imp = """	stackHasEnabledEffects,
	stackHasContributingEffects,"""
if "stackHasContributingEffects" in t:
    print("compositor import: already")
elif old_imp not in t:
    raise SystemExit("compositor import needle missing")
else:
    t = t.replace(old_imp, new_imp, 1)
    print("compositor import: ok")

old_use = """		const packPpStack = packPostProcess as import(\"@/vfxpack/postprocess\").PostProcessStackData | null;
		const useCameraPp =
			!!packPpStack &&
			packPpStack.enabled !== false &&
			Array.isArray(packPpStack.effects) &&
			packPpStack.effects.some((e) => e && e.enabled !== false);
"""
new_use = """		const packPpStack = packPostProcess as import(\"@/vfxpack/postprocess\").PostProcessStackData | null;
		// Bloom strength~=0 must NOT take the PP path: OutputPass sRGB encode still runs
		// and lifts luma vs overlay / editor strength=0 (linear beauty + OutputPass only when
		// effects contribute). Skip composer when no effect still changes the picture.
		const useCameraPp =
			!!packPpStack &&
			packPpStack.enabled !== false &&
			stackHasContributingEffects(packPpStack);
"""
if "stackHasContributingEffects(packPpStack)" in t:
    print("compositor useCameraPp: already")
elif old_use not in t:
    raise SystemExit("compositor useCameraPp needle missing")
else:
    t = t.replace(old_use, new_use, 1)
    print("compositor useCameraPp: ok")

comp.write_text(t, encoding="utf-8")
print("compositor written")
