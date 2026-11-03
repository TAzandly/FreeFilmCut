import zipfile, json, pathlib
pack = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
with zipfile.ZipFile(pack) as z:
    names = z.namelist()
    print("entries", len(names))
    tt = None
    for n in names:
        if n.endswith("text-template.json") or n == "text-template.json":
            tt = json.loads(z.read(n))
            print("tt path", n)
            break
    if not tt:
        print("NO text-template.json")
        # try manifest
        for n in names:
            if "manifest" in n.lower() or n.endswith(".json"):
                print("json", n)
    else:
        mps = tt.get("mediaPlayers") or tt.get("MediaPlayers") or []
        print("mediaPlayers", len(mps))
        for p in mps:
            print("---")
            for k in ["id","name","kind","path","projectPath","fps","duration","playbackRate","loop","targetUuid","frameNames"]:
                v = p.get(k)
                if k == "frameNames":
                    print(" frameNames", len(v) if isinstance(v,list) else v, "sample", (v[:3] if isinstance(v,list) else None))
                else:
                    print(" ", k, v)
    # list sequence files
    seqs = [n for n in names if "seq" in n.lower() or "/886aed6f" in n or "sequences/" in n]
    print("seq-ish files", len(seqs))
    for n in seqs[:15]:
        info = z.getinfo(n)
        print(" ", n, info.file_size)
    if len(seqs) > 15: print(" ...", len(seqs)-15, "more")