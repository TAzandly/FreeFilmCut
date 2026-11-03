# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== Viewport ==========
vp_path = ROOT / "Viewport.js"
vp = vp_path.read_text(encoding="utf-8")

# Fix imports
old_imp = """import {
	ensureTextLayerRenderTarget,
	renderOverlayTextLayerToRT,
	blitTextLayerToLetterbox,
	stackDataHasEnabledEffects,
	applyWipeReveal,
	computeWipeUvBounds,
	applyTextLayerFx,
} from './ui/TextLayerRT.js?v=fcc-ui-12';
import { isFccUI, getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-88';
import { applyTextAnimsInScene } from './ui/TextAnimRuntime.js?v=fcc-ui-7';
import {
	ensureTextAnimOnUI,
	sampleWipeRevealProgress,
} from './ui/TextAnim.js?v=fcc-ui-7';"""

new_imp = """import {
	ensureTextLayerRenderTarget,
	renderOverlayTextLayerToRT,
	blitTextLayerToLetterbox,
	stackDataHasEnabledEffects,
	applyWipeReveal,
	applyTextLayerFx,
} from './ui/TextLayerRT.js?v=fcc-ui-13';
import { isFccUI, getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-88';
import {
	applyTextAnimsInScene,
	collectWipeLayoutMetrics,
} from './ui/TextAnimRuntime.js?v=fcc-ui-8';
import {
	ensureTextAnimOnUI,
	sampleWipeRevealProgress,
} from './ui/TextAnim.js?v=fcc-ui-7';"""

if old_imp not in vp:
    # try find current import block
    m = re.search(r"import \{\n\tensureTextLayerRenderTarget,.*?\n\} from '\./ui/TextLayerRT\.js\?v=[^']+';", vp, re.S)
    print("Current TextLayerRT import:")
    print(m.group(0) if m else "NOT FOUND")
    m2 = re.search(r"import \{[^}]*applyTextAnimsInScene[^}]*\} from '\./ui/TextAnimRuntime\.js\?v=[^']+';", vp, re.S)
    print("Runtime import:", m2.group(0) if m2 else "NOT FOUND")
    raise SystemExit("Viewport import block mismatch")

vp = vp.replace(old_imp, new_imp)

old_wipe_call = """				if ( wipeInfo ) {
					const bounds = computeWipeUvBounds(
						wipeInfo.object,
						projectRes.width,
						projectRes.height,
					);
					outTex = applyWipeReveal( {
						renderer,
						inputTexture: outTex,
						width: textRT.width,
						height: textRT.height,
						progress: wipeInfo.wipe.progress,
						direction: wipeInfo.wipe.direction,
						soft: wipeInfo.wipe.soft,
						edgeIntensity: wipeInfo.wipe.edgeIntensity,
						edgeWidth: wipeInfo.wipe.edgeWidth,
						bounds,
					} ) || outTex;
				}"""

new_wipe_call = """				if ( wipeInfo ) {
					// Axis from Troika caret / char layout (not object Box3 UV).
					const layout = collectWipeLayoutMetrics( wipeInfo.object );
					outTex = applyWipeReveal( {
						renderer,
						inputTexture: outTex,
						width: textRT.width,
						height: textRT.height,
						progress: wipeInfo.wipe.progress,
						direction: wipeInfo.wipe.direction,
						soft: wipeInfo.wipe.soft,
						edgeIntensity: wipeInfo.wipe.edgeIntensity,
						edgeWidth: wipeInfo.wipe.edgeWidth,
						layout,
					} ) || outTex;
				}"""

if old_wipe_call not in vp:
    raise SystemExit("wipe call block not found")
vp = vp.replace(old_wipe_call, new_wipe_call)
vp_path.write_text(vp, encoding="utf-8")
print("Viewport OK", "collectWipeLayoutMetrics" in vp, "computeWipeUvBounds" not in vp)

