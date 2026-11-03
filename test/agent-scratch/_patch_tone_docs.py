from pathlib import Path

# --- textanim-pack-export.md ---
p = Path(r"D:\GrokbotWork\FreeFilmCut\docs\textanim-pack-export.md")
t = p.read_text(encoding="utf-8")
old = """## Output toneMapping contract (editor <-> clip)

- **`pack.output.toneMapping` / `toneMappingExposure` is the single source of truth.**
  Editor `TextAnimPackExporter.collectAuthoringOutput` writes the live Config /
  Viewport setting; OpenCut applies the same value via `resolvePackOutputToneMapping`
  (no text-anim special case).
- **`none` (NoToneMapping) is valid** — many text-anim authors tune Bloom under none;
  OutputPass still does the sRGB encode, only the tone-curve is skipped. Do **not**
  silently remap `none`/`0` -> Neutral on either side.
- **Bloom RT size** = authored project / safe-frame resolution (`resWxresH`), not the
  preview undersampled compose buffer. UnrealBloom kernels are texel-relative; a
  smaller FBO makes the halo look larger even when strength/radius numbers match."""

# Try flexible dash characters
import re
pat = re.compile(
    r"## Output toneMapping contract \(editor <-> clip\)\n\n"
    r".*?"
    r"(?=## Editor export)",
    re.S,
)
m = pat.search(t)
if not m:
    raise SystemExit("export.md section not found")
new = """## Output toneMapping contract (editor <-> clip)

- **Exporter** writes live Config / Viewport `toneMapping` into `pack.output`
  (`TextAnimPackExporter.collectAuthoringOutput`). Authors often tune Bloom under
  **`none`** in the editor.
- **Clip text-anim PP** uses `resolveTextAnimPackOutputToneMapping`: pack `none`/`0`
  maps to **NeutralToneMapping**. Reason: editor Viewport `presentComposerToLetterbox`
  clamps composer rgb to `[0,1]` after OutputPass, which softens HDR bloom under none;
  clip historically alpha-blitted the PP result without that clamp and bloom blew out.
  Until none present paths fully match, keep this text-anim-only remap (user-preferred
  clip look). Other packs still use `resolvePackOutputToneMapping` (none stays none).
- **Clip also** runs the text-anim PP→layer blit with `straightAlphaFromPremul: true`
  (same clamp + straight-alpha as editor present) so a future none path can converge.
- **Bloom RT size** = authored project / safe-frame resolution (`resW×resH`), not the
  preview undersampled compose buffer. UnrealBloom kernels are texel-relative; a
  smaller FBO makes the halo look larger even when strength/radius numbers match.

"""
t = t[:m.start()] + new + t[m.end():]
p.write_text(t, encoding="utf-8")
print("textanim-pack-export.md OK")

# --- textanim-progress ---
p2 = Path(r"D:\GrokbotWork\FreeFilmCut\docs\textanim-progress-2026-10.md")
t2 = p2.read_text(encoding="utf-8")
pat2 = re.compile(
    r"## 10\. toneMapping / Bloom parity \(2026-10-23\)\n\n"
    r".*?"
    r"(?=\n## |\Z)",
    re.S,
)
m2 = pat2.search(t2)
if not m2:
    # try without exact heading
    idx = t2.find("toneMapping / Bloom parity")
    print("progress idx", idx)
    print(repr(t2[idx:idx+400]) if idx>=0 else "missing")
    raise SystemExit("progress section not found")
new2 = """## 10. toneMapping / Bloom parity (2026-10-23)

- **Restored (user feedback)**: clip text-anim PP again uses
  `resolveTextAnimPackOutputToneMapping` — pack `none`/`0` → **Neutral**. That was
  the look the user said matched; honoring raw `none` on clip blew bloom back out.
- **Root cause (investigation)**: Editor `Viewport.presentComposerToLetterbox`
  `_blitMat` does `clamp(rgb,0,1)` + straight-alpha after OutputPass. Clip text-anim
  PP→layer blit previously used `straightAlphaFromPremul: false` (passthrough), so
  HDR bloom >1 survived into HalfFloat + alpha compose and looked much larger/hotter
  under NoToneMapping OutputPass. Config none in the editor can still “look OK”
  because of that present clamp — not because none and Neutral are equivalent.
- **Parity fix landed**: text-anim PP blit now uses `straightAlphaFromPremul: true`
  (editor clamp path). Remap kept until scrub confirms none+clamp ≡ editor none;
  Neutral remap remains the safe default for text-anim PP.
- **Bloom size**: composer FBO stays authored `resW/resH` (not undone).
- **Verify**: hard-refresh OpenCut → scrub sweep mid wipe; halo should again match
  the earlier Neutral-for-none clip look.

"""
t2 = t2[:m2.start()] + new2 + t2[m2.end():]
p2.write_text(t2, encoding="utf-8")
print("textanim-progress OK")

# --- postprocess-stack.md ---
p3 = Path(r"D:\GrokbotWork\FreeFilmCut\docs\postprocess-stack.md")
t3 = p3.read_text(encoding="utf-8")
old3 = "**Text-anim / pack contract**: `pack.output.toneMapping` is truth on editor and OpenCut. No silent `none`->Neutral remap. Text-anim Bloom RT = authored project resolution (not preview undersample)."
# flexible
pat3 = re.compile(r"\*\*Text-anim / pack contract\*\*[^\n]*")
m3 = pat3.search(t3)
if not m3:
    raise SystemExit("postprocess-stack contract line not found")
new3 = "**Text-anim / pack contract**: Exporter writes live Config toneMapping. Clip text-anim PP maps pack `none`/`0` → Neutral via `resolveTextAnimPackOutputToneMapping` (editor present clamps rgb; clip historically did not). Text-anim Bloom RT = authored project resolution (not preview undersample)."
t3 = t3[:m3.start()] + new3 + t3[m3.end():]
# Also update the NoToneMapping stays NoToneMapping sentence if it claims no Neutral fallback for text-anim
t3 = t3.replace(
    "若为 NoToneMapping 则保持 NoToneMapping（仍做 sRGB encode，不做曲线压缩；不以 ACES/Neutral 静默回退））",
    "若为 NoToneMapping 则保持 NoToneMapping（仍做 sRGB encode；文字动画包除外：clip 侧 `resolveTextAnimPackOutputToneMapping` 将 none→Neutral，直到 present clamp 路径完全对齐））",
)
# Maybe encoding differs - check
if "resolveTextAnimPackOutputToneMapping" not in t3:
    # try another replace on English-ish or shorter fragment
    t3_alt = t3
    frag = "不以 ACES/Neutral 静默回退"
    if frag in t3_alt:
        t3 = t3_alt.replace(
            frag,
            "文字动画包 clip 侧 none→Neutral（`resolveTextAnimPackOutputToneMapping`），其它包不回退",
        )
        print("postprocess-stack fallback sentence patched")
    else:
        print("postprocess-stack long sentence not patched (encoding); contract line ok")
else:
    print("postprocess-stack long sentence may already mention remap")
p3.write_text(t3, encoding="utf-8")
print("postprocess-stack OK")
