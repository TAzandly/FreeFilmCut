# Flower packs (OpenCut Effects library)

Folder convention (under `freefilmcut/apps/web/public/flower/`):

```
flower/
  index.json                 # string[] of .vfxpack names (preferred) OR {version,packs:[...]}
  *.vfxpack                  # Editor art-text packs — loaded directly, no unpack required
  <packDir>/                 # optional legacy unzipped folder (flowerStyle.json + textures)
    cover_icon.png
    preview.gif
    flowerStyle.json
```

## Drop a `.vfxpack` (recommended)

1. Export from Editor (VfxPack / art-text) **or** File → Export Flower pack (folder zip).
2. Put the `.vfxpack` in:
   `freefilmcut/apps/web/public/flower/`
   Example: `freecapcut.testart.vfxpack`
3. List it in `index.json` as a string array (same as other pack libraries):

```json
[
  "freecapcut.testart.vfxpack"
]
```

4. Hard-refresh OpenCut → Assets → Text → **Effects**

OpenCut loads the zip in-browser (flowerStyle from `scene.json`, textures/poster as blob URLs). Running `node scripts/sync-flower-packs.mjs` is **optional** — only needed if you want on-disk extracted folders for tooling.

## Legacy: unpacked folders

`index.json` may still be `{ "version": 1, "packs": [ { "id", "name", "dir", "vfxpack?", "style?" } ] }` from sync. Folder `flowerStyle.json` remains a fallback when no `.vfxpack` is present.

## Export Flower pack (folder zip)

Menu **File → Export Flower pack** downloads a folder zip (`flowerStyle.json` layout).
Unpack so `<dir>/` lands under `public/flower/`, add the dir name to `index.json`, or convert to a `.vfxpack` via the Editor exporter.
