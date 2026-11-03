# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# Deprecate collectWipeLayoutMetrics header
rt = (ROOT / "ui/TextAnimRuntime.js").read_text(encoding="utf-8")
if "@deprecated" not in rt[rt.find("collectWipeLayoutMetrics")-200:rt.find("collectWipeLayoutMetrics")+80]:
    rt = rt.replace(
        "export function collectWipeLayoutMetrics( object, opts = {} ) {",
        "/** @deprecated Primary wipe bounds use TextLayerRT.computeWipeAlphaBounds. */\n"
        "export function collectWipeLayoutMetrics( object, opts = {} ) {",
    )
    (ROOT / "ui/TextAnimRuntime.js").write_text(rt, encoding="utf-8")
    print("deprecated collectWipeLayoutMetrics")

# TEXTANIM.md rewrite wipe section briefly
md_path = ROOT / "ui/TEXTANIM.md"
md = md_path.read_text(encoding="utf-8")
# Replace wipe formula section if present
if "alpha-AABB" not in md and "rt-alpha" not in md:
    # prepend/replace key paragraph
    if "## wipeReveal" in md:
        pass
    md = md.replace(
        "## wipeReveal 公式（layout axis）",
        "## wipeReveal 公式（RT alpha AABB）",
    )
# Force a clear paragraph
block = """## wipeReveal（重构）
- **Bounds**：`renderOverlayTextLayerToRT` 之后，`computeWipeAlphaBounds` 把文字 RT 降采样到 ≤128 边，CPU 扫 `a>ε` → min/max **RT 像素**（与 shader `world=vUv*res` 同空间），再 pad。无 alpha 则跳过 wipe。
- **不再**用 caret / localToWorld / camera.project / ui.rect 对齐。
- Shader：LTR `mask=1-u`；`reveal=smoothstep(thresh±soft,mask)`；`rgb*=reveal`；调试=`text*reveal`+青刃光。
- wipe 开启时预览字形 rest pose + opacity=1。

"""
if "computeWipeAlphaBounds" not in md:
    # insert after first ## wipe or after 数据
    if "## wipeReveal" in md:
        idx = md.find("## wipeReveal")
        # find next ## after that content - replace from ## wipeReveal until next ## 预览 or ## Deep
        import re as _re
        m = _re.search(r"## wipeReveal.*?(?=\n## )", md, _re.S)
        if m:
            md = md[:m.start()] + block + md[m.end():]
        else:
            md = block + md
    else:
        md = block + md

md = md.replace("TextLayerRT.js?v=fcc-ui-19", "TextLayerRT.js?v=fcc-ui-20")
md = md.replace("TextLayerRT.js?v=fcc-ui-18", "TextLayerRT.js?v=fcc-ui-20")
if "TextLayerRT.js?v=fcc-ui-20" not in md:
    md += "\n## 缓存\n- `TextLayerRT.js?v=fcc-ui-20`\n"

md_path.write_text(md, encoding="utf-8")
print("TEXTANIM.md updated")

# bump wipe mat version invalidate
tl = (ROOT / "ui/TextLayerRT.js").read_text(encoding="utf-8")
tl = tl.replace("wipeMat.userData.__fccWipeV !== 19", "wipeMat.userData.__fccWipeV !== 20")
tl = tl.replace("wipeMat.userData.__fccWipeV = 19", "wipeMat.userData.__fccWipeV = 20")
(ROOT / "ui/TextLayerRT.js").write_text(tl, encoding="utf-8")

# Final verify
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
tl = (ROOT / "ui/TextLayerRT.js").read_text(encoding="utf-8")
checks = [
    ("alpha bounds export", "export function computeWipeAlphaBounds" in tl),
    ("readRenderTargetPixels", "readRenderTargetPixels" in tl),
    ("Viewport uses alpha", "computeWipeAlphaBounds" in vp),
    ("no collect in VP", "collectWipeLayoutMetrics" not in vp),
    ("v20", "TextLayerRT.js?v=fcc-ui-20" in vp),
]
for n, ok in checks:
    print(("PASS" if ok else "FAIL"), n)

import subprocess
for f in ["ui/TextLayerRT.js", "Viewport.js"]:
    r = subprocess.run(["node", "--check", str(ROOT/f)], capture_output=True, text=True)
    print(("OK" if r.returncode==0 else "FAIL"), f)
