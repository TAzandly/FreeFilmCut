import zipfile,json
z=zipfile.ZipFile(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
scene=json.loads(z.read("pack/scene.json"))
nodes=scene.get("nodes") or []
print("top nodes", len(nodes))
for n in nodes[:20]:
  print(" -", n.get("name"), n.get("kind") or n.get("type"), "children", len(n.get("children") or []), "hasVP", bool((n.get("userData") or {}).get("fccVideoPlayer")))
# count all with VP nested
count=0
def walk(n):
  global count
  if (n.get("userData") or {}).get("fccVideoPlayer"): count+=1
  for c in n.get("children") or []: walk(c)
for n in nodes: walk(n)
print("total VP nested", count)