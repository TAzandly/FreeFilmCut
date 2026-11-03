# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")

# Verify key markers
pps = (ROOT / "three.js/editor/js/postprocessing/PostProcessStack.js").read_text(encoding="utf-8")
assert "class LdrPreBloomClampPass" in pps
assert "useLdrBloom" in pps
assert "new LdrPreBloomClampPass()" in pps
print("PostProcessStack OK")

ct = (ROOT / "freefilmcut/apps/web/src/vfxpack/postprocess/composer.ts").read_text(encoding="utf-8")
assert "class LdrPreBloomClampPass" in ct
assert "new LdrPreBloomClampPass()" in ct
assert "useLdrBloom" in ct
print("composer.ts OK")

tt = (ROOT / "freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts").read_text(encoding="utf-8")
assert "resolveTextAnimPackOutputToneMapping" not in tt
assert "resolvePackOutputToneMapping(activePack?.payload)" in tt
assert "if (raw === 0) return THREE.NoToneMapping" in tt
print("three-compositor OK")

# --- bump cache ---
replacements = [
    (ROOT / "three.js/editor/js/Viewport.js",
     "PostProcessStack.js?v=fcc-ui-160", "PostProcessStack.js?v=fcc-ui-163"),
    (ROOT / "three.js/editor/js/ui/TextLayerRT.js",
     "PostProcessStack.js?v=fcc-ui-160", "PostProcessStack.js?v=fcc-ui-163"),
    (ROOT / "three.js/editor/js/preview/PreviewCapture.js",
     "PostProcessStack.js?v=fcc-ui-160", "PostProcessStack.js?v=fcc-ui-163"),
    (ROOT / "three.js/editor/index.html",
     "Viewport.js?v=fcc-ui-160", "Viewport.js?v=fcc-ui-163"),
]
for path, a, b in replacements:
    t = path.read_text(encoding="utf-8")
    if a not in t:
        # already bumped?
        if b in t:
            print("already", path.name, b)
            continue
        raise SystemExit(f"bump miss {path}: {a}")
    path.write_text(t.replace(a, b), encoding="utf-8")
    print("bumped", path.name)

# --- docs ---
export_doc = ROOT / "docs/textanim-pack-export.md"
ed = export_doc.read_text(encoding="utf-8")
old_contract = None
# Replace the Output toneMapping contract section
start = ed.find("## Output toneMapping contract")
end = ed.find("\n## ", start + 5)
if start < 0 or end < 0:
    raise SystemExit("export doc section missing")
new_section = """## Output toneMapping contract (editor <-> clip)

- **Bloom does not require tone mapping.** UnrealBloom samples linear beauty;
  tonemap (Neutral/ACES/…) only rolls off HDR peaks at OutputPass. If beauty
  peaks are already ≤1, **none + Bloom is a valid authoring mode** (OutputPass
  only does sRGB encode).
- **Exporter** writes live Config / Viewport `toneMapping` into `pack.output`
  (`TextAnimPackExporter.collectAuthoringOutput`). Authors may tune Bloom under
  **`none`**.
- **Both editor and clip**: when OutputPass toneMapping is `NoToneMapping`
  (`none`), insert **LDR pre-bloom clamp** (RGB → [0,1]) immediately before
  bloom/deepGlow so wipe `edgeIntensity` spikes cannot explode the halo.
  Neutral/ACES packs **skip** the clamp and keep HDR bloom.
- **Clip text-anim PP** uses `resolvePackOutputToneMapping` — pack `none` stays
  `NoToneMapping`. **No** silent none→Neutral remap.
- **Bloom RT size** = authored project / safe-frame resolution (`resW×resH`), not
  the preview undersampled compose buffer (texel-relative kernels).
- **Do not** double-apply `straightAlphaFromPremul` on the text-anim PP→layer blit
  when transparentClear already converted composer→ppRT.

"""
ed2 = ed[:start] + new_section + ed[end+1:]  # end points at \n## so skip one \n
# Actually end = ed.find("\n## ", ...) includes leading newline of next section
# Keep the next ## heading: ed[end:] starts with \n## 
ed2 = ed[:start] + new_section.rstrip() + "\n" + ed[end:]
export_doc.write_text(ed2, encoding="utf-8")
print("updated textanim-pack-export.md")