# ========== Sidebar note + cache ==========
side = (ROOT / "Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
side = side.replace("TextAnimRuntime.js?v=fcc-ui-7", "TextAnimRuntime.js?v=fcc-ui-8")
side = side.replace("TextAnim.js?v=fcc-ui-7", "TextAnim.js?v=fcc-ui-7")  # keep
# Update note if mentions RT UV / AABB
if "text-RT fragment reveal + edge glint" in side:
    side = side.replace(
        "'· wipe = text-RT fragment reveal + edge glint; soft/edge are text-local UV. TextFx Deep Glow/Bloom can pick up overbright edge.'",
        "'· wipe = fragment reveal along caret layout axis (not bbox UV) + edge glint. TextFx Deep Glow/Bloom can pick up overbright edge.'",
    )
# Chinese note - replace via regex if present
side = re.sub(
    r"(\? ')([^']*wipe = 文字 RT[^']*)(')",
    r"\1· wipe = 沿 caret 字形布局轴片元扫光（非整框 bbox UV）+ 刃光。TextFx Deep Glow/Bloom 可吃过亮刃光。\3",
    side,
    count=1,
)
(ROOT / "Sidebar.Object.TextAnim.js").write_text(side, encoding="utf-8")
print("Sidebar note/cache OK")

# ========== UI.js Sidebar TextAnim bump if points at Runtime indirectly - bump TextAnim sidebar to 9 ==========
ui = (ROOT / "Sidebar.Object.UI.js").read_text(encoding="utf-8")
ui2 = ui.replace("Sidebar.Object.TextAnim.js?v=fcc-ui-8", "Sidebar.Object.TextAnim.js?v=fcc-ui-9")
if ui2 != ui:
    (ROOT / "Sidebar.Object.UI.js").write_text(ui2, encoding="utf-8")
    print("UI.js sidebar bump 9")

# TextLayerRT BuiltinEffects import bump stay
tl = (ROOT / "ui/TextLayerRT.js").read_text(encoding="utf-8")
# bump self refs if any - Viewport already points to 13

# TextAnimRuntime TextAnim import stay at 7
rt = (ROOT / "ui/TextAnimRuntime.js").read_text(encoding="utf-8")
if "TextAnim.js?v=fcc-ui-7" not in rt:
    print("WARN runtime TextAnim import", re.findall(r"TextAnim\.js\?v=[^\"]+", rt))

# ========== TEXTANIM.md ==========
md = """# 文字动画 (textanim V1) — Editor 预览

## 数据
- `fccUI.textAnim`，format `freecapcut.textanim/1`
- 阶段：`in` / `out`（`loop` 预留）
- 通道：opacity / offsetX,Y / scale / rotateX,Y,Z
- stagger：overlap / order(ltr|rtl|random) / seed
- ease：linear / cubicOut / cubicInOut / bounceOut / **spring**（只影响逐字通道）
- 调制：wave / bend（字盒变换）
- **wipeReveal**：文字 RT **片元扫光 + 刃光**，轴沿 **字形/caret 布局**（非整框 Box3 UV）

## wipeReveal 公式（layout axis）
1. `collectWipeLayoutMetrics(text)`：读 `__fccCharBase`（Troika caret 中心，字组本地坐标）；无则用 `ui.rect` 半宽；再按 fontSize 扩半字 + soft pad。
2. 片元：`world = vUv * res` → 减 `group.position` → 逆旋转/逆缩放 → **local**
3. `u = (local.x - minX)/(maxX-minX)`（rtl/ttb/btt 取反或换轴）
4. `pExp = p*(1+2*soft)-soft`
5. `reveal = smoothstep(axis±soft, pExp)`
6. `edge = band(axis, ew, pExp) * tex.a`；`rgb += edge * edgeIntensity`；`a *= reveal`
7. 管线：Overlay→RT → wipe → TextFx → blit

## Deep Glow 颜色
- `deepGlow.params.color` hex 默认 `#ffffff`

## 缓存
- `TextAnimRuntime.js?v=fcc-ui-8`
- `TextLayerRT.js?v=fcc-ui-13`
- `Sidebar.Object.TextAnim.js?v=fcc-ui-9`
- `TextAnim.js?v=fcc-ui-7`
"""
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")
print("TEXTANIM.md OK")
