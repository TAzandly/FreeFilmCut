from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js")

# EffectComposer render / swap / readBuffer
ec = (root/"examples/jsm/postprocessing/EffectComposer.js").read_text(encoding="utf-8", errors="replace")
# or node_modules
if "class EffectComposer" not in ec:
    ec = (root/"editor/node_modules/three/examples/jsm/postprocessing/EffectComposer.js").read_text(encoding="utf-8", errors="replace")
print("EffectComposer len", len(ec))
# constructor with renderTarget
i = ec.find("constructor")
print(ec[i:i+1200])
print("--- render ---")
i = ec.find("\trender(")
print(ec[i:i+1500])
