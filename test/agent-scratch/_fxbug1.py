from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut")

# TextLayerRT blit + apply
print("===== TextLayerRT.js =====")
print((root/"three.js/editor/js/ui/TextLayerRT.js").read_text(encoding="utf-8", errors="replace"))
