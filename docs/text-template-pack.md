# Text-template pack export / OpenCut library

Date: 2026-10-23

## Pack type

**`text-template`**, folder (sibling to `text-anims/`):

```
public/vfxpacks/text-templates/
```

`index.json` is a string array of **.vfxpack filenames** (must include the `.vfxpack` extension).

## Schema (`freecapcut.text-template/1`)

Stored as `manifest.textTemplate` and also as `pack/text-template.json`.

| Field | Notes |
|---|---|
| `text` | Full text content: content, font, fontSize, color, letterSpacing, align, outline, shadow, … |
| `flowerStyle` | Optional flower / art-text Effect stack (textures under `pack/textures/`) |
| `flowerBaseFontSize` | Optional design font size for flower rescale |
| `textAnim` | Optional embedded `freecapcut.textanim-pack/1` (components + tracks) from the authored text |
| `animRefs` | Optional `{ in, out, loop }` pack-id refs (stub-friendly; clip may resolve later) |
| `postProcess` / `textFxStack` | Optional PP / text Fx stack (Bloom / Deep Glow, …) |
| `stickers` | Optional `fccUI.textStickers` (glyph AABB follow) + textures under `pack/textures/` |
| `mediaPlayers` | Optional MediaFramePlayers (`gif` / `imageSequence` / `video`) with `path`, `playbackRate`, `targetUuid`, …; files under `pack/media/`, `pack/sequences/`, `pack/videos/` |
| `mediaAssets` | Flat list of packed media relative paths |
| `background` / `output` | Authoring beauty clear + toneMapping snapshot |

Manifest: `type: "text-template"`. **Not** `text-anim`, **not** `art-text` / flower-only.

## Editor export

1. Project → Pack type **Text template**
2. Select a Text object (flower / anim / PP optional)
3. File → Export VfxPack (or Export Text Template pack) / Sidebar Export VfxPack
4. Place under `text-templates/` and list `name.vfxpack` in `index.json`

## OpenCut discovery

Startup `loadBuiltinVfxPacks` loads `text-templates/`. Packs appear under Assets → Text → **Text templates**.

Applying full look (flower + anim + PP) to a timeline clip may still be partial in early slices; recognition and listing are required.

## Not loading checklist

1. `manifest.type` must be `text-template`
2. Folder must be `text-templates/` (ASCII)
3. `index.json` entry must include `.vfxpack`


## Legacy / wrong-exporter recovery (fcc-tl-flower-14 / fcc-ui-192)

If a `.vfxpack` has `manifest.type: "text-template"` but **no** `manifest.textTemplate` and **no** `pack/text-template.json` (typical when the pack was built by the generic **VfxPackExporter** — check `meta.generator`), the clip loader now **synthesizes** the payload from `scene.json`:

- Text `fccUI` → content, flowerStyle, stickers, embedded textAnim
- `fccVideoPlayer` nodes → mediaPlayers (paths matched by uuid prefix under `media/` / `sequences/` / `videos/`)
- Material stickers whose `map` is `rt:{targetUuid}` → sprite + `texturePackPath` of that media player (live rebind)
- Camera `postProcess` / `textFxStack` → clip `textFxStack`

**Clip (fcc-tl-flower-17 / fcc-ui-195):** embedded `textAnim` auto-registers as a virtual text-anim pack and fills `element.textAnims`. Progress tracks are merged from `animations/*.anim` when missing. Text-template property panel has **no** Animation tab. Shader stickers use kept `materialsMap`; scene props (Box/Cube) grafted without disposing their geometry/materials.

Generic VfxPackExporter now **throws** if `type=text-template` — use File → Export Text Template / Project pack type **Text template**.

## Stickers (`fccUI.textStickers` / `textTemplate.stickers`)

Single placement mode per sticker:

