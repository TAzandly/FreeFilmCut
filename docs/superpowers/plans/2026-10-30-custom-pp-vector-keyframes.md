# Custom PP vector k-frames + editor per-param PP keys

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** NLE whole-vector keyframes for vec2/3/4; editor per-param PP diamonds mutually exclusive with「剪辑端」; remove bulk PP key button.

**Architecture:** Editor diamonds write `postProcess.{effectId}.{param}` via FreeCapCutAnimCore. NLE adds `ParamValue=number[]` + composite vector channels (like color). Exporter emits vec types.

**Tech Stack:** three.js editor ES modules; OpenCut TS params/animation/vfxpack.

## Tasks

- [x] Spec doc
- [x] Editor: FreeCapCutAnimCore helpers + remove Animation PP button + Sidebar diamonds
- [x] Exporter schemaTypeOf vec2/3/4
- [x] NLE ParamValue/vector layout/resolve/UI/mergeLiveParams/exposed mapping
- [x] Smoke: vector-related tsc paths clean (repo has unrelated pre-existing errors)
