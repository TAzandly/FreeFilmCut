from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\registry.ts")
t = p.read_text(encoding="utf-8")
# fix mojibake comment if any
import re
t2 = re.sub(
    r"Bloom strength.*?DeepGlow intensity.*?are no-ops",
    "Bloom strength~=0 / DeepGlow intensity~=0 are no-ops",
    t,
    count=1,
    flags=re.S,
)
# also fix compositor comment if needed
if t2 != t:
    p.write_text(t2, encoding="utf-8")
    print("registry comment fixed")
else:
    print("registry comment ok or pattern missed")
    # show the comment line
    for i, line in enumerate(t.splitlines(), 1):
        if "Bloom strength" in line or "no-ops" in line:
            print(i, repr(line))
