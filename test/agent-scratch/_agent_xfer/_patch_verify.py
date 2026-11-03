# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# Remove unused textLayerCompositeSource from Viewport import
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
# Check if used beyond import
uses = len(re.findall(r"textLayerCompositeSource", vp))
print("textLayerCompositeSource mentions:", uses)
if uses == 1:
    vp = vp.replace("\ttextLayerCompositeSource,\n", "")
    (ROOT / "Viewport.js").write_text(vp, encoding="utf-8")
    print("removed unused import")

# TEXTANIM.md
md = """# 文字动画 (textanim V1) — Editor 预览

## 数据
- `fccUI.textAnim`，format `freecapcut.textanim/1`
- 阶段：`in` / `out`（`loop` 预留）
- 通道：opacity / offsetX,Y / scale / rotateX,Y,Z
- stagger：overlap / order(ltr|rtl|random) / seed
- ease：linear / cubicOut / cubicInOut / bounceOut / **spring**（只影响逐字通道）
- 调制：wave / bend（字盒变换）
- **wipeReveal**：入场 0=全遮 / 1=全显；出场进度反转。**文字 RT 片元扫光 + 刃光**（非整屏、非逐字 opacity）

## wipeReveal 公式（文字 RT fragment）
- 进度：`p = t/duration` 线性（不用 spring/bounce）
- UV：映射到字串 AABB（`computeWipeUvBounds`）再取 axis（ltr/rtl/ttb/btt）
- `pExp = p * (1 + 2*soft) - soft`
- `reveal = smoothstep(axis - soft, axis + soft, pExp)`
- `edge = smoothstep(axis - ew, axis, pExp) * (1 - smoothstep(axis, axis + ew, pExp)) * tex.a`
- `rgb = tex.rgb + edge * edgeIntensity`；`a = tex.a * reveal`
- 空像素 discard（空区不发光）
- 参数：`soft` / `edgeIntensity`（默认 2.5）/ `edgeWidth`（默认 0.04）
- 管线：Overlay→RT → **wipe** → TextFx（Bloom/Deep Glow 可吃过亮刃光）→ blit
- 逐字 opacity **不再**乘 wipe（避免双重遮罩）

## Deep Glow 颜色
- 相机 / 文字 Fx 栈 `deepGlow.params.color`（hex，默认 `#ffffff`）
- Blend 时 `glowEnergy * softI * glowColor`；intensity=0 仍直通

## 预览行为
1. 启用后隐藏原字，每字 Group + 花字 Effect
2. 勾选扫光时强制 Text→RT；刃光在片元扫光前沿
3. spring 只驱动 offset/scale/rotate/opacity 通道

## 缓存
- `TextAnim.js?v=fcc-ui-7`
- `TextAnimRuntime.js?v=fcc-ui-7`
- `Sidebar.Object.TextAnim.js?v=fcc-ui-8`
- `TextLayerRT.js?v=fcc-ui-12`
- `DeepGlowPass.js?v=fcc-ui-12` / `BuiltinEffects.js?v=fcc-ui-12`
"""
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")
print("TEXTANIM.md updated")

# Verify key snippets
tl = (ROOT / "ui/TextLayerRT.js").read_text(encoding="utf-8")
assert "uEdgeIntensity" in tl
assert "HalfFloatType" in tl
assert "edge * uEdgeIntensity" in tl
print("TextLayerRT asserts OK")

ta = (ROOT / "ui/TextAnim.js").read_text(encoding="utf-8")
assert "edgeIntensity" in ta
print("TextAnim asserts OK")

be = (ROOT / "postprocessing/BuiltinEffects.js").read_text(encoding="utf-8")
assert "type: 'color'" in be
assert "parseGlowColor" in be
print("BuiltinEffects asserts OK")

# Syntax check with node
import subprocess
files = [
    ROOT / "ui/TextAnim.js",
    ROOT / "ui/TextAnimRuntime.js",
    ROOT / "ui/TextLayerRT.js",
    ROOT / "postprocessing/BuiltinEffects.js",
    ROOT / "Sidebar.Object.TextAnim.js",
    ROOT / "Sidebar.Object.PostProcess.js",
    ROOT / "Sidebar.Object.TextFx.js",
    ROOT / "Viewport.js",
]
for f in files:
    # wrap as module check — node --check works for CJS; for ESM use acorn or just parse
    r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
    status = "OK" if r.returncode == 0 else "FAIL"
    print(status, f.name)
    if r.returncode != 0:
        print(r.stderr[:500])
