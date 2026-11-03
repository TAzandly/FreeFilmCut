from pathlib import Path
tc = Path(r"freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts")
t = tc.read_text(encoding="utf-8")
old = '''\t\tcase "none":
\t\tcase "notonemapping":
\t\t\treturn THREE.NoToneMapping;'''
new = '''\t\tcase "none":
\t\tcase "notonemapping":
\t\tcase "0":
\t\t\treturn THREE.NoToneMapping;'''
if 'case "0":' not in t.split("function resolvePackOutputToneMapping")[1][:800]:
    if old not in t:
        raise SystemExit("case none block missing")
    t = t.replace(old, new, 1)
    tc.write_text(t, encoding="utf-8")
    print("added case 0")
else:
    print("case 0 already present")

# Show key snippets
pps = Path("three.js/editor/js/postprocessing/PostProcessStack.js").read_text(encoding="utf-8")
i = pps.find("useLdrBloom")
print("--- editor insert ---")
print(pps[i:i+450])
ct = Path("freefilmcut/apps/web/src/vfxpack/postprocess/composer.ts").read_text(encoding="utf-8")
i = ct.find("useLdrBloom")
print("--- clip insert ---")
print(ct[i:i+420])
tt = Path("freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts").read_text(encoding="utf-8")
i = tt.find("resolvePackOutputToneMapping(activePack")
print("--- call ---")
print(tt[i-120:i+80])
print("--- bumps ---")
for p in ["three.js/editor/index.html", "three.js/editor/js/Viewport.js"]:
    for line in Path(p).read_text(encoding="utf-8").splitlines():
        if "fcc-ui-163" in line or "PostProcessStack" in line and "fcc-ui" in line:
            print(p, line.strip()[:120])
