# Clip-anim slide packs + editor/runtime support

## Goal

Ship three builtin clip-anim vfxpacks and make clip-anim below-input / export first-class.

## Runtime

- `packNeedsBelowInput` includes `clip-anim` (default scope `below`).
- `load-pack` `defaultScopeForType('clip-anim')` → `below`.
- Compositor: clip-anim does **not** use the mesh-UV “keep backdrop” path (avoids double-draw during slides).

## Editor

- Pack type **Clip animation** / 片段动画; phase **In / Out / Combo**.
- Export confirm notes install path `vfxpacks/clip-anims/{phase}/`.

## Builtin packs

| Phase | Id | Motion |
|-------|-----|--------|
| in | `freecapcut.clip-anim.slide-left` | enter from left (0.5s) |
| out | `freecapcut.clip-anim.slide-left-out` | exit to left (0.5s) |
| combo | `freecapcut.clip-anim.left-then-down` | left then down (1s) |

Full-screen `uInput` quad + `uSlideX` / `uSlideY` anim. Library **poster.png** / **hover.gif** copied from sticker-anim swipe-left (same icons as before).

Rebuild: `node scripts/build-clip-anim-slide-packs.mjs` in `freefilmcut/apps/web`.
