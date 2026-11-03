from pathlib import Path
import re, sys, subprocess
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor")
V = "fcc-ui-7"

# Ensure TextLayerRT imports V
tl = root/"js/ui/TextLayerRT.js"
tt = tl.read_text(encoding="utf-8", errors="replace")
tt2 = re.sub(r"PostProcessStack\.js\?v=[^'\"]+", f"PostProcessStack.js?v={V}", tt)
tt2 = re.sub(r"BuiltinEffects\.js\?v=[^'\"]+", f"BuiltinEffects.js?v={V}", tt2)
tl.write_text(tt2, encoding="utf-8")
print("TextLayerRT imports:", re.findall(r"from '[^']+Post[^']+'", tt2))

bumps = [
    (root/"js/Viewport.js", r"TextLayerRT\.js\?v=[^'\"]+", f"TextLayerRT.js?v={V}"),
    (root/"js/Sidebar.Object.UI.js", r"Sidebar\.Object\.TextFx\.js\?v=[^'\"]+", "Sidebar.Object.TextFx.js?v=fcc-ui-4"),
    (root/"js/Sidebar.Object.js", r"Sidebar\.Object\.UI\.js\?v=[^'\"]+", "Sidebar.Object.UI.js?v=fcc-ui-82"),
    (root/"js/Sidebar.Object.js", r"Sidebar\.Object\.PostProcess\.js\?v=[^'\"]+", "Sidebar.Object.PostProcess.js?v=fcc-ui-47"),
    (root/"js/Sidebar.Properties.js", r"Sidebar\.Object\.js\?v=[^'\"]+", "Sidebar.Object.js?v=fcc-ui-79"),
    (root/"js/Sidebar.js", r"Sidebar\.Properties\.js\?v=[^'\"]+", "Sidebar.Properties.js?v=fcc-ui-90"),
    (root/"index.html", r"Sidebar\.js\?v=fcc-ui-\d+", "Sidebar.js?v=fcc-ui-90"),
    (root/"index.html", r"Viewport\.js\?v=fcc-ui-\d+", "Viewport.js?v=fcc-ui-89"),
]
for path, pat, repl in bumps:
    t = path.read_text(encoding="utf-8", errors="replace")
    t2, n = re.subn(pat, repl, t, count=1)
    path.write_text(t2, encoding="utf-8")
    print(f"bump {path.name}: {n} -> {repl}")

urls = set()
for p in (root/"js").rglob("*.js"):
    if "node_modules" in str(p): continue
    for m in re.finditer(r"(PostProcessRegistry|BuiltinEffects|PostProcessStack)\.js\?v=([^'\"]+)", p.read_text(encoding="utf-8", errors="replace")):
        if m.group(2) != V:
            print("MISMATCH", p.name, m.group(0))
        urls.add(m.group(0))
print("all urls:", sorted(urls))

for rel in ["js/postprocessing/PostProcessStack.js", "js/ui/TextLayerRT.js", "js/postprocessing/InvertColorPass.js"]:
    r = subprocess.run(["node", "--check", str(root/rel)], capture_output=True, text=True)
    print(rel, "rc", r.returncode, (r.stderr or "ok")[:200])
