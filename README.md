# FreeFilmCut

**[English](README.md)** | **[中文](README.zh-CN.md)**

**Free** browser-based video editing + VFX authoring. CapCut-style multi-track NLE, plus a Three.js asset editor that exports `.vfxpack` effect packs.

> Free to use. Questions / feedback? Join the QQ group:  
> [FreeFilmCut 交流群](https://qm.qq.com/q/MywTcYMNci)

---

## What’s in this repo

| Part | Path | Role |
|------|------|------|
| **NLE (editor / timeline)** | `freefilmcut/` | Multi-track cut, preview, export |
| **Asset editor** | `three.js/editor/` | Author effects / art text → export `.vfxpack` |
| **Bundled packs** | `freefilmcut/apps/web/public/vfxpacks/`, `.../flower/` | Sample stickers, transitions, effects, art text, etc. |

### Prerequisites

| Script | Needs |
|--------|--------|
| `start-filmcut.bat` (NLE) | Auto-installs Bun if missing; creates `apps/web/.env.local` from `.env.example` if missing; `bun install` when `node_modules` is absent |
| `start-asset-editor.bat` | Needs Python 3; will try **winget** install if missing |

### Quick start (Windows)

- NLE: `start-filmcut.bat` → http://localhost:3000  
- Asset editor: `start-asset-editor.bat` → http://localhost:5174/editor/  

First NLE run may take a while (`bun install` + Next.js).

Timeline text uses **Noto Sans SC** (`apps/web/public/fonts/NotoSansSC-Regular.ttf`, OFL). Microsoft YaHei (`msyh.ttf`) is **not** shipped (licensing); CSS aliases still map “微软雅黑 / Microsoft YaHei” to Noto so clones render CJK.

---

## NLE — what it is

A **web multi-track video editor**: timeline + preview + properties, oriented around short-form / CapCut-like workflows. Rendering uses **Three.js** compositing; many looks come from imported **`.vfxpack`** assets.

### Features (current direction)

- **Art text (花字)** — stylized titles from flower / text packs  
- **Art-text animation** — in / out / loop text anim packs  
- **Effects** — scene / clip effect packs (e.g. bokeh-style looks)  
- **Filters** — adjustment / filter packs  
- **Color grading** — grade controls on clips  
- **Chroma key (抠像)** — green-screen style keying  
- **Masks** — shapes, feather, invert, stroke  
- **Transitions** — pack-based transitions between clips  
- Stickers / sticker motion, clip animations, and more as packs grow  

Exact pack list ships under `public/vfxpacks/` and `public/flower/`.

---

## Asset editor — what it is

A customized **Three.js Editor** for building **reusable VFX resources**, not for cutting the final video.

### What you can do

- Build 3D / UI / shader scenes for effects, filters, stickers, text templates  
- Camera **post-process** stacks (bloom, film, FXAA, custom passes, …)  
- MediaPlayer / render textures as pack media inputs  
- Export **`.vfxpack`** for the NLE timeline  
- Preview packs the same way you’ll use them when cutting  

Docs: [docs/vfxpack-editor.md](docs/vfxpack-editor.md), [docs/postprocess-stack.md](docs/postprocess-stack.md)

---

## Roadmap

- More **community / first-party `.vfxpack`** libraries  
- **Beauty / body** tools (e.g. MediaPipe-assisted slim / retouch)  
- **Auto captions / subtitles**  
- Stronger particle tools for laser / particle-style packs  
- Keep improving free, open effect authoring → NLE playback  

---

## Thanks

FreeFilmCut stands on open source. Special thanks to:

- **[OpenCut](https://github.com/OpenCut-app/OpenCut)** / OpenCut Classic — NLE UI & timeline foundation  
- **[three.js](https://github.com/mrdoob/three.js)** — WebGL engine and the Editor we extend for `.vfxpack`  

Please respect their licenses when you redistribute or modify.

---

## Community

QQ group: [FreeFilmCut 交流群](https://qm.qq.com/q/MywTcYMNci)
