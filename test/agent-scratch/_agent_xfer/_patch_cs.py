# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js")
s = p.read_text(encoding="utf-8")
old = """	wipeOutRT.texture.colorSpace = THREE.SRGBColorSpace;
	wipeOutRT.texture.flipY = false;
	wipeOutRT.texture.generateMipmaps = false;
	wipeOutRT.texture.name = 'FreeFilmCut.TextWipeReveal';"""
new = """	// Linear: keep edge glint >1.0 for TextFx Bloom/Deep Glow (not sRGB-encoded).
	wipeOutRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
	wipeOutRT.texture.flipY = false;
	wipeOutRT.texture.generateMipmaps = false;
	wipeOutRT.texture.name = 'FreeFilmCut.TextWipeReveal';"""
if old not in s:
    raise SystemExit('colorSpace block missing')
p.write_text(s.replace(old, new), encoding="utf-8")
print("wipe colorSpace -> LinearSRGB")

# Spot-check sidebar wipe section
side = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
idx = side.find("wipeHead")
print(side[idx:idx+1200])
