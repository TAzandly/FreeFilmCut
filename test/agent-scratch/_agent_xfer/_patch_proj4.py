from pathlib import Path
import re
rt_path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js")
rt = rt_path.read_text(encoding="utf-8")
rt2, n = re.subn(
    r"(\t// Project world .*?\n\tlet minX = Infinity;)",
    "\tif ( camera && camera.isCamera ) {\n\n"
    "\t\tcamera.updateProjectionMatrix();\n"
    "\t\tcamera.updateMatrixWorld( true );\n\n"
    "\t}\n\n"
    r"\1",
    rt,
    count=1,
)
print("subs", n)
rt_path.write_text(rt2, encoding="utf-8")
import subprocess
print(subprocess.run(["node","--check",str(rt_path)], capture_output=True, text=True).returncode)

# Final checklist
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
print("camera pass", "camera: uiOverlay.camera" in vp)
print("v18", "TextLayerRT.js?v=fcc-ui-18" in vp)
print("v11 runtime", "TextAnimRuntime.js?v=fcc-ui-11" in vp)
