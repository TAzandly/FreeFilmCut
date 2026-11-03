from pathlib import Path
import re
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
# where ui.rect is assigned
hits = []
for p in (ROOT/"ui").rglob("*.js"):
    s = p.read_text(encoding="utf-8")
    if "ui.rect" in s or ".rect =" in s:
        for i, line in enumerate(s.splitlines(), 1):
            if re.search(r"\.rect\s*=", line) or "ui.rect" in line and ("=" in line):
                hits.append(f"{p.name}:{i}:{line.strip()[:140]}")
print("\n".join(hits[:40]))
print("--- collectWipe current ---")
rt = (ROOT/"ui/TextAnimRuntime.js").read_text(encoding="utf-8")
i = rt.find("export function collectWipeLayoutMetrics")
print(rt[i:i+1800])
