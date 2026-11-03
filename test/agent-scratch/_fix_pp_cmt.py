from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
t = p.read_text(encoding="utf-8")

old = """\t\t\t// PP result is display-encoded; keep sRGB tag for MeshBasic present.
\t\t\tppRT.texture.colorSpace = THREE.SRGBColorSpace;
"""
new = """\t\t\t// Pack OutputPass: none => working-space bytes (no sRGB transfer); Neutral/ACES
\t\t\t// => display-encoded. Tag sRGB for MeshBasic present round-trip either way
\t\t\t// (identity for working bytes, correct round-trip for display bytes).
\t\t\tppRT.texture.colorSpace = THREE.SRGBColorSpace;
"""
if old not in t:
    raise SystemExit("ppRT comment not found")
t = t.replace(old, new)

old2 = """\t\t\t// OutputPass already wrote display-encoded (sRGB transfer) texels into the
\t\t\t// composer RT (often HalfFloat + Linear/NoColorSpace tag). Mark as sRGB so
\t\t\t// downstream MeshBasic present does a correct round-trip; raw ShaderMaterial
\t\t\t// blit still copies bytes without an extra encode (toneMapped:false).
"""
new2 = """\t\t\t// OutputPass wrote final pack bytes (none: working-space / no sRGB transfer;
\t\t\t// Neutral/ACES: display-encoded). Mark sRGB so MeshBasic present round-trips;
\t\t\t// raw ShaderMaterial blit copies bytes without an extra encode.
"""
if old2 not in t:
    raise SystemExit("readBuf comment not found")
t = t.replace(old2, new2)
p.write_text(t, encoding="utf-8")
print("comments updated")
