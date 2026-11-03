from pathlib import Path
import re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor")
V = "fcc-ui-6"

# Fix remaining mismatches
for rel in ["js/VfxPackExporter.js", "js/preview/PreviewCapture.js"]:
    p = root/rel
    t = p.read_text(encoding="utf-8", errors="replace")
    t2 = re.sub(r"PostProcessRegistry\.js\?v=[^'\"]+", f"PostProcessRegistry.js?v={V}", t)
    t2 = re.sub(r"BuiltinEffects\.js\?v=[^'\"]+", f"BuiltinEffects.js?v={V}", t2)
    t2 = re.sub(r"PostProcessStack\.js\?v=[^'\"]+", f"PostProcessStack.js?v={V}", t2)
    if t2 != t:
        p.write_text(t2, encoding="utf-8")
        print("fixed", rel)
    else:
        print("no change", rel)

# Bump consumer cache so fixed TextFx/PP sidebars load
bumps = [
    (root/"js/Sidebar.Object.UI.js", r"Sidebar\.Object\.TextFx\.js\?v=[^'\"]+", "Sidebar.Object.TextFx.js?v=fcc-ui-3"),
    (root/"js/Sidebar.Object.js", r"Sidebar\.Object\.UI\.js\?v=[^'\"]+", "Sidebar.Object.UI.js?v=fcc-ui-81"),
    (root/"js/Sidebar.Object.js", r"Sidebar\.Object\.PostProcess\.js\?v=[^'\"]+", "Sidebar.Object.PostProcess.js?v=fcc-ui-46"),
    (root/"js/Sidebar.Properties.js", r"Sidebar\.Object\.js\?v=[^'\"]+", "Sidebar.Object.js?v=fcc-ui-78"),
    (root/"js/Sidebar.js", r"Sidebar\.Properties\.js\?v=[^'\"]+", "Sidebar.Properties.js?v=fcc-ui-89"),
    (root/"index.html", r"Sidebar\.js\?v=fcc-ui-\d+", "Sidebar.js?v=fcc-ui-89"),
]
for path, pat, repl in bumps:
    t = path.read_text(encoding="utf-8", errors="replace")
    t2, n = re.subn(pat, repl, t, count=1)
    path.write_text(t2, encoding="utf-8")
    print(f"bump {path.name}: {n} -> {repl}")

# Verify NO split Registry instances among critical path
print("\n=== final Registry/Builtin imports ===")
for p in (root/"js").rglob("*.js"):
    if "node_modules" in str(p): continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r"(PostProcessRegistry|BuiltinEffects|PostProcessStack)\.js\?v=([^'\"]+)", t):
        if m.group(2) != V:
            print("MISMATCH", p.name, m.group(0))
print("done")
