from pathlib import Path
checks = {
 "pack-video.ts": ["fcc-tl-flower-18", "Always drive sample time", "frameNames: explicitFrameNames", "markPackVideoFrameReady();\n\t\t\treturn bitmap"],
 "text-template-media.ts": ["fcc-tl-flower-18", "rtTargetUuid", "replace(/\\\\/g"],
 "timeline-flower-text.ts": ["rev: 18"],
 "scene-builder.ts": ["sigRev: 18"],
 "text-stickers.js": ["rtTargetUuid", "texturePackPath"],
 "apply-text-template.ts": ["out.frameNames = names"],
}
base = Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack")
for name, needles in checks.items():
  s = (base/name).read_text(encoding="utf-8")
  for n in needles:
    # needles with \\ need care
    ok = n in s
    print(name, repr(n)[:40], "OK" if ok else "MISSING")