1. Pick glyph: `first` | `last` | `index` (+ `charIndex`)
2. Cover that glyph AABB with `scaleX` / `scaleY` (may be >1)
3. Local `offsetX` / `offsetY` (project px) + `rotation` (radians)
4. Each frame follows posed char matrix when `followCharAnim` (default true)
5. `sort` — higher draws later within the same `layer`
6. `layer`: `behind` (default, under text) | `front` (over text). Does not reorder text↔effect/flower.
7. `material`: `sprite` (implemented) | `shader` (stub — sprite for now)

Field list and runtime: `three.js/editor/js/ui/TextStickers.js` (header comment).
Editor UI: sidebar **贴纸跟随** / Text stickers under Text properties.


## Media (GIF / sequence) + stickers verify

1. Editor: author Text with **贴纸跟随** + scene MediaFramePlayer(s) (GIF and/or sequence) bound / playing into RT if needed.
2. Project → Pack type **Text template** → Export VfxPack / Export Text Template. Confirm alert lists Stickers / Media yes.
3. Copy `.vfxpack` into `freefilmcut/apps/web/public/vfxpacks/text-templates/` and add the filename to `index.json`.
4. Hard-refresh OpenCut → Assets → Text → **Text templates** — pack appears.
5. Add / drag onto timeline: toast shows content · stickers · media counts; clip stores `textStickers` + `textTemplateMediaPlayers` (paths remapped to pack objectUrls).
6. **Clip timeline (fcc-tl-flower-14):** stickers AABB follow + MediaFrame→RT live playback are wired. Scene-only packs without `textTemplate` are recovered on load. Embedded textAnim auto-assigns to `textAnims` (no Animation panel UI on text-template clips).

## Clip playback (fcc-ui-192 / fcc-tl-flower-13)

- **Stickers**: `text-stickers.js` (editor TextStickers port). Compositor calls `applyTextStickersInScene` each flowerText frame after text-anim pose; letter modes use square AABB (`max(w,h)`); `all` uses whole-text AABB; behind/front roots + depth contract; front stickers presented after text RT blit.
- **Media**: `text-template-media.ts` prepares gif/seq/video from the source pack into RTs (`preparePackVideos` / `seekPackTimelineVideo` / `syncPackVideos`). Timeline `clipLocalTime` + `playbackRate` drive sampling; gif/seq keep alpha on RT. Optional full-text vis planes show media when no materials sample the RT. Sticker textures whose `texturePackPath` matches a live gif/seq player rebind to the sampled frame texture.
- **fcc-tl-flower-15**: textAnim auto-assign (no Animation tab on text-template); shader stickers via materialsMap; scene prop meshes (Cube/Box) grafted + perspective blit. Text-template exporter embeds `scene.json` for props.



## Clip playback parity (fcc-tl-flower-17 / fcc-ui-195)

User report (hello): sequence not playing; first-letter sticker follow wrong. **`cdn.databuddy.cc/databuddy.js` timeout is unrelated** (analytics; does not load pack media).

Root causes + fixes:

1. **First-letter sticker AABB** — When clip textAnim is active, originals are parked under `__fccTextAnimPark`. `text-stickers.js` `findLayoutSourceTroika` only looked at direct children → `glyphBounds` missing → fallback centered fontSize box (follow "not on first letter"). Now searches the park (same as `clip-char-sync`). Also pin `fontUrl: /fonts/msyh.ttf` on synthetic fccUI (hello pack `fonts/` dir empty; editor authored against msyh).
2. **Image sequence not advancing** — `prepareTextTemplateMediaOnRoot` did not pass `frameNames` into `fccVideoPlayer`; `ensurePackSeqFrame` only read `pack.files` with a typeless Blob (can fail decode). Now: pass `frameNames`, honor them in `preparePackVideos`, PNG/JPEG MIME on Blob, objectUrl fetch fallback, normalize trailing-slash paths for sticker `texturePackPath` ↔ player `path` bind. Drive media **before** sticker apply each frame so RT has a live sample.

