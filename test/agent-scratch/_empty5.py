from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Defensive: ensure listEffectDescriptors / getEffectDescriptor remind to register
# Better: make listEffectDescriptors not need BuiltinEffects circular import.
# Instead document that callers must registerBuiltinEffects first — both sidebars already do.
# Add a console warning if empty after filter for easier debug? Optional.

# Verify TextFx order: registerBuiltinEffects() then listEffectDescriptors
tfx = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.TextFx.js").read_text(encoding="utf-8", errors="replace")
# show top 30 lines of logic order
lines = tfx.splitlines()
for i, line in enumerate(lines[:80]):
    if "registerBuiltin" in line or "listEffect" in line or "typeSelect" in line:
        print(f"{i+1}: {line}")

spp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.PostProcess.js").read_text(encoding="utf-8", errors="replace")
print("--- PP ---")
for i, line in enumerate(spp.splitlines()[:80]):
    if "registerBuiltin" in line or "listEffect" in line or "typeSelect" in line:
        print(f"{i+1}: {line}")

# Confirm BuiltinEffects now points to v=6
be = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\postprocessing\BuiltinEffects.js").read_text(encoding="utf-8", errors="replace")
import re
print("BuiltinEffects imports:", re.findall(r"from '[^']+'", be)[:3])

# Also bump Viewport in index if needed - Editor imports Viewport
html = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\index.html").read_text(encoding="utf-8", errors="replace")
for m in re.finditer(r"(Editor|Viewport|Sidebar)\.js\?v=[^\"]+", html):
    print("html", m.group(0))
