from pathlib import Path
import re

b = Path(r"D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js").read_text(encoding="utf-8")
# find each registerTextAnim id and scope
for m in re.finditer(r"id:\s*'([^']+)'", b):
    id_ = m.group(1)
    start = m.start()
    chunk = b[start:start+400]
    sm = re.search(r"scope:\s*'([^']+)'", chunk)
    scope = sm.group(1) if sm else "?"
    print(f"{id_}: scope={scope}")

print("==== ENGINE header/needsChar ====")
eng = Path(r"D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimEngine.js").read_text(encoding="utf-8")
lines = eng.splitlines()
for i, l in enumerate(lines[:30], 1):
    print(f"{i}:{l}")
print("---")
for i, l in enumerate(lines, 1):
    if "textAnimNeedsCharSplit" in l or "sampleTextPassOps" in l or "sampleTextAnim(" in l:
        for j in range(i-1, min(len(lines), i+25)):
            print(f"{j+1}:{lines[j]}")
        print("---")
