from pathlib import Path

comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
text = comp.read_text(encoding="utf-8")

old_imp = """import {
	getEffectDescriptor,
	registerBuiltinPostEffects,
	stackHasEnabledEffects,
	normalizeEffectStack,
	type PostProcessStackData,
} from \"./registry\";"""
new_imp = """import {
	getEffectDescriptor,
	registerBuiltinPostEffects,
	stackHasEnabledEffects,
	stackHasContributingEffects,
	effectContributes,
	normalizeEffectStack,
	type PostProcessStackData,
} from \"./registry\";"""

if "stackHasContributingEffects," in text and "from \"./registry\"" in text:
    print("composer import: already")
elif old_imp not in text:
    raise SystemExit("composer import needle missing")
else:
    text = text.replace(old_imp, new_imp, 1)
    print("composer import: ok")

old_build = """}): BuiltPostProcess | null {
	if (!stackHasEnabledEffects(stack)) return null;

	const liveStack = mergeLiveParams({ stack, exposed, liveParams });
"""
new_build = """}): BuiltPostProcess | null {
	if (!stackHasEnabledEffects(stack)) return null;

	const liveStack = mergeLiveParams({ stack, exposed, liveParams });
	// strength~=0 bloom still "enabled" — skip composer so clip matches overlay luma
	// (OutputPass sRGB only on PP path was washing text vs no-PP).
	if (!stackHasContributingEffects(liveStack)) return null;
"""
if "stackHasContributingEffects(liveStack)" in text:
    print("composer early: already")
elif old_build not in text:
    raise SystemExit("composer early needle missing")
else:
    text = text.replace(old_build, new_build, 1)
    print("composer early: ok")

old_loop = """	for (const entry of liveStack.effects || []) {
		if (!entry || entry.enabled === false) continue;
		const desc = getEffectDescriptor(entry.type);
"""
new_loop = """	for (const entry of liveStack.effects || []) {
		if (!entry || entry.enabled === false) continue;
		if (!effectContributes(entry)) continue;
		const desc = getEffectDescriptor(entry.type);
"""
if "if (!effectContributes(entry)) continue;" in text:
    print("composer loop: already")
elif old_loop not in text:
    raise SystemExit("composer loop needle missing")
else:
    text = text.replace(old_loop, new_loop, 1)
    print("composer loop: ok")

comp.write_text(text, encoding="utf-8")
print("composer written")