Retest: hard-refresh OpenCut → Assets → Text templates → re-drag **hello** → play/scrub. Seq sticker (behind, char=all) should animate; front GIF sticker should sit on **H** and follow char anim. No pack re-export required.

## Clip playback parity (fcc-tl-flower-16 / fcc-ui-194)

Root causes fixed so **hello** (and other generic-exporter text-templates) match the editor:

1. **Wipe + per-char textAnim** — Generic `VfxPackExporter` left `textAnim.*.progress` only in `animations/*.anim`. Clip `TextAnimEngine` defaults missing progress to **1** (end state) → no wipe / no charIn. Runtime now merges those tracks via `enrichTextAnimWithPackTracks` when synthesizing / applying. Prefer **Export Text Template** which embeds tracks in `textTemplate.textAnim`.
2. **Shader stickers + Cube** — `graftTextTemplateSceneProps` used to `disposeBuiltPackScene` which disposed materials/geometries still referenced by stickers and stolen Box meshes. Graft now keeps those disposables alive.
3. **Image sequence / GIF → RT** — mediaPlayers paths + `frameNames` are written into rebuilt hello; clip `text-template-media` seeks by timeline `clipLocalTime` + `playbackRate` into RTs that sticker shader `map` / `fccRtSlots` sample.

**hello pack** under `public/vfxpacks/text-templates/freecapcut.hello.vfxpack` was rebuilt with `manifest.textTemplate` + `text-template.json` (tracks + mediaPlayers + stickers). Hard-refresh OpenCut, re-drag hello — no editor re-export required for this file. Future packs: still use **Export Text Template**.


## Clip parity — camera / PP / sequence (fcc-tl-flower-21 / fcc-ui-198)

### Camera + post-process

- Editor text-templates author a **PerspectiveCamera** (FOV/near/far/pose) with **camera PP tracks** in `animations/*.anim` (e.g. `postProcess.<bloomId>.strength`).
- Clip previously forced an **ortho** beauty cam for flower textanim-PP, so perspective/Cube framing did not match; static `postProcess.strength=0` also hid bloom unless anim tracks were sampled.
- **Now:** when the grafted pack camera is a `PerspectiveCamera`, beauty uses that camera (aspect = project res). `prepareCameraModeUI` + `planeDistance=100` places the synthetic canvas like the editor SS-camera path.
- **PP sampling:** `samplePackAnimPostProcess` reads `postProcess.*` keys from pack `.anim` files against **clip-local time** (not only active textAnim phase). Hold-gap after In still keeps the stack alive. `enrichTextAnimWithPackTracks` no longer early-returns when progress tracks already exist (camera PP tracks still merge).

### Sequence frames (architecture)

- Editor contract: timeline `seekMediaFrame` → `sampleMediaFrameSync` → blit → RT → sticker/`fccRtSlots`.
- Clip mirrors that in `pack-video` / `text-template-media` (`driveTextTemplateMedia`). Flower-19 canvas-first sticker bind was the wrong priority for authored `map: rt:{uuid}` materials — **RT-first** bind restored.
- Auto **media vis planes** for sticker-owned RTs were stacking full-text quads and freezing/hiding seq playback; those planes are skipped when a sticker already owns `rtTargetUuid`.
- ≤120 frames still warm full-decode as a prepare aid; runtime remains seek→sample→blit→RT. Frames 0–4 of hello are identical — motion is obvious after ~0.16s / scrub.

### Re-export?

- **hello: no.** Existing `freecapcut.hello.vfxpack` already has camera, PP anim, seq `frameNames`, and stickers.
- Future packs: still use **Export Text Template** (not generic VfxPack) so `textTemplate` + embedded tracks ship correctly.

### Retest

1. Hard-refresh OpenCut; remove old hello clip; drag from **Assets → Text → Text templates**.
2. Play (not only scrub): bloom should pulse in the first ~0.5s; Cube/perspective should match editor; behind seq sticker should advance after the identical head frames.
3. Console: only warn on real seq misses (`[vfxpack] seq sample miss …` / full-decode holes).
