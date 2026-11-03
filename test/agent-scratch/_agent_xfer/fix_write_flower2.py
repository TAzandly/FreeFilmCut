from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
t = p.read_text(encoding="utf-8")

old = (
    "else ui.color = fillC.solid.color;\n"
    "\t\tif ( object.userData ) delete object.userData.__fccTextSig;\n"
    "\t\tconst next = { ...object.userData, fccUI: ui };\n"
    "\t\tdelete next.__fccTextSig;\n"
    "\t\t// Skip panel rebuild during objectChanged from this command so color pickers stay open.\n"
)

new = (
    "else ui.color = fillC.solid.color;\n"
    "\t\tif ( object.userData ) stripEphemeralUserDataKeys( object.userData );\n"
    "\t\tconst next = { ...object.userData, fccUI: ui };\n"
    "\t\tstripEphemeralUserDataKeys( next );\n"
    "\t\t// Skip panel rebuild during objectChanged from this command so color pickers stay open.\n"
)

count = t.count(old)
print("matches", count)
if count != 1:
    raise SystemExit("expected 1 match for writeFlower body")
t = t.replace(old, new, 1)

helper = (
    "\tfunction stripEphemeralUserDataKeys( ud ) {\n"
    "\n"
    "\t\t// Face-mask WebGLRenderTarget must never ride SetValueCommand clones (fcc-ui-68).\n"
    "\t\tif ( ! ud ) return;\n"
    "\t\tdelete ud.__fccTextSig;\n"
    "\t\tdelete ud.__fccFaceMaskRT;\n"
    "\t\tdelete ud.__fccFaceMaskFrameId;\n"
    "\n"
    "\t}\n"
    "\n"
    "\tfunction writeFlowerStyle"
)

if "function stripEphemeralUserDataKeys" not in t:
    if t.count("\tfunction writeFlowerStyle") != 1:
        raise SystemExit("writeFlowerStyle count unexpected")
    t = t.replace("\tfunction writeFlowerStyle", helper, 1)

p.write_text(t, encoding="utf-8")
print("patched")
i = t.find("function stripEphemeralUserDataKeys")
print(t[i:i+550])