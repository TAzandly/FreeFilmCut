import pathlib
p = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-template-media.ts")
s = p.read_text(encoding="utf-8")
# Fix broken replace(/\/g, "/") -> replace(/\\/g, "/")
bad = 'replace(/\\/g, "/")'  # what's currently wrong visually: replace(/\/g
# Actual broken text in file:
broken = "replace(/\\/g, \"/\")"
# Wait - file contains: replace(/\/g, "/")  which is chars: / \ / g
# Let's find exact
idx = s.find("pathRaw.replace")
print(repr(s[idx:idx+80]))
idx2 = s.find("packPathRaw.replace")
print(repr(s[idx2:idx2+80]))