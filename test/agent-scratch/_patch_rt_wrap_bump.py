# -*- coding: utf-8 -*-
import pathlib

ROOT = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/three.js/editor")

# Bump cache-bust for modules that import changed FccVideo / UIText / Sidebar Media
targets = [
    "js/Editor.js",
    "js/Menubar.Add.js",
    "js/Menubar.File.js",
    "js/preview/PreviewCapture.js",
    "js/Sidebar.Object.js",
    "js/Sidebar.Object.UI.js",
    "js/Viewport.js",
    "js/timeline/FccTimelineEditor.js",
    "js/ui/TextAnimRuntime.js",
    "js/ui/TextGeomFx.js",
    "js/ui/UIFactory.js",
    "js/ui/UIRectLayout.js",
    "js/Sidebar.Object.Media.js",
    "js/ui/UIText.js",
]

changed = []
for rel in targets:
    path = ROOT / rel
    if not path.exists():
        print("missing", path)
        continue
    s = path.read_text(encoding="utf-8")
    s2 = s.replace("FccVideo.js?v=fcc-ui-200", "FccVideo.js?v=fcc-ui-201")
    s2 = s2.replace("UIText.js?v=fcc-ui-200", "UIText.js?v=fcc-ui-201")
    s2 = s2.replace("Sidebar.Object.UI.js?v=fcc-ui-200", "Sidebar.Object.UI.js?v=fcc-ui-201")
    s2 = s2.replace("FlowerStyle.js?v=fcc-ui-200", "FlowerStyle.js?v=fcc-ui-201")
    s2 = s2.replace("Sidebar.Object.TextStickers.js?v=fcc-ui-200", "Sidebar.Object.TextStickers.js?v=fcc-ui-201")
    if s2 != s:
        path.write_text(s2, encoding="utf-8")
        changed.append(rel)
        print("bumped", rel)
    else:
        print("no change", rel)

print("done", len(changed))
