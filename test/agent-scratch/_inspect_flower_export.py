import json
import pathlib

work = pathlib.Path.home().joinpath("AppData/Local/Temp/fcc_flower_user_export")
# also try env TEMP from extract
import os
work = pathlib.Path(os.environ.get("TEMP", "")) / "fcc_flower_user_export"
scene = json.load(open(next(work.rglob("scene.json")), encoding="utf-8"))


def walk(o, path=""):
    if isinstance(o, dict):
        if "flowerStyle" in o:
            fs = o["flowerStyle"]
            print("HIT", path)
            fill = fs.get("fill", {}).get("content", {})
            tex = fill.get("texture") or {}
            print("  fill", fill.get("renderType"), tex.get("path"), tex.get("fileName"))
            for i, e in enumerate(fs.get("stack") or []):
                c = e.get("content") or {}
                t = c.get("texture") or {}
                print(
                    f"  stack[{i}] kind={e.get('kind')} rt={c.get('renderType')} "
                    f"path={t.get('path')} file={t.get('fileName')}"
                )
                for j, st in enumerate(e.get("strokes") or []):
                    sc = st.get("content") or {}
                    stt = sc.get("texture") or {}
                    print(
                        f"    nestStroke[{j}] rt={sc.get('renderType')} "
                        f"path={stt.get('path')} file={stt.get('fileName')}"
                    )
            for i, sh in enumerate(fs.get("shadows") or []):
                c = sh.get("content") or {}
                t = c.get("texture") or {}
                print(
                    f"  shadows[{i}] rt={c.get('renderType')} "
                    f"path={t.get('path')} file={t.get('fileName')}"
                )
        for k, v in o.items():
            walk(v, path + "." + k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            walk(v, f"{path}[{i}]")


walk(scene)
