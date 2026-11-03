from pathlib import Path
import re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut")

# Registry listEffectDescriptors + registerEffect inputs default
reg = (root/"three.js/editor/js/postprocessing/PostProcessRegistry.js").read_text(encoding="utf-8", errors="replace")
print("===== PostProcessRegistry.js =====")
print(reg)

print("\n===== BuiltinEffects registerEffect calls =====")
be = (root/"three.js/editor/js/postprocessing/BuiltinEffects.js").read_text(encoding="utf-8", errors="replace")
for m in re.finditer(r"registerEffect\(\s*'(\w+)'\s*,\s*\{([^}]{0,200})", be):
    print("type:", m.group(1))
    print("  head:", m.group(2)[:150].replace("\n"," "))

# TextFx how it builds options
tfx = (root/"three.js/editor/js/Sidebar.Object.TextFx.js").read_text(encoding="utf-8", errors="replace")
print("\n===== TextFx typeSelect =====")
i = tfx.find("typeSelect")
print(tfx[i:i+900])

# Camera PP sidebar
spp = (root/"three.js/editor/js/Sidebar.Object.PostProcess.js").read_text(encoding="utf-8", errors="replace")
print("\n===== Camera PP typeSelect =====")
i = spp.find("typeSelect")
print(spp[i:i+700])
print("\nPP imports:")
for m in re.finditer(r"import .+PostProcess|import .+Builtin", spp):
    print(m.group(0))
print("\nTextFx imports:")
for m in re.finditer(r"import .+PostProcess|import .+Builtin", tfx):
    print(m.group(0))
