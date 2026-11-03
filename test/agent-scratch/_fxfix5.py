from pathlib import Path
import re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor")
V = "fcc-ui-7"

# Align every Registry/Builtin/Stack import to V
for p in (root/"js").rglob("*.js"):
    if "node_modules" in str(p): continue
    t = p.read_text(encoding="utf-8", errors="replace")
    t2 = re.sub(r"PostProcessRegistry\.js\?v=[^'\"]+", f"PostProcessRegistry.js?v={V}", t)
    t2 = re.sub(r"BuiltinEffects\.js\?v=[^'\"]+", f"BuiltinEffects.js?v={V}", t2)
    t2 = re.sub(r"PostProcessStack\.js\?v=[^'\"]+", f"PostProcessStack.js?v={V}", t2)
    if t2 != t:
        p.write_text(t2, encoding="utf-8")
        print("aligned", p.relative_to(root/"js"))

# Also invert is imported by BuiltinEffects without version - OK same file

# Bump consumers
bumps = [
    (root/"js/ui/TextLayerRT.js", r"TextLayerRT", None),  # self not needed
    (root/"js/Viewport.js", r"TextLayerRT\.js\?v=[^'\"]+", f"TextLayerRT.js?v={V}"),
    (root/"js/Sidebar.Object.TextFx.js", None, None),  # already aligned via glob
    (root/"js/Sidebar.Object.UI.js", r"Sidebar\.Object\.TextFx\.js\?v=[^'\"]+", "Sidebar.Object.TextFx.js?v=fcc-ui-4"),
    (root/"js/Sidebar.Object.js", r"Sidebar\.Object\.UI\.js\?v=[^'\"]+", "Sidebar.Object.UI.js?v=fcc-ui-82"),
    (root/"js/Sidebar.Object.js", r"Sidebar\.Object\.PostProcess\.js\?v=[^'\"]+", "Sidebar.Object.PostProcess.js?v=fcc-ui-47"),
    (root/"js/Sidebar.Properties.js", r"Sidebar\.Object\.js\?v=[^'\"]+", "Sidebar.Object.js?v=fcc-ui-79"),
    (root/"js/Sidebar.js", r"Sidebar\.Properties\.js\?v=[^'\"]+", "Sidebar.Properties.js?v=fcc-ui-90"),
    (root/"index.html", r"Sidebar\.js\?v=fcc-ui-\d+", "Sidebar.js?v=fcc-ui-90"),
    (root/"index.html", r"Viewport\.js\?v=fcc-ui-\d+", "Viewport.js?v=fcc-ui-89"),
]
for item in bumps:
    path, pat, repl = item
    if not pat: continue
    t = path.read_text(encoding="utf-8", errors="replace")
    t2, n = re.subn(pat, repl, t, count=1)
    path.write_text(t2, encoding="utf-8")
    print(f"bump {path.name}: {n}")

# Verify single Registry URL
urls = set()
for p in (root/"js").rglob("*.js"):
    if "node_modules" in str(p): continue
    for m in re.finditer(r"PostProcessRegistry\.js\?v=[^'\"]+", p.read_text(encoding="utf-8", errors="replace")):
        urls.add(m.group(0))
print("Registry URLs:", urls)

# node --check key files
import subprocess
for rel in ["js/postprocessing/PostProcessStack.js", "js/ui/TextLayerRT.js", "js/postprocessing/InvertColorPass.js"]:
    r = subprocess.run(["node", "--check", str(root/rel)], capture_output=True, text=True)
    print(rel, "rc", r.returncode, r.stderr[:200] if r.stderr else "ok")
