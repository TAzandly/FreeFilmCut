from pathlib import Path
import os

p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts")
t = p.read_text(encoding="utf-8")
old = "\tif (animClips.length > 0) {\n\t}\n\n"
if old in t:
    t = t.replace(old, "", 1)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(t)
    print("removed empty if")
else:
    i = t.find("animClips.length")
    print("empty if miss", repr(t[i:i+60]))

p2 = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\freecapcut-anim.ts")
t2 = p2.read_text(encoding="utf-8")
t2 = t2.replace("\tlet samplePosY: number | null = null;\n", "")
line = "\t\t\t\t\tif (track.path === " + '"position.y"' + ") samplePosY = v;\n"
t2 = t2.replace(line, "")
with open(p2, "w", encoding="utf-8", newline="\n") as f:
    f.write(t2)
print("cleaned samplePosY", "samplePosY" in t2)

root = r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src"
needles = ["pack anims loaded", "[FreeFilmCut anim] clipLocalTime", "snapshot before bind"]
for dp, _, fs in os.walk(root):
    for fn in fs:
        if not fn.endswith((".ts", ".tsx", ".js")):
            continue
        fp = os.path.join(dp, fn)
        body = open(fp, encoding="utf-8").read()
        for needle in needles:
            if needle in body:
                print("still", needle, "in", fp)
print("scan done")
