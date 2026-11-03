import zipfile, hashlib, pathlib
z=zipfile.ZipFile(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/public/vfxpacks/text-templates/freecapcut.hello.vfxpack")
hashes=[]
sizes=[]
for i in range(50):
  name=f"pack/sequences/886aed6f_seq/sucai02_{i:05d}.png"
  data=z.read(name)
  sizes.append(len(data))
  hashes.append(hashlib.md5(data).hexdigest()[:8])
print("unique hashes", len(set(hashes)))
print("sizes sample", sizes[:10], "...", sizes[40:])
print("hash sample", hashes[:5], "...", hashes[25:30])
# decode dims via struct PNG IHDR
import struct
def dims(data):
  # IHDR at byte 16 after 8 sig + 4 len + 4 type
  w,h=struct.unpack(">II", data[16:24])
  return w,h
for i in [0,1,5,10,25,49]:
  d=z.read(f"pack/sequences/886aed6f_seq/sucai02_{i:05d}.png")
  print(i, dims(d), sizes[i], hashes[i])