from pathlib import Path
import re
tl = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js").read_text(encoding="utf-8")
ens = re.search(r"function ensureWipePass\(\) \{.*?\n\}\n\nfunction ensureWipeOutRT", tl, re.S).group(0)
print("uWorldBounds", "uWorldBounds" in ens)
print("uCenter leftover", "uCenter" in ens)
print("uLocalBounds leftover", "uLocalBounds" in ens)
print("NoBlending", "NoBlending" in ens)
print("rgb * reveal", "c.rgb * reveal" in ens)
rt = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js").read_text(encoding="utf-8")
print("rest pose", "Wipe fragment mask is layout-spatial" in rt)
print("localToWorld", "localToWorld" in rt)
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
print("v17", "TextLayerRT.js?v=fcc-ui-17" in vp, "TextAnimRuntime.js?v=fcc-ui-10" in vp)
