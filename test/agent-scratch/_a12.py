from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# Broad search for video blit clear alpha and editor VideoPlayer RT
roots = [
    Path(r"freefilmcut"),
    Path(r"D:\GrokbotWork\FreeFilmCut"),
]
seen=set()
for root in roots:
    if not root.exists(): continue
    for f in root.rglob("*"):
        if f in seen: continue
        seen.add(f)
        if not f.is_file() or f.suffix not in {".ts",".tsx",".js"}: continue
        if "node_modules" in f.parts or ".git" in f.parts: continue
        try:
            txt = f.read_text(encoding="utf-8")
        except Exception:
            continue
        if "fccHasAlpha" in txt or ("blitMat" in txt and "Video" in txt) or "syncPackVideos" in txt:
            if "fccHasAlpha" in txt or "setClearColor(0x000000, 1)" in txt and "blit" in txt.lower():
                rel = str(f)
                if "pack-video" in rel or "VideoPlayer" in rel or "renderTexture" in rel.lower() or "media-player" in rel.lower():
                    for i,l in enumerate(txt.splitlines(),1):
                        if "setClearColor(0x000000" in l or "fccHasAlpha" in l:
                            print(f"{rel}:{i}: {l.strip()}")

print("\n==== editor seekVideoPlayer / sample video ====")
for f in Path(r"freefilmcut/apps/web/src").rglob("*"):
    if not f.is_file() or f.suffix not in {".ts",".tsx",".js"}: continue
    try: txt = f.read_text(encoding="utf-8")
    except: continue
    if "seekVideoPlayer" in txt or "function sampleVideo" in txt:
        print(f"HIT {f}")