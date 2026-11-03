import zipfile, json, pathlib
pack = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
print("exists", pack.exists(), "size", pack.stat().st_size if pack.exists() else None)
with zipfile.ZipFile(pack) as z:
    names = z.namelist()
    tt = json.loads(z.read("pack/text-template.json"))
    mps = tt.get("mediaPlayers") or []
    for p in mps:
        fn = p.get("frameNames")
        print("---", p.get("name"), p.get("kind"))
        print("  path", p.get("path"))
        print("  sequenceDir", p.get("sequenceDir"))
        print("  targetUuid", p.get("targetUuid"))
        print("  uuid", p.get("uuid"))
        print("  playbackRate", p.get("playbackRate"), "sequenceFps", p.get("sequenceFps"), "loop", p.get("loop"))
        print("  frameNames", len(fn) if isinstance(fn,list) else fn)
    seq = [n for n in names if "886aed6f_seq" in n and n.endswith(".png")]
    print("png frames in zip", len(seq))
    # stickers
    for s in (tt.get("stickers") or []):
        if "seq" in str(s.get("texturePackPath","")) or s.get("rtTargetUuid"):
            print("sticker", s.get("id"), "rt", s.get("rtTargetUuid"), "packPath", s.get("texturePackPath"), "mat", s.get("materialUuid"), "material", s.get("material"))