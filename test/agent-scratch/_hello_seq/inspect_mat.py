import zipfile, json, pathlib, re
pack = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
with zipfile.ZipFile(pack) as z:
    # find materials
    for n in z.namelist():
        if "material" in n.lower() or n.endswith("scene.json"):
            print("file", n, z.getinfo(n).file_size)
    scene = None
    for cand in ["pack/scene.json","scene.json"]:
        if cand in z.namelist():
            scene = json.loads(z.read(cand))
            print("scene from", cand)
            break
    tt = json.loads(z.read("pack/text-template.json"))
    # materials might be in scene
    target = "404ade74-77b0-40d1-892e-a53ca3776aa7"
    rt = "9cd05935-11c7-45e9-afec-cf81438c530f"
    found = []
    def walk(o, path=""):
        if isinstance(o, dict):
            if o.get("uuid") == target or str(o.get("uuid","")).startswith("404ade74"):
                found.append(("mat", path, {k:o.get(k) for k in list(o)[:20]}))
            if "fccRtSlots" in str(o) or (isinstance(o.get("userData"), dict) and "fccRtSlots" in str(o.get("userData"))):
                found.append(("rtslot", path, o.get("userData") or o.get("uuid")))
            mats = o.get("materials")
            if isinstance(mats, list):
                for m in mats:
                    if isinstance(m, dict) and m.get("uuid") == target:
                        found.append(("matlist", path, json.dumps(m, ensure_ascii=False)[:2000]))
            for k,v in o.items():
                walk(v, path+"/"+k)
        elif isinstance(o, list):
            for i,v in enumerate(o[:500]):
                walk(v, path+f"[{i}]")
    if scene: walk(scene)
    # also check mediaAssets
    print("mediaAssets", json.dumps(tt.get("mediaAssets"), ensure_ascii=False)[:2000])
    print("found", len(found))
    for f in found[:10]:
        print("---", f[0], f[1])
        print(f[2] if isinstance(f[2], str) else json.dumps(f[2], ensure_ascii=False)[:1500])