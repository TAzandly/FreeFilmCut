import pathlib,re
p = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-template-media.ts")
s = p.read_text(encoding="utf-8")
for m in re.finditer(r'replace\(/\\+/g', s):
    print(repr(s[m.start():m.start()+25]), "at", m.start())
# also check pack-video for similar corruption
p2 = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/pack-video.ts")
s2 = p2.read_text(encoding="utf-8")
for m in re.finditer(r'replace\(/\\+/g', s2):
    print("pv", repr(s2[m.start():m.start()+25]), "at", m.start())
# Verify key flower-18 markers exist
for needle in ["fcc-tl-flower-18", "markPackVideoFrameReady", "await ensurePackSeqFrame", "packMediaKind", "tex.needsUpdate = true", "rtTargetUuid"]:
    print(needle, s.count(needle) if needle=="rtTargetUuid" else (needle in s or needle in s2), "ttm" if needle in s else "", "pv" if needle in s2 else "")
print("ttm flower18", "fcc-tl-flower-18" in s)
print("pv flower18", "fcc-tl-flower-18" in s2)
print("pv await ensure", "await ensurePackSeqFrame" in s2)
print("pv packMediaKind", "packMediaKind" in s2)
print("pv needsUpdate", s2.count("needsUpdate"))
print("pv markReady", s2.count("markPackVideoFrameReady"))