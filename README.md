# FreeFilmCut

**[English](README.md)** | **[中文](README.zh-CN.md)**

Free CapCut-style **video editor** in the browser — multi-track timeline, preview, export.  
Also ships a Three.js **asset editor** to build `.vfxpack` effects for the NLE.

**Online demo:** [free-film-cut.vercel.app](https://free-film-cut.vercel.app)

---

## Demo video

NLE walkthrough (timeline / preview / packs):

[![FreeFilmCut NLE Demo](https://img.youtube.com/vi/QRCSDf3mw9k/hqdefault.jpg)](https://youtu.be/QRCSDf3mw9k)

https://youtu.be/QRCSDf3mw9k

---

## What’s inside

| | Path | What it does |
|---|------|----------------|
| **NLE** | `freefilmcut/` | Cut, preview, export |
| **Asset editor** | `three.js/editor/` | Author effects / art text → `.vfxpack` |
| **Sample packs** | `freefilmcut/apps/web/public/vfxpacks/`, `flower/` | Stickers, transitions, effects, art text… |

### Quick start (Windows)

- NLE: `start-filmcut.bat` → http://localhost:3000  
- Asset editor: `start-asset-editor.bat` → http://localhost:5174/editor/  

`start-filmcut.bat` installs Bun if needed and runs `bun install` on first launch.  
Asset editor needs Python 3 (script can install via winget).

---

## NLE highlights

Web multi-track editor with Three.js compositing and pack-driven looks:

Art text · text anim · effects · filters · color grade · chroma key · masks · transitions · stickers · **face beauty** (smooth / whiten / eye enlarge / face slim / V-face / nose slim) · **auto captions** (in-browser Whisper) & more

Beauty runs in the browser (MediaPipe landmarks + DLMV skin segmentation, GPU warp/smooth/whiten). Models download on first use when missing — see [`freefilmcut/apps/web/public/models/beauty/README.md`](freefilmcut/apps/web/public/models/beauty/README.md).

Auto captions run locally via Whisper (transformers.js); open the **Captions** panel to generate subtitle clips on the timeline.

---

## Asset editor

Build reusable VFX (not for final cuts): scenes, post-process stacks, MediaPlayer inputs → export `.vfxpack` into the NLE.

Docs: [vfxpack-editor](docs/vfxpack-editor.md) · [postprocess](docs/postprocess-stack.md)

---

## Roadmap

More `.vfxpack`s · body reshape · stronger particles · keep the make-pack → cut loop free and smooth

---

## Community

- **Discord:** [Join](https://discord.gg/QmNQBrtXrU)  
- **QQ:** [FreeFilmCut 交流群](https://qm.qq.com/q/MywTcYMNci)

---

## Thanks

- [OpenCut](https://github.com/OpenCut-app/OpenCut) — NLE foundation  
- [three.js](https://github.com/mrdoob/three.js) — WebGL + Editor we extend for `.vfxpack`

---

## License & disclaimer

This repository includes and depends on third-party software, models, and assets under **their own licenses** (for example OpenCut / three.js MIT terms, MediaPipe Apache-2.0, Whisper / transformers.js model terms, and the DLMV skin model under **GPL-3.0**). See the corresponding LICENSE files and model READMEs.

**Commercial use:** If you use this project (or any bundled / auto-downloaded dependency) for commercial purposes, you **must** review and comply with all applicable licenses, attribution, and redistribution requirements yourself.

**No liability:** This software is provided as-is for learning and experimentation. The author accepts **no responsibility** for any legal claims, damages, or other liability arising from your use, redistribution, or commercial deployment of this project or its dependencies. Any legal risk is yours alone.
