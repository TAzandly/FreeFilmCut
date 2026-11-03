# Text animation library (text-anim)

Phase folders (sibling to sticker-anims, separate pack type):

- `in/` → manifest.phase = `in`
- `out/` → manifest.phase = `out`
- `loop/` → manifest.phase = `loop`

Each folder's `index.json` is a string array of **.vfxpack filenames** (include the `.vfxpack` extension).

Editor: Project pack type **Text animation** → Export VfxPack (or File → Export Text Anim pack).

OpenCut: text clip → Animation → In / Out / Loop (textAnims, same idea as stickerAnims).
