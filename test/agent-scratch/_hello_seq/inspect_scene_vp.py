import zipfile, json
z=zipfile.ZipFile(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
scene=json.loads(z.read("pack/scene.json"))
found=[]
def walk(n, path=""):
  if isinstance(n, dict):
    ud=n.get("userData") or {}
    vp=ud.get("fccVideoPlayer")
    rt=ud.get("fccRenderTexture")
    if vp or rt:
      found.append({"path":path,"name":n.get("name"),"uuid":n.get("uuid"),"vp":vp,"rt":rt})
    for c in (n.get("children") or n.get("nodes") or []):
      walk(c, path+"/"+str(n.get("name")))
  elif isinstance(n, list):
    for i,x in enumerate(n): walk(x, path+f"[{i}]")
roots=scene.get("nodes") or ([scene["object"]] if scene.get("object") else [])
walk(roots)
for f in found:
  print("---", f["name"], f["uuid"])
  if f["vp"]:
    vp=dict(f["vp"])
    fn=vp.get("frameNames")
    vp["frameNames"]= (len(fn) if isinstance(fn,list) else fn)
    print(" vp", json.dumps(vp, ensure_ascii=False)[:500])
  if f["rt"]:
    print(" rt", f["rt"])