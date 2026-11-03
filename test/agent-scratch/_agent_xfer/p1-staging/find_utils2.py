from pathlib import Path
bun = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\node_modules\.bun")
# find the utils package path
cands = list(bun.glob("troika-three-utils@*/node_modules/troika-three-utils/package.json"))
print(cands)
if cands:
    print(cands[0].read_text(encoding="utf-8")[:400])
# check if apps/web can resolve - look at node_modules symlink
nm = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\node_modules\troika-three-text\node_modules")
print("nested nm", nm.exists(), list(nm.iterdir())[:10] if nm.exists() else None)
