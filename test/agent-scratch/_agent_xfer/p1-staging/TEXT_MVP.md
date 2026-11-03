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
