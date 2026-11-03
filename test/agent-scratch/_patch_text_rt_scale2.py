from pathlib import Path

p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
lines = p.read_text(encoding="utf-8").splitlines(True)

def find_line(pred, start=0):
    for i in range(start, len(lines)):
        if pred(lines[i]):
            return i
    return -1

# 1) Replace flowerTextSupersample function
i0 = find_line(lambda l: "private flowerTextSupersample" in l)
if i0 < 0:
    raise SystemExit("no supersample fn")
# include preceding JSDoc starting at /** Authored
jdoc = i0
while jdoc > 0 and not lines[jdoc - 1].lstrip().startswith("/**"):
    jdoc -= 1
# find closing brace of function
i1 = i0
while i1 < len(lines) and lines[i1].strip() != "}":
    i1 += 1
if i1 >= len(lines):
    raise SystemExit("no close")
# include trailing blank after }
end = i1 + 1
if end < len(lines) and lines[end].strip() == "":
    end += 1

new_fn = (
    "\t/**\n"
    "\t * Preview quality scale for text RT: compose buffer / authored canvas.\n"
    "\t * Layout + fontSize stay in authored pixels; RT undersamples into fewer pixels.\n"
    "\t * Export / Full Quality => 1.\n"
    "\t */\n"
    "\tprivate flowerTextPreviewScale(authoredW: number, composeW: number): number {\n"
    "\t\tconst a = Math.max(1, authoredW);\n"
    "\t\tconst c = Math.max(1, composeW);\n"
    "\t\tconst s = c / a;\n"
    "\t\tif (!Number.isFinite(s) || s <= 0) return 1;\n"
    "\t\treturn Math.min(1, s);\n"
    "\t}\n"
    "\n"
)
lines[jdoc:end] = [new_fn]

# 2) Replace rtW/rtH block in renderOneFlowerText
i = find_line(lambda l: "const resW = Math.max(1, Math.round(props.canvasWidth))" in l)
if i < 0:
    raise SystemExit("no resW")
# back up to comment line
start = i
while start > 0 and not lines[start].lstrip().startswith("//"):
    start -= 1
# find rtH line
end = find_line(lambda l: "const rtH = Math.max(1, Math.round(resH * ss))" in l, i)
if end < 0:
    raise SystemExit("no rtH")
end += 1

new_rt = (
    "\t\t// Authored project pixels — FlowerStyle / fontSize stay here (not scaled by preview quality).\n"
    "\t\tconst resW = Math.max(1, Math.round(props.canvasWidth));\n"
    "\t\tconst resH = Math.max(1, Math.round(props.canvasHeight));\n"
    "\t\t// Compose buffer is already quality-scaled (CanvasRenderer contentScale). Undersample\n"
    "\t\t// the text RT to that size so preview quality actually saves fill-rate / PP cost.\n"
    "\t\tconst previewScale = this.flowerTextPreviewScale(resW, width);\n"
    "\t\tconst rtW = Math.max(1, Math.round(resW * previewScale));\n"
    "\t\tconst rtH = Math.max(1, Math.round(resH * previewScale));\n"
)
lines[start:end] = [new_rt]

# 3) PP composer size -> rtW/rtH
text = "".join(lines)
old_pp = """\t\t\t\t\tresolution: { width: resW, height: resH },
\t\t\t\t\t\tcamera: ortho,
\t\t\t\t\t},
\t\t\t\t\twidth: Math.max(1, resW),
\t\t\t\t\theight: Math.max(1, resH),
\t\t\t\t\ttarget: ppRT,
"""
new_pp = """\t\t\t\t\tresolution: { width: rtW, height: rtH },
\t\t\t\t\t\tcamera: ortho,
\t\t\t\t\t},
\t\t\t\t\twidth: Math.max(1, rtW),
\t\t\t\t\theight: Math.max(1, rtH),
\t\t\t\t\ttarget: ppRT,
"""
# only replace the textanim-pp occurrence - find unique context
ctx = 'packId + ":textanim-pp"'
pos = text.find(ctx)
if pos < 0:
    raise SystemExit("no textanim-pp")
chunk = text[pos : pos + 600]
if "width: Math.max(1, resW)" not in chunk:
    print(repr(chunk))
    raise SystemExit("pp sizes not as expected near textanim-pp")
# replace within that neighborhood only
before = text[:pos]
after = text[pos:]
after2 = after.replace(
    "resolution: { width: resW, height: resH }",
    "resolution: { width: rtW, height: rtH }",
    1,
)
after2 = after2.replace(
    "width: Math.max(1, resW),\n\t\t\t\t\theight: Math.max(1, resH),\n\t\t\t\t\ttarget: ppRT,",
    "width: Math.max(1, rtW),\n\t\t\t\t\theight: Math.max(1, rtH),\n\t\t\t\t\ttarget: ppRT,",
    1,
)
text = before + after2

with open(p, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)

assert "flowerTextPreviewScale" in text
assert "flowerTextSupersample" not in text
assert "previewScale" in text
assert '":textanim-pp"' in text
# verify pp uses rt
idx = text.find('":textanim-pp"')
print(text[idx : idx + 450])
print("OK")
