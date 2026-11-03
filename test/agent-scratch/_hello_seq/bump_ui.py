from pathlib import Path
p = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-stickers.js")
s = p.read_text(encoding="utf-8")
s2 = s.replace(
 "Clip port of editor TextStickers.js (fcc-ui-195).",
 "Clip port of editor TextStickers.js (fcc-ui-196 / fcc-tl-flower-18).",
 1,
)
if s2 == s:
    raise SystemExit("header not updated")
p.write_text(s2, encoding="utf-8")
print("text-stickers header bumped")

# three-compositor comment
tc = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts")
t = tc.read_text(encoding="utf-8")
t2 = t.replace(
 "Then stickers sample park-aware glyph AABB (fcc-tl-flower-17 / fcc-ui-195).",
 "Then stickers sample park-aware glyph AABB (fcc-tl-flower-18 / fcc-ui-196).",
 1,
)
if t2 == t:
    print("compositor comment already updated or missing")
else:
    tc.write_text(t2, encoding="utf-8")
    print("compositor comment bumped")