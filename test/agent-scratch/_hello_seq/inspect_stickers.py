import zipfile, json, pathlib
pack = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
with zipfile.ZipFile(pack) as z:
    tt = json.loads(z.read("pack/text-template.json"))
    stickers = tt.get("stickers") or tt.get("textStickers") or []
    print("stickers keys top", list(tt.keys())[:40])
    for k in tt:
        if "stick" in k.lower() or "material" in k.lower() or "media" in k.lower():
            v = tt[k]
            print(k, type(v).__name__, (len(v) if hasattr(v,"__len__") and not isinstance(v,str) else ""))
    # dump stickers related
    for key in ["stickers","textStickers","materials","mediaPlayers"]:
        if key in tt:
            print("====", key)
            print(json.dumps(tt[key], ensure_ascii=False)[:3000])