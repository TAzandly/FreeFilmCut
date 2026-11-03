# -*- coding: utf-8 -*-
from pathlib import Path
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
md = """# FlowerStyle P1 — 花字 = Text 的多层 Effect 栈

## 架构（重要）

- **只有一种 UI 类型**：`fccUI.type === "text"`（添加 → UI → Text）
- **花字不是独立组件 / 不是独立菜单项 / 不是独立 mesh 物体**
- **花字 =** 挂在该 Text 上的 `fccUI.flowerStyle` Effect 栈数据
  （填充 / 多层描边 / 投影 / 内投影；每层 solid | gradient | texture）
- **花字库**（后续）= FlowerStyle 预设，应用到已有 Text，不会新建物体
- 渲染：同一 Text Group 下多 Pass 临时 Troika 子节点（`__fccFlower_*`），层级面板已隐藏

## 侧栏结构（选中 Text）

1. **基础 · 排版**：文本 / 字体 / 字号 / 加粗 / 颜色 / 间距 / 对齐
2. **花字 · Effect 栈**：填充、+描边、+投影、+内投影（始终可编辑）
   - 首次改特效会把 `flowerStyle` 写入 userData
   - 「重置特效」：清空为纯色填充
   - 「仅排版」：去掉 flowerStyle，回退 legacy 合成（兼容旧包）

旧的单层「描边/阴影」行已隐藏；特效统一走 Effect 栈。

## 验证（编辑器）

1. 硬刷新：`http://localhost:5174/editor/?v=fcc-ui-56`（Ctrl+F5）
2. 添加 → UI → Canvas，再添加 → UI → Text（**没有**「添加 → 花字」）
3. 选中 Text：对象面板应看到「基础 · 排版」和「花字 · Effect 栈」
4. 层级里展开 Text：**不应**出现 `__fccFlower_*` 子节点
5. 点击场景中的字：选中的是 Text 物体，不是某个 Pass
6. 在 Effect 栈改填充为渐变、+描边多层，视口应更新
7. 导出 `.vfxpack` 后 OpenCut 回放同构

## 相关文件

- `three.js/editor/js/ui/FlowerStyle.js` — schema
- `three.js/editor/js/ui/UIText.js` — Effect 栈渲染
- `three.js/editor/js/Sidebar.Object.UI.js` — Text 侧栏（基础 + 花字栈）
- `three.js/editor/js/Sidebar.Scene.js` — 隐藏 `__fcc*` 临时子节点
- `three.js/editor/js/Selector.js` — 点选归到 Text Group
- `freefilmcut/.../flower-style.ts` / `ui-overlay.ts` / `scene-builder.ts`

## 已知限制

- 贴图填充：schema 有，渲染 P2
- 内投影：P1 近似（叠在 face 前），非真 SDF 内阴影
- 渐变描边：Troika outline 色为单色，渐变主要作用在该层 fill
- 动画 Tab / 气泡 / 文字模板：非 P1
"""
(ROOT / "three.js/editor/js/ui/FLOWER_P1.md").write_text(md, encoding="utf-8")
p2 = ROOT / "_agent_xfer/huazi-analysis/FLOWER_P1.md"
if p2.parent.exists():
    p2.write_text(md, encoding="utf-8")
print("md ok", len(md))

import subprocess
files = [
    ROOT / "three.js/editor/js/Sidebar.Object.UI.js",
    ROOT / "three.js/editor/js/Sidebar.Scene.js",
    ROOT / "three.js/editor/js/Selector.js",
    ROOT / "three.js/editor/js/ui/FlowerStyle.js",
    ROOT / "three.js/editor/js/ui/UIText.js",
]
for f in files:
    r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
    print(f.name, "OK" if r.returncode == 0 else r.stderr[:400])
