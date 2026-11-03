# Text-anim pack export / OpenCut library

Date: 2026-10-22 (updated: English folders in/out/loop; pack PP; no flowerStyle)

## Pack type

**`text-anim`**, folders:

```
public/vfxpacks/text-anims/in/
public/vfxpacks/text-anims/out/
public/vfxpacks/text-anims/loop/
```

Each folder has `index.json` — a string array of **.vfxpack filenames** (must include the `.vfxpack` extension).

## Schema (`freecapcut.textanim-pack/1`)

| Field | Notes |
|---|---|
| `components` / `tracks` | Text anim components + `textAnim.*` / `ui.*` keys |
| `postProcess` | Optional camera PP snapshot (Bloom / Deep Glow, …) |
| flowerStyle | **Forbidden** — clip keeps its own flower template |

Manifest: `type: "text-anim"`, `phase`/`textAnim.category` = `in`|`out`|`loop`.

## Output toneMapping contract (editor <-> clip)

- **Bloom does not require tone mapping.** UnrealBloom samples linear beauty;
  tonemap (Neutral/ACES/…) only rolls off HDR peaks at OutputPass. If beauty
  peaks are already ≤1, **none + Bloom is a valid authoring mode** (OutputPass
  only does sRGB encode).
- **Exporter** writes live Config / Viewport `toneMapping` into `pack.output`
  (`TextAnimPackExporter.collectAuthoringOutput`). Authors may tune Bloom under
  **`none`**.
- **Both editor and clip**: when OutputPass toneMapping is `NoToneMapping`
  (`none`), insert **LDR pre-bloom clamp** (RGB → [0,1]) immediately before
  bloom/deepGlow so wipe `edgeIntensity` spikes cannot explode the halo.
  Neutral/ACES packs **skip** the clamp and keep HDR bloom.
- **Clip text-anim PP** uses `resolvePackOutputToneMapping` — pack `none` stays
  `NoToneMapping`. **No** silent none→Neutral remap.
- **Bloom RT size** = authored project / safe-frame resolution (`resW×resH`), not
  the preview undersampled compose buffer (texel-relative kernels).
- **Do not** double-apply `straightAlphaFromPremul` on the text-anim PP→layer blit
  when transparentClear already converted composer→ppRT.

## Editor export

1. Project → Pack type **Text animation**, Phase in/out/loop
2. Select Text with text-anim components
3. File → Export VfxPack (or Export Text Anim pack) / Sidebar Export VfxPack
4. Place under `text-anims/<phase>/` and list `name.vfxpack` in `index.json`

## OpenCut apply

Text clip → **Animation** → **In / Out / Loop** (English UI, same pattern as sticker-anim).

Compose: flower from clip → apply text-anim pack → Text RT → merge pack `postProcess` into textFx → blit.

## Not loading checklist

1. `manifest.type` must be `text-anim` (not `effect`)
2. Folder must be `in`/`out`/`loop` (ASCII)
3. `index.json` entry must include `.vfxpack`
4. Pack `phase`/`category` must match the Animation tab

## Verify

Hard-refresh OpenCut → text clip → Animation → In → see **sweep** → apply / play.