ppdoc = ROOT / "docs/postprocess-stack.md"
pd = ppdoc.read_text(encoding="utf-8")
# Replace text-anim contract paragraph
pd2 = re.sub(
    r"\*\*Text-anim / pack contract\*\*:.*?(?=\n\n|\nUnrealBloom)",
    "**Text-anim / pack contract**: Exporter writes live Config toneMapping. "
    "Pack `none` stays NoToneMapping on clip (no Neutral remap). When OutputPass "
    "is none, both editor PostProcessStack and OpenCut composer insert "
    "**LdrPreBloomClampPass** before bloom/deepGlow (LDR bloom). Neutral/ACES keep HDR bloom. "
    "Text-anim Bloom RT = authored project resolution (not preview undersample).",
    pd,
    count=1,
    flags=re.S,
)
# Update the long UnrealBloom sentence about none→Neutral
pd2 = pd2.replace(
    "文字动画包除外：clip 用 `resolveTextAnimPackOutputToneMapping` 把 none→Neutral，直到 present clamp 路径完全对齐））",
    "若为 none，则在 bloom 前做 LDR clamp，OutputPass 仅 sRGB；不做 none→Neutral 静默回退））",
)
# Also try garbled / alternate encodings - check if resolveTextAnim still mentioned
if "resolveTextAnimPackOutputToneMapping" in pd2:
    # broader replace of any sentence mentioning it
    pd2 = re.sub(
        r"文字动画包除外：[^\n]*resolveTextAnimPackOutputToneMapping[^\n]*",
        "若为 none，则在 bloom 前做 LDR clamp，OutputPass 仅 sRGB；不做 none→Neutral 静默回退））",
        pd2,
    )
if "resolveTextAnimPackOutputToneMapping" in pd2:
    # English fallback replace around the marker
    pd2 = pd2.replace(
        "`resolveTextAnimPackOutputToneMapping` 把 none→Neutral，直到 present clamp 路径完全对齐））",
        "none 时 bloom 前 LDR clamp；不做 none→Neutral 回退））",
    )
# Last resort: delete the parenthetical about text-anim exception
if "resolveTextAnimPackOutputToneMapping" in pd2:
    idx = pd2.find("resolveTextAnimPackOutputToneMapping")
    print("WARN still in postprocess-stack near:", repr(pd2[max(0,idx-80):idx+120]))
else:
    print("postprocess-stack: remap refs cleared")

# Add LDR note after Bloom / tone mapping header if not present
if "LdrPreBloomClampPass" not in pd2:
    needle = "### Bloom 与 tone mapping"
    # may be garbled - search English
    if "LdrPreBloomClampPass" not in pd2 and "**Text-anim / pack contract**" in pd2:
        pass  # already in contract paragraph
pd2 = pd2.replace(
    "| postprocessing/PostProcessStack.js | Composer 构建（含 HDR + Output tone map） |",
    "| postprocessing/PostProcessStack.js | Composer 构建（HDR/LDR + Output tone map；none 时 LdrPreBloomClampPass） |",
)
ppdoc.write_text(pd2, encoding="utf-8")
print("updated postprocess-stack.md")

prog = ROOT / "docs/textanim-progress-2026-10.md"
pr = prog.read_text(encoding="utf-8")
# Append new section 11
if "LDR pre-bloom clamp" not in pr and "11. none + Bloom LDR" not in pr:
    pr = pr.rstrip() + """


## 11. none + Bloom LDR path (2026-10-23)

- **Answer**: Bloom does **not** require tonemap. Tonemap only rolls off HDR at OutputPass.
  If beauty is clamped to LDR before UnrealBloom, **none + Bloom** is valid and matches
  authoring under Config none.
- **Code**: `LdrPreBloomClampPass` in editor `PostProcessStack.js` and OpenCut
  `vfxpack/postprocess/composer.ts` — inserted before first bloom/deepGlow iff
  OutputPass toneMapping is `NoToneMapping`. Neutral/ACES unchanged (HDR bloom).
- **Removed**: clip `resolveTextAnimPackOutputToneMapping` none→Neutral remap.
  Text-anim PP now uses `resolvePackOutputToneMapping` (none stays none).
- **Verify**: hard-refresh editor (`?v=fcc-ui-163`) + OpenCut → scrub sweep mid wipe
  under none; halo should match editor without Neutral remap. Re-export not required.
"""
    prog.write_text(pr, encoding="utf-8")
    print("appended progress §11")
else:
    print("progress already has LDR note")

print("ALL DOC/BUMP DONE")
