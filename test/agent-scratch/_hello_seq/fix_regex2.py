import pathlib
p = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-template-media.ts")
s = p.read_text(encoding="utf-8")
# Fix: replace(/\/g, "/") -> replace(/\\/g, "/")
# File currently has the 5-char regex /\/g instead of /\\/g
old = 'replace(/\\/g, "/")'  # python: this is replace(/\/g, "/") in file? 
# In a normal Python string 'replace(/\\/g, "/")' is: replace(/\/g, "/")  YES one backslash before /
# We want file to contain: replace(/\\/g, "/") i.e. two backslashes in source
new = 'replace(/\\\\/g, "/")'  # python writes replace(/\\/g, "/") to file

count = s.count('replace(/\\/g, "/")')
print("broken count", count)
s2 = s.replace('replace(/\\/g, "/")', 'replace(/\\\\/g, "/")')
print("after count broken", s2.count('replace(/\\/g, "/")'))
print("after count good", s2.count('replace(/\\\\/g, "/")'))
# verify a snippet
i = s2.find("pathRaw.replace")
print(repr(s2[i:i+60]))
p.write_text(s2, encoding="utf-8")
print("fixed")