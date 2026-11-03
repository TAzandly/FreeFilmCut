import pathlib,re
for path in [
 r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/pack-video.ts",
 r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-template-media.ts",
]:
  s = pathlib.Path(path).read_text(encoding="utf-8")
  # Broken: /\/g  (only one backslash before /) as regex for backslash
  # In file, correct JS is /\\/g  (two chars \ \ between / and /g)
  # Broken is /\/g (one \ between)
  for m in re.finditer(r'\.replace\(/(\\+)/g', s):
    bs = m.group(1)
    print(pathlib.Path(path).name, "backslashes", len(bs), "at", m.start(), repr(s[m.start():m.start()+30]))
  # Also check for syntax errors - unmatched
  print(pathlib.Path(path).name, "len", len(s), "flower-18", "fcc-tl-flower-18" in s)