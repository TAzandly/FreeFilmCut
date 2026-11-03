# 文字动画 K 帧 + Timeline 驱动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文字动画组件去掉时间窗，进度 / 参数 / 选择器由 `.anim` 关键帧（带缓动预设）驱动，动画编辑器与 Timeline 共用这一套。

**Architecture:** `.anim` 新增 `textAnim.<compId>.*` 路径；`applyAnimToRoot` 把值写进按对象的运行时覆盖表（WeakMap，含片段局部时间）；`sampleTextAnim` 从覆盖表读进度 / 参数 / 时钟。旧文档的 `time` 在编辑器层一次性转成关键帧。

**Tech Stack:** 原生 ES modules（three.js editor），Node `node:test` 跑纯逻辑测试，浏览器内脚本 + 截图做集成验证。

Spec: `docs/superpowers/specs/2026-10-22-textanim-keyframes-design.md`

## 与 spec 的两处细化

- 覆盖表不做「每帧清空」：`applyAnimToRoot` 在处理某个目标对象前，先清空该对象的覆盖值再写入（按对象清空）。没有片段在采样时，画面保持最后一次采样结果，和 UI 变换轨道的行为一致。
- 旧 `infinite` 模式迁移成与 `clamp` 相同的 0→1 关键帧：原来 infinite 本身就是在 duration 内渐入再保持，波浪的持续运动由时钟负责，所以等价。

## 文件结构

| 文件 | 职责 |
|---|---|
| `js/anim/AnimEase.js`（新） | 8 个缓动预设 `ANIM_EASES`、`applyAnimEase(name, u)` |
| `js/ui/TextAnimOverrides.js`（新，**不带 ?v= 导入**，保证单例） | `beginTextAnimTarget(obj, time)`、`setTextAnimOverride(obj, sub, v)`、`getTextAnimSampleOpts(obj)` |
| `js/anim/FreeCapCutAnimCore.js` | `/2` 格式、key `ease` 读写、`sampleKeys` 走缓动、`textAnim.*` 写覆盖表 |
| `js/textanim/TextAnimRegistry.js` / `TextAnimBuiltins.js` | 实例不再带 `time`；descriptor 加 `category`；可 K 字段枚举 `listKeyableFields(desc, comp)` |
| `js/textanim/TextAnimTypes.js` | `/3` 格式；`time` 只在存在时保留（待迁移）；`timeToProgressKeys(time, horizon)` |
| `js/textanim/TextAnimEngine.js` | `sampleTextAnim(anim, charCount, { time, values })`、`sampleTextPassOps(anim, opts)`；进度域错开 |
| `js/ui/TextAnimKeys.js`（新） | 编辑器层：可 K 列表、轨道标签、新建组件默认关键帧、删组件删轨道、旧 `time` 迁移 |
| `js/ui/TextAnim.js` / `TextAnimRuntime.js` / `TextGeomFx.js` | 去掉 `t` 参数，读覆盖表 |
| `js/Animation.js` | 「文字动画关键帧」下拉、轨道中文标签、选中关键帧的值 / 缓动编辑、step 帧方块 |
| `js/Sidebar.Object.TextAnim.js` | 去时间字段 / 播放条；K 帧参数只读 + ◆；跳转动画编辑器 |
| `js/Viewport.js` / `js/Editor.js` | 去 `textAnimTime` / `advanceTextAnim` / `textAnimPreviewTime`；每帧调用迁移检查 |
| `test/textanim-keys.test.mjs`（新） | 纯逻辑单测 |

## Tasks

### Task 1: 缓动预设 + 关键帧缓动采样

- [ ] 测试：`applyAnimEase` 端点（0→0、1→1）、`easeIn(0.5)<0.5`、`easeOut(0.5)>0.5`、`step(0.99)=0`；`sampleKeys` 带 `ease` 的分段、单帧、越界、轨道级 `interp:'step'`。
- [ ] 实现 `AnimEase.js`：linear / easeIn(cubic) / easeOut(cubic) / easeInOut(cubic) / back(easeOutBack) / elastic(easeOutElastic) / bounce(easeOutBounce) / step(0 until 1)。
- [ ] `sampleKeys(keys, t, interp)`：段内 `u` 先过 `applyAnimEase(a.ease || (interp==='step'?'step':'linear'), u)`。
- [ ] `normalizeTrack` / `serializeAnimClip` / `extractObjectTargetFromClips` 保留合法 `ease`；`ANIM_FORMAT = 'freecapcut.anim/2'`。
- [ ] `upsertKey(track, t, v, eps, ease)` 可选第 5 参数。

### Task 2: 覆盖表 + 核心路径

- [ ] 测试：`applyAnimToRoot` 对 `textAnim.c1.progress` 写入后 `getTextAnimSampleOpts(obj)` 得 `{ time, values.get('c1.progress') }`；第二次采样不含已删轨道。
- [ ] `TextAnimOverrides.js`：WeakMap `{ time, values: Map }`。
- [ ] `applyAnimToRoot`：目标含 `textAnim.` 轨道时先 `beginTextAnimTarget(obj, tc)`，每条 `textAnim.*` 轨道 `setTextAnimOverride(obj, path.slice(9), v)`。

