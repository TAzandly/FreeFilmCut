from pathlib import Path
import re

# export md
p = Path(r"D:\GrokbotWork\FreeFilmCut\docs\textanim-pack-export.md")
t = p.read_text(encoding="utf-8")
pat = re.compile(r"## Output toneMapping contract \(editor <-> clip\)\n\n.*?(?=## Editor export)", re.S)
m = pat.search(t)
if not m:
    raise SystemExit("export section missing")
new = """## Output toneMapping contract (editor <-> clip)

- **Exporter** writes live Config / Viewport `toneMapping` into `pack.output`
  (`TextAnimPackExporter.collectAuthoringOutput`). Authors often tune Bloom under
  **`none`** in the editor.
- **Clip text-anim PP** uses `resolveTextAnimPackOutputToneMapping`: pack `none`/`0`
  maps to **NeutralToneMapping**. Reason: editor Viewport `presentComposerToLetterbox`
  clamps composer rgb to `[0,1]` after OutputPass (softens HDR bloom under none);
  clip `renderPackWithPostProcess` also clamps once when `transparentClear` (composer→RT),
  but OutputPass under raw NoToneMapping still leaves a different highlight roll-off
  than Neutral — user-preferred clip look was the Neutral remap. Keep this
  text-anim-only remap until scrub proves clip `none` ≡ editor `none`. Other packs
  still use `resolvePackOutputToneMapping` (none stays none).
- **Do not** double-apply `straightAlphaFromPremul` on the text-anim PP→layer blit
  when transparentClear already converted composer→ppRT.
- **Bloom RT size** = authored project / safe-frame resolution (`resW×resH`), not the
  preview undersampled compose buffer. UnrealBloom kernels are texel-relative; a
  smaller FBO makes the halo look larger even when strength/radius numbers match.

"""
t = t[:m.start()] + new + t[m.end():]
p.write_text(t, encoding="utf-8")
print("export ok")

p2 = Path(r"D:\GrokbotWork\FreeFilmCut\docs\textanim-progress-2026-10.md")
t2 = p2.read_text(encoding="utf-8")
pat2 = re.compile(r"## 10\. toneMapping / Bloom parity \(2026-10-23\)\n\n.*?(?=\n## |\Z)", re.S)
m2 = pat2.search(t2)
if not m2:
    raise SystemExit("progress section missing")
new2 = """## 10. toneMapping / Bloom parity (2026-10-23)

- **Restored (user feedback)**: clip text-anim PP again uses
  `resolveTextAnimPackOutputToneMapping` — pack `none`/`0` → **Neutral**. Honoring
  raw `none` on clip made bloom look wrong again; Neutral-for-none was the preferred look.
- **Investigation — why editor none can look OK while clip none blows**:
  1. Editor `Viewport.presentComposerToLetterbox` `_blitMat` clamps `rgb` to `[0,1]`
     and builds straight alpha (`a = max(a, max(rgb))`) after OutputPass.
  2. Clip `renderPackWithPostProcess` already does the same clamp once when
     `transparentClear` (composer→ppRT). A second PP→layer `straightAlphaFromPremul`
     would double-divide and was **not** applied.
  3. Remaining gap under OutputPass `NoToneMapping`: hard clamp of HDR bloom peaks
     ≠ Neutral highlight compression. Editor none+clamp can still look “fine” to the
     author; clip none (even with one clamp) did not match the Neutral look they liked
     after the earlier remap. Config is actually none when authoring; this is not a
     “editor secretly Neutral” issue.
- **Kept**: Bloom composer FBO = authored `resW/resH`.
- **Not dropped yet**: Neutral remap for text-anim PP (document as temporary until a
  scrub proves clip none ≡ editor none end-to-end).
- **Verify**: hard-refresh OpenCut → scrub sweep mid wipe; halo should match the
  earlier Neutral-for-none clip look. No editor `?v=` bump (editor files unchanged).

"""
t2 = t2[:m2.start()] + new2 + t2[m2.end():]
p2.write_text(t2, encoding="utf-8")
print("progress ok")
