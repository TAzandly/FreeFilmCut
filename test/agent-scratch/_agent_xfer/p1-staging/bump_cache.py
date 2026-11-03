# -*- coding: utf-8 -*-
from pathlib import Path
import re

# Bump key cache versions to fcc-ui-55
files_replace = {
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.js"): [
        ("Sidebar.Object.UI.js?v=fcc-ui-39", "Sidebar.Object.UI.js?v=fcc-ui-55"),
    ],
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.js"): [
        ("Sidebar.Properties.js?v=fcc-ui-53", "Sidebar.Properties.js?v=fcc-ui-55"),
    ],
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\index.html"): [
        ("Editor.js?v=fcc-ui-54", "Editor.js?v=fcc-ui-55"),
        ("Sidebar.js?v=fcc-ui-53", "Sidebar.js?v=fcc-ui-55"),
        ("Menubar.js?v=fcc-ui-54", "Menubar.js?v=fcc-ui-55"),
    ],
}

# UIFactory and related that import UIText/UIConstants
for p in [
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIFactory.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIRectLayout.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Menubar.Add.js"),
    Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Properties.js"),
]:
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8")
    nt = t
    nt = re.sub(r"UIConstants\.js\?v=fcc-ui-\d+", "UIConstants.js?v=fcc-ui-55", nt)
    nt = re.sub(r"UIText\.js\?v=fcc-ui-\d+", "UIText.js?v=fcc-ui-55", nt)
    nt = re.sub(r"UIFactory\.js\?v=fcc-ui-\d+", "UIFactory.js?v=fcc-ui-55", nt)
    nt = re.sub(r"UIRectLayout\.js\?v=fcc-ui-\d+", "UIRectLayout.js?v=fcc-ui-55", nt)
    nt = re.sub(r"Sidebar\.Object\.UI\.js\?v=fcc-ui-\d+", "Sidebar.Object.UI.js?v=fcc-ui-55", nt)
    if nt != t:
        p.write_bytes(nt.replace("\r\n","\n").encode("utf-8"))
        print("updated imports", p.name)
    else:
        print("no change", p.name)

for p, pairs in files_replace.items():
    t = p.read_text(encoding="utf-8")
    for a,b in pairs:
        if a in t:
            t = t.replace(a,b)
            print(p.name, a, "->", b)
        else:
            print(p.name, "missing", a)
    p.write_bytes(t.replace("\r\n","\n").encode("utf-8"))

# Also bump Sidebar.Object.UI internal ExposedParams if needed - leave
# Write FLOWER_P1.md
md = """# FlowerStyle P1 (花字)

## 验证步骤（编辑器）

1. 硬刷新：`http://localhost:5174/editor/?v=fcc-ui-55`（Ctrl+F5）
2. 添加 → UI → Canvas，再添加 → UI → Text
3. 选中 Text：改文本 / 字号 / 颜色（基础仍可用）
4. 侧栏「花字」→ 点「从基础生成」启用 FlowerStyle
5. 面填充：切「渐变」，调两色与角度，视口应变
6. 「+ 描边」加一层，调宽度/颜色；可加多层
7. 「+ 投影」「+ 内投影」：距离/角度/模糊/颜色
8. 「清除」花字后回到基础 outline/shadow 渲染

## 验证步骤（剪辑端）

1. 导出含花字 Text 的 `.vfxpack`
2. OpenCut 硬刷新后导入；应看到同构 Effect 栈（`PACK_SCENE_BUILD_REV=11`）
3. 无需改包结构；旧包无 `flowerStyle` 时用 legacy outline/shadow 合成

## 改动文件

- `three.js/editor/js/ui/FlowerStyle.js`（新）
- `three.js/editor/js/ui/UIText.js`（Effect 栈）
- `three.js/editor/js/ui/UIConstants.js`
- `three.js/editor/js/Sidebar.Object.UI.js`（花字侧栏）
- `three.js/editor/js/VfxPackExporter.js`
- `freefilmcut/apps/web/src/vfxpack/flower-style.ts`（新）
- `freefilmcut/apps/web/src/vfxpack/ui-overlay.ts`
- `freefilmcut/apps/web/src/vfxpack/scene-builder.ts`（REV 11）

## 已知限制

- 贴图填充：schema 已留，渲染按纯色回退（P2）
- 内投影：P1 近似（画在 face 前），非真正 SDF 内阴影
- 渐变描边：Troika outline 色为纯色；渐变主要作用在该层 fill
- 动画 Tab / 气泡 / 文字模板：非 P1
- 默认字体仍需联网（Noto Sans SC）；自定义字体用「文件」
"""
Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\FLOWER_P1.md").write_bytes(md.encode("utf-8"))
print("FLOWER_P1.md written")

# Update TEXT_MVP.md note
tp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TEXT_MVP.md")
tt = tp.read_text(encoding="utf-8")
if "FlowerStyle" not in tt:
    tt += "\n\n## FlowerStyle P1\n\nSee FLOWER_P1.md — multilayer 描边/投影 + solid/linear gradient via Effect stack.\nHard refresh `?v=fcc-ui-55`.\n"
    tp.write_bytes(tt.replace("\r\n","\n").encode("utf-8"))
    print("TEXT_MVP updated")
