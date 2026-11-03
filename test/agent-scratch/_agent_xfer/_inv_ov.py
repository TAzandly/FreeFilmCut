from pathlib import Path
ov = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIOverlay.js").read_text(encoding="utf-8")
i = ov.find("render(")
# find render function
import re
m = re.search(r"function render\(|render:\s*function|\trender\( renderer", ov)
print("markers", ov.find("render( renderer"), ov.find("target"))
# print render method
for m in re.finditer(r"render\s*\( args|\trender\( renderer|render\( renderer,", ov):
    print("at", m.start(), ov[m.start():m.start()+200])
print("--- full render fn ---")
# export createUIOverlay return render
i = ov.find("function render")
if i<0:
    i = ov.find("\trender(")
print(ov[ov.find("syncCamera"):ov.find("syncCamera")+200])
# search renderOverlay
i = ov.find("render( renderer")
print(ov[i:i+800])
