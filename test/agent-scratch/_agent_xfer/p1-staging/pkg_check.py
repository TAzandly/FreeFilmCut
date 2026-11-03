from pathlib import Path
import json
pkg = json.loads(Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\package.json").read_text(encoding="utf-8"))
deps = {**pkg.get("dependencies",{}), **pkg.get("devDependencies",{})}
print("troika-three-text", deps.get("troika-three-text"))
print("troika-three-utils", deps.get("troika-three-utils"))
# try resolve via node
