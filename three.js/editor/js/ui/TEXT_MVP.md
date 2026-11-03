# Text MVP

1. Add -> UI -> Text (under Canvas)
2. Select Text: edit text / fontSize / bold / color / spacing / align / outline / shadow
3. Font: click **文件** to pick local TTF/OTF/WOFF (NOT paste C:\... path — browser cannot fetch absolute FS paths)
4. Picker stores blob: URL + ArrayBuffer for vfxpack embed (editor._fccFontBytes)
5. With a **bound project folder**, the font is also copied to `assets/fonts/` (`fontProjectPath`)
6. Default font: CDN Noto Sans SC (needs network). Offline: use 文件, or change DEFAULT_TEXT_FONT_URL
7. Hard refresh `?v=fcc-ui-18`

## Reopen project (fonts)

- `blob:` URLs die after reload. On `fromJSON`, `restoreUITextFontsFromProject` rebuilds them from `fontProjectPath` / `assets/fonts/{fontFileName}`.
- Save (File → Save) also runs `flushUITextFontsToProject` so fonts are on disk before `project.json` write.
- Custom fonts without a project folder cannot survive reload — re-pick via **文件**, or bind a folder and Save once.

## Export
- Re-export .vfxpack; custom fonts go to pack/fonts/

## Notes
- Bold prefers Bold font file (`fontBold`); checkbox alone may not fake-bold
- Troika: no WOFF2
- Multi outline/glow later via Effect stack


## FlowerStyle P1

See FLOWER_P1.md — multilayer 描边/投影 + solid/linear gradient via Effect stack.
Hard refresh `?v=fcc-ui-56`.

## Text → RT → composite (Step-1)

- OpenCut: all timeline TextNode (plain + flower) share `vfxpack/text-layer-rt.ts` → RT (stencil on) → alpha blit. Frame item type remains `flowerText`.
- Editor: View →「文字层 RT 预览」optional path via `ui/TextLayerRT.js` (default viewport still direct overlay).
- Step-2: `fccUI.textFxStack` uses the **same Registry** as camera PP (`invert` / `bloom` / …) via `buildTextureFxComposer` after Text RT — not camera postProcessStack.
- Editor: select Text → sidebar「文字后处理 Fx」→ Add Invert；视口自动走 RT→Fx（或 View→文字层 RT 预览）。
- Multi outline/glow later via Effect / TextFx stack (quality ≠ stroke count).