### Task 3: 数据模型 /3

- [ ] 测试：`normalizeComponentInPlace` 不再生成 `time`，已有 `time` 原样保留；`createDefaultComponent` 无 `time`；`timeToProgressKeys` 对 clamp / infinite / loop / pingpong / timeScale 的输出。
- [ ] Registry：`createTextAnimInstance` 去 `time`；Builtins 每个 descriptor 加 `category`（charIn/typewriter/wipeReveal: in；charOut: out；wave/jitter/bend: loop）。
- [ ] Types：`TEXTANIM_FORMAT='freecapcut.textanim/3'`，接受 `/2`；`timeToProgressKeys(time, horizon)`。

### Task 4: 采样引擎

- [ ] 测试：无覆盖 → progress=1（charIn 字在静止位）；覆盖 `c.progress=0` → charIn 首字 opacity=0；`c.params.amp` 覆盖生效（`c.amp`）；pair `c.offsetY.0`；selector `c.selector.delay`；进度域错开与旧时间域公式一致。
- [ ] `resolveComp(comp, values)` → `{ progress, params, selector, enabled }`；`charRaw(P, rank, n, delay)`。
- [ ] `sampleTextAnim(anim, charCount, opts)` / `sampleTextPassOps(anim, opts)`；删除 `textAnimTimelineEnd`、`localTime`、`componentProgress`。

### Task 5: 编辑器层 `TextAnimKeys.js`

- [ ] `listTextAnimKeyPaths(object)` → `[{ path, label, value, interp? }]`（progress、number 参数、pair 两端、selector 四字段、enabled(step)）。
- [ ] `textAnimTrackLabel(object, path)`、`findTextAnimTrack(editor, uuid, path)`。
- [ ] `addDefaultProgressKeys(editor, object, comp, t0)`、`removeTextAnimComponentTracks(editor, uuid, compId)`。
- [ ] `migratePendingTextAnimTimes(editor)`：遍历 UI 文字，组件有 `time` → 写关键帧（`ensureObjectAnimClip`）→ `anim.legacyTimes[compId]=time` → 删 `time`。

### Task 6: 运行时接线

- [ ] `TextAnim.js`：`sampleWipeRevealProgress(anim, opts)`、`sampleBendProgress(anim, opts)`。
- [ ] `TextAnimRuntime.applyTextAnimsInScene(root)` / `applyTextAnimAtTime(group, rect)` 用 `getTextAnimSampleOpts(group)`。
- [ ] `TextGeomFx.applyTextGeomFxInScene(root, opts)` 同上。
- [ ] `Viewport.js`：去 `advanceTextAnim`；render 内 `migratePendingTextAnimTimes(editor)` → `applyTextAnimsInScene(scene)` → `applyTextGeomFxInScene(scene, {...})`。
- [ ] `Editor.js`：去 `textAnimPreviewTime` 读写。

### Task 7: 动画编辑器 UI

- [ ] 「文字动画关键帧」下拉（选中 UI 文字时启用；选项来自 `listTextAnimKeyPaths`；选中即在播放头加帧）。
- [ ] 轨道标签：`textAnim.*` 用 `textAnimTrackLabel`；路径失效时标红 + title 提示。
- [ ] 关键帧检查器：单选时显示「值」UINumber 与「缓动」UISelect，修改后写回并 `applyAndRefresh()`。
- [ ] `step` 帧画方块；`editor.applyAnimPreview = applyAndRefresh`。

### Task 8: 侧栏

- [ ] 删除时间行 / 播放按钮 / 组件时间字段 / `LOOP_LABELS`。
- [ ] 新建组件调用 `addDefaultProgressKeys`（播放头取 `editor.getAnimPreviewTime()`），删除组件调用 `removeTextAnimComponentTracks`。
- [ ] 被 K 的数值框只读 + ◆ 前缀；按钮「在动画编辑器中编辑」。

### Task 9: 缓存版本 + 文档 + 验证

- [ ] 全局替换 `fcc-tanim-16 → fcc-tanim-17`、`TextAnim.js?v=fcc-ui-136 → 138`、`TextAnimRuntime.js?v=fcc-ui-136 → 138`、`TextGeomFx.js?v=fcc-ui-137 → 138`、`FreeCapCutAnimCore.js?v=* → fcc-ui-138`、`Viewport.js` index 版本。
- [ ] `node --check` 全部改动文件；`node --test test/`。
- [ ] 浏览器：K charIn progress + `ui.anchoredPosition.y`；Timeline animation 轨道驱动；弯曲 + 波浪 + 扫光；旧工程迁移。
- [ ] 更新 `TEXTANIM.md`、`docs/animation-format.md`。
