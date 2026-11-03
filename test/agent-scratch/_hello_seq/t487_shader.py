import zipfile
z=zipfile.ZipFile(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
for n in z.namelist():
  if "36dq" in n or "mat_0" in n:
    print(n, z.getinfo(n).file_size)
frag=z.read("pack/shaders/mat_0_36dq.frag.glsl").decode("utf-8", errors="replace")
print("==== FRAG ====")
print(frag[:2500])