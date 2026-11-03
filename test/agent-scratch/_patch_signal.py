from pathlib import Path
ed = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Editor.js")
et = ed.read_text(encoding="utf-8")
if "projectSettingsChanged: new Signal()" in et:
    print("already defined")
else:
    old = "\t\tprojectTitleChanged: new Signal(), // FreeFilmCut: project display name"
    new = "\t\tprojectTitleChanged: new Signal(), // FreeFilmCut: project display name\n\t\tprojectSettingsChanged: new Signal(), // FreeFilmCut: renderer toneMapping etc from project JSON"
    if old not in et:
        raise SystemExit("anchor not found")
    ed.write_text(et.replace(old, new, 1), encoding="utf-8")
    print("OK added projectSettingsChanged signal")
