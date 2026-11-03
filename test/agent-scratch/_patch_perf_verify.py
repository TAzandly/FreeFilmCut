# -*- coding: utf-8 -*-
from pathlib import Path
et = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\components\editable-timecode.tsx")
t = et.read_text(encoding="utf-8")
# Check current state of inputValue init
idx = t.find("const [inputValue, setInputValue]")
print(t[idx:idx+200])
# Fix if needed
old = 'const [inputValue, setInputValue] = useState("");'
# After our edits, formattedTime comes after - so we can't use it in useState easily.
# Seed in the startInEditMode useEffect is fine; also set initial:
if 'useState(() =>' not in t[idx:idx+80]:
    # leave useEffect seed
    print("inputValue still empty init; useEffect seeds it")
else:
    print("already lazy")

# Verify compositor imports and rt cache block
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
c = comp.read_text(encoding="utf-8")
assert "bloomPadPxFromPackTracks" in c
assert "measureOverlayTextInkAabb" in c
assert "rtCache" in c
assert "Do NOT layout+measure every frame" in c
print("compositor assertions ok")

aabb = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\text-layer-aabb.ts")
a = aabb.read_text(encoding="utf-8")
assert "bloomPadPxFromPackTracks" in a
assert "padOverridePx" in a
print("aabb assertions ok")

tb = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\preview\components\toolbar.tsx")
tt = tb.read_text(encoding="utf-8")
assert "liveRef" in tt
assert "writeLive" in tt
assert "startInEditMode" in tt
print("toolbar assertions ok")
