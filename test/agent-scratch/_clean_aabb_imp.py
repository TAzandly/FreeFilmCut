from pathlib import Path
path = Path(r"freefilmcut/apps/web/src/vfxpack/text-layer-aabb.ts")
text = path.read_text(encoding="utf-8")
text = text.replace(
    """import {
	isFccTroikaTextMesh,
	isUIText,
	layoutAllCanvases,
	type FccUIData,
} from "@/vfxpack/ui-overlay";
""",
    """import {
	isFccTroikaTextMesh,
	layoutAllCanvases,
} from "@/vfxpack/ui-overlay";
""",
)
text = text.replace(
    """
/** Debug / docs helper — ignore unused lint on FccUIData import path consumers. */
export type { FccUIData };
""",
    "\n",
)
# also handle possible mojibake dash variant
import re
text = re.sub(r"\n/\*\* Debug / docs helper.*?\nexport type \{ FccUIData \};\n", "\n", text, count=1, flags=re.S)
path.write_text(text, encoding="utf-8")
print("cleaned aabb imports")
