from pathlib import Path
import re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
V = "fcc-ui-6"

# Files and replacements: any PostProcessRegistry / BuiltinEffects / PostProcessStack query → V
replacements = [
    (root/"postprocessing/BuiltinEffects.js", [
        (r"PostProcessRegistry\.js\?v=[^'\"]+", f"PostProcessRegistry.js?v={V}"),
    ]),
    (root/"postprocessing/PostProcessStack.js", [
        (r"PostProcessRegistry\.js\?v=[^'\"]+", f"PostProcessRegistry.js?v={V}"),
        (r"BuiltinEffects\.js\?v=[^'\"]+", f"BuiltinEffects.js?v={V}"),
    ]),
    (root/"Sidebar.Object.PostProcess.js", [
        (r"PostProcessRegistry\.js\?v=[^'\"]+", f"PostProcessRegistry.js?v={V}"),
        (r"BuiltinEffects\.js\?v=[^'\"]+", f"BuiltinEffects.js?v={V}"),
    ]),
    (root/"Sidebar.Object.TextFx.js", [
        (r"PostProcessRegistry\.js\?v=[^'\"]+", f"PostProcessRegistry.js?v={V}"),
        (r"BuiltinEffects\.js\?v=[^'\"]+", f"BuiltinEffects.js?v={V}"),
    ]),
    (root/"ui/TextLayerRT.js", [
        (r"PostProcessStack\.js\?v=[^'\"]+", f"PostProcessStack.js?v={V}"),
        (r"BuiltinEffects\.js\?v=[^'\"]+", f"BuiltinEffects.js?v={V}"),
    ]),
    (root/"Viewport.js", [
        (r"PostProcessStack\.js\?v=[^'\"]+", f"PostProcessStack.js?v={V}"),
        (r"TextLayerRT\.js\?v=[^'\"]+", f"TextLayerRT.js?v={V}"),
        # Registry if any
        (r"PostProcessRegistry\.js\?v=[^'\"]+", f"PostProcessRegistry.js?v={V}"),
    ]),
]

for path, pats in replacements:
    t = path.read_text(encoding="utf-8", errors="replace")
    orig = t
    for pat, repl in pats:
        t, n = re.subn(pat, repl, t)
        print(f"{path.name}: {pat[:40]}... -> {n} repl")
    if t != orig:
        path.write_text(t, encoding="utf-8")
        print(f"  wrote {path.name}")

# Also any other files importing these with old v
for p in root.rglob("*.js"):
    if "node_modules" in str(p): continue
    t = p.read_text(encoding="utf-8", errors="replace")
    if "PostProcessRegistry.js?v=" in t or "BuiltinEffects.js?v=" in t or "PostProcessStack.js?v=" in t:
        bad = []
        for m in re.finditer(r"(PostProcessRegistry|BuiltinEffects|PostProcessStack)\.js\?v=([^'\"]+)", t):
            if m.group(2) != V:
                bad.append(m.group(0))
        if bad:
            print("STILL MISMATCH", p.relative_to(root), bad)
