# Timeline Clip Lane Drag/Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Unity-like clip blocks on Timeline tracks: drag to move, drag edges to resize; keep number inputs in sync.

**Architecture:** Extend `FccTimelineEditor.js` `rebuildTracksUI` with a per-track clip lane; shared `bindClipDrag` for move/left/right; reuse `snapTimeToFrame` and `commitAssetEdit`.

**Tech Stack:** Vanilla JS DOM in Three.js editor Timeline window.

**Spec:** `docs/superpowers/specs/2026-10-16-timeline-clip-lane-design.md`

---

### Task 1: Clip lane + drag/resize in FccTimelineEditor

**Files:**
- Modify: `three.js/editor/js/timeline/FccTimelineEditor.js`
- Bump import cache to `?v=fcc-ui-35` in `index.html` for FccTimelineEditor if present

- [ ] Add LANE_H, clip drag state, timeToX/xToTime, layoutClipBlock, bindClipDrag
- [ ] In rebuildTracksUI: after track header, add clip lane with absolute blocks for all track types
- [ ] Keep existing number rows; onChange updates clip + layoutClipBlock
- [ ] document mousemove/mouseup handle clip drag (mutex with scrub/win drag)
- [ ] Increase WIN_H slightly (e.g. 380)
- [ ] Commit on three.js `dev`

---

### Task 2: Manual smoke

- [ ] Open Timeline, add Animation/Video/Activation clips, drag move + edges, verify numbers sync and sample follows
