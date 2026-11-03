# -*- coding: utf-8 -*-
from pathlib import Path
import json
EDITOR = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor")

p = EDITOR / "js" / "ui" / "UIFactory.js"
t = p.read_text(encoding="utf-8")
t2 = t.replace("UIText.js?v=fcc-ui-71", "UIText.js?v=fcc-ui-72").replace("UIText.js?v=fcc-ui-70", "UIText.js?v=fcc-ui-72")
p.write_text(t2, encoding="utf-8")
print("UIFactory", t != t2)

p = EDITOR / "js" / "Menubar.js"
t = p.read_text(encoding="utf-8")
t2 = t.replace("Menubar.Add.js?v=fcc-ui-30", "Menubar.Add.js?v=fcc-ui-72")
# also any other Menubar.Add versions
import re
t2 = re.sub(r"Menubar\.Add\.js\?v=fcc-ui-\d+", "Menubar.Add.js?v=fcc-ui-72", t2)
p.write_text(t2, encoding="utf-8")
print("Menubar.js updated")

preset = {
  "id": "7645318555541638462",
  "name": "剪映样例",
  "assetDir": "assets/flower/7645",
  "fill": "solid #ffffff",
  "strokes": [
    {"side": "outer", "widthRel": 0.145, "content": "solid #ffffff"},
    {"side": "outer", "widthRel": 0.12, "content": "solid #024479"},
    {"side": "outer", "widthRel": 0.102, "content": "texture 1780131838447.png"},
    {"side": "outer", "widthRel": 0.057, "content": "texture 1780131613632.png"},
  ],
  "shadows": [
    {"note": "pink soft drop", "color": "#fb9ffb", "distance": 4.55, "diffuseRel": 0.06, "alpha": 0.9},
    {"note": "purple gradient glow", "colors": ["#a018a0", "#1c000b"], "distance": 0, "diffuseRel": 0.0055},
    {"note": "texture underlay", "texture": "1780131613632.png"},
  ],
  "innerShadows": [
    {"texture": "1780131462621.png", "distance": 5, "diffuseRel": 0.025, "alpha": 0.9, "scale": 1.3}
  ],
  "unitMap": {
    "strokeWidth": "capcutWidth * fontSize",
    "diffuse": "capcutDiffuse * fontSize",
    "distance": "capcutDistance * (fontSize / 48)"
  },
  "gaps": [
    "CapCut nested strokes-on-shadow flattened to concentric outer strokes",
    "inner shadow stencil still approximate / may be invisible",
    "offset outline rings become concentric"
  ]
}
(EDITOR / "assets" / "flower" / "7645" / "preset.json").write_text(
    json.dumps(preset, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("preset.json ok")

# Quick unit sanity: fontSize 48
print("widths @48:", [round(0.145*48,2), round(0.12*48,2), round(0.102*48,2), round(0.057*48,2)])
print("pink diffuse @48:", round(0.0598*48, 2))
print("pink dist @48:", round(4.548, 2))
