from pathlib import Path
import re

p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
t = p.read_text(encoding="utf-8")

# Remove stackHasContributingEffects import
t2 = t.replace("\tstackHasContributingEffects,\n", "")
if t2 == t:
    t2 = t.replace("stackHasContributingEffects,\n", "")
t = t2

old = """\t\tconst packPpStack = packPostProcess as import(\"@/vfxpack/postprocess\").PostProcessStackData | null;
\t\t// Bloom strength~=0 must NOT take the PP path: OutputPass sRGB encode still runs
\t\t// and lifts luma vs overlay / editor strength=0 (linear beauty + OutputPass only when
\t\t// effects contribute). Skip composer when no effect still changes the picture.
\t\tconst useCameraPp =
\t\t\t!!packPpStack &&
\t\t\tpackPpStack.enabled !== false &&
\t\t\tstackHasContributingEffects(packPpStack);
"""
# Flexible match
m = re.search(
    r"const packPpStack = packPostProcess as import\(\"@/vfxpack/postprocess\"\)\.PostProcessStackData \| null;\n.*?const useCameraPp =\n\t\t\t!!packPpStack &&\n\t\t\tpackPpStack\.enabled !== false &&\n\t\t\tstackHasContributingEffects\(packPpStack\);",
    t,
    re.S,
)
if not m:
    # show nearby
    idx = t.find("packPpStack")
    print("NEAR:", repr(t[idx:idx+500]))
    raise SystemExit("useCameraPp block not found")
print("FOUND useCameraPp block")
repl = """\t\tconst packPpStack = packPostProcess as import(\"@/vfxpack/postprocess\").PostProcessStackData | null;
\t\t// Keep full Bloom+OutputPass stack even at strength=0. Color-space fix lives in
\t\t// buildPackComposer OutputPass wrap (none => no sRGB transfer) so PP luma matches overlay.
\t\tconst useCameraPp =
\t\t\t!!packPpStack &&
\t\t\tpackPpStack.enabled !== false &&
\t\t\tstackHasEnabledEffects(packPpStack);
"""
t = t[: m.start()] + repl + t[m.end() :]

if "stackHasContributingEffects" in t:
    print("WARNING: still references stackHasContributingEffects")
else:
    print("import/use cleaned")

p.write_text(t, encoding="utf-8")
print("three-compositor.ts OK")
