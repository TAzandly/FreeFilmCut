from pathlib import Path
# strip BOM from written files
for p in [
    Path(r"freefilmcut/apps/web/src/vfxpack/text-layer-aabb.ts"),
    Path(r"three.js/editor/js/ui/TextLayerAabb.js"),
]:
    data = p.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        p.write_bytes(data[3:])
        print("stripped BOM", p)
    else:
        print("no BOM", p)

# show computeTroikaInkAabb body snippet
text = Path(r"freefilmcut/apps/web/src/vfxpack/text-layer-aabb.ts").read_text(encoding="utf-8")
i = text.find("export function computeTroikaInkAabb")
print(text[i:i+1200])
