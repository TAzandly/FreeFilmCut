# 文字动画 K 帧 + Timeline 驱动 — 设计

日期：2026-10-22 状态：待评审 范围：仅编辑器端（`three.js/editor`）

## 背景

- 文字动画 v2（`fccUI.textAnim`，`freecapcut.textanim/2`）每个组件自带 `time{start,duration,loop,timeScale}`，
  进度在时长内自动线性 0→1，参数是静态值 / `[from,to]` 区间，播放头是独立的 `editor.textAnimTime`。
- 动画编辑器（`.anim`，`freecapcut.anim/1`）能 K 物体变换、UI `ui.*` 变换、材质 uniform、后期参数，
  插值只有 `linear` / `step`；不认识文字动画。
- Timeline（`fccTimeline`）有 `activation / animation / video` 三种轨道，`animation` 轨道驱动 `.anim`，
  与 `editor.textAnimTime` 互不相通。

## 目标

1. 在动画编辑器里给文字的逐字 / 整体动画 K 帧：进度和参数都能 K，与文字的 `ui.*` 变换动画在同一个 `.anim` 片段里。
2. Timeline 的 `animation` 轨道能驱动文字动画（含波浪等连续动画的时钟）。
3. 为子项目 3（通用文字动画包，入场 / 出场 / 循环，给剪辑端用）定好数据接口。

非目标（本期不做）：剪辑端任何改动；动画包导出器与剪辑端播放器；贝塞尔曲线编辑器；THREE.AnimationClip 互转文字动画。

## 1. 数据模型

### 1.1 文字动画组件（`freecapcut.textanim/3`）

- 组件去掉 `time` 字段，保留 `id / type / scope / enabled / params / channels / selector / suppressCharPose`。
- 组件 `id`（如 `c_wave_1`）在同一文字内唯一且稳定，是 `.anim` 轨道路径的一部分；重命名 / 重排不改 id。
- descriptor 新增 `defaultDuration`（秒，已有字段沿用）与 `category: 'in' | 'out' | 'loop'`：
  `charIn / typewriter / wipeReveal → in`，`charOut → out`，`wave / jitter / bend → loop`。
  `category` 只用于新建时生成默认关键帧和子项目 3 的分类，不影响采样。

### 1.2 `.anim` 轨道（`freecapcut.anim/2`）

新增路径，目标为文字的 fccUI text group（`objectUuid`）：

| 路径 | 值 | 说明 |
|---|---|---|
| `textAnim.<compId>.progress` | 0..1 | 取代自动 0→1；char 组件经 selector 错开后得到每字权重 |
| `textAnim.<compId>.<param>` | number | 标量参数，如 `amp / freq / speed / bendY` |
| `textAnim.<compId>.<param>.0` / `.1` | number | `[from,to]` 成对参数的两端 |
| `textAnim.<compId>.selector.<field>` | number | `start / end / amount / delay` |
| `textAnim.<compId>.enabled` | 0/1 | step |

- 非数值参数（`direction / blendMode / order / ease` 等枚举）不可 K，仍在侧栏改。
- 关键帧格式 `{ t, v, ease? }`；`ease` 表示**本帧到下一帧**的曲线，取值
  `linear | easeIn | easeOut | easeInOut | back | elastic | bounce | step`，缺省 `linear`。
- 轨道级 `interp` 保留：`step` 等价于所有帧 `ease:'step'`；读取 `/1` 文件不需转换，写出统一为 `/2`。
- 缓动函数实现放在一个共享模块（`anim/AnimEase.js`），与 `TEXTANIM_EASES` 合并为同一份定义，
  剪辑端将来照抄这一个文件。

### 1.3 默认值与新建

- 某参数没有轨道 → 用组件 `params` 里的静态值（侧栏可改）。
- 组件没有 `progress` 轨道 → progress = 1（完全生效）。
- 侧栏新建组件时，在该文字的当前动画片段（`editor.activeFreecapcutAnim`；没有则新建一个并挂到该文字）
  里写入 `progress` 关键帧：
  - `in`：`t=当前播放头 → 0`，`t=播放头+defaultDuration → 1`，ease `easeOut`；
  - `out`：`t=播放头 → 0`，`t=播放头+defaultDuration → 1`，ease `easeIn`；
  - `loop`：只写 `t=播放头 → 1`。
- 删除组件时同时删除该片段里 `textAnim.<compId>.*` 的所有轨道。

### 1.4 旧文档迁移（`/2 → /3`）

打开时一次性执行，结果写回文档，原 `time` 保留在 `legacy.time[compId]`：

- `clamp`：`start → 0`，`start+duration → 1`，ease `linear`（与原来的自动进度一致；逐字缓动仍由 selector.ease 负责）。
- `loop` / `pingpong`：在片段时长内按周期展开为 0→1（loop 每周期末尾 `step` 回 0）或 0→1→0 的关键帧，最多展开到片段时长。
- `infinite`：单帧 `v=1`。
- `timeScale ≠ 1`：按比例缩放上述关键帧时间。
- 没有任何片段时新建一个名为 `<文字名>_textanim` 的片段并挂到该文字。

## 2. 运行时

### 2.1 覆盖表

- 新模块 `ui/TextAnimOverrides.js`：`WeakMap<Object3D, { time, values: Map<path, number> }>`。
  不写 `userData`（存档 structuredClone 约束），不改 `fccUI`。
- `applyAnimToRoot(root, clip, tLocal)` 遇到 `textAnim.*` 路径时：
  `setTextAnimOverride(obj, path, v)`，并记录 `setTextAnimClock(obj, tLocal)`（该对象当帧的片段局部时间）。
- 每帧开始（`applyAllEditorAnims` / Timeline `applySample` 之前）调用 `beginTextAnimOverrideFrame()`
  清空上一帧的值，保证删掉的轨道不会残留。

### 2.2 采样

- `sampleTextAnim(anim, charCount, { overrides, time })`：
  - progress / 参数 / selector 字段先查覆盖表，再落到组件静态值；
  - 连续动画（波浪相位、抖动种子推进）用 `time`（片段局部时间）；对象没被任何片段驱动时用 0（静止画面）。
- `TextAnimRuntime.applyTextAnimsInScene(scene)` 与 `TextGeomFx.applyTextGeomFxInScene(scene)` 去掉 `t` 参数，
  从覆盖表取时间与数值。视口每帧照旧调用，顺序不变（先逐字 pose，再弯曲 / 扫光）。

### 2.3 统一时钟

- 删除 `editor.textAnimTime`、`editor.advanceTextAnim`、项目存档里的 `textAnimPreviewTime`，以及侧栏的播放 / 拖动控件。
- 动画编辑器播放 / 拖动、Timeline 播放 / 拖动都通过 `applyAnimToRoot` 写覆盖表，因此 Timeline 的
  `animation` 轨道自动驱动文字动画，无需新增轨道类型。
- 两者同时开时沿用现有规则：`editor.timelinePreviewOwnsAnim` 为真时动画编辑器不采样。

## 3. 界面

### 3.1 动画编辑器（`Animation.js`）

- 选中文字时新增按钮 **文字动画关键帧**：弹出该文字所有组件的可 K 字段（按组件分组，显示中文标签，
  来自 descriptor `params` 的 `labelZh`），勾选后在当前播放头处各加一帧（值 = 当前覆盖值或静态值）。
- 轨道行标签显示为 `<组件中文名> · <参数中文名>`，而不是原始路径。
- 选中关键帧后，面板底部显示 **值** 与 **缓动** 下拉框（8 个预设）；`step` 帧在轨道上画成方块，其余菱形。
- 已有的 **添加关键帧**（变换）对文字照常可用（`ui.anchoredPosition / localEulerAngles / localScale`）。

### 3.2 文字动画侧栏（`Sidebar.Object.TextAnim.js`）

- 组件卡片去掉 开始 / 时长 / 循环 / 速率 字段与播放条。
- 卡片上被 K 的参数旁显示菱形标记，数值框只读并提示「已由关键帧控制」；未 K 的参数照常编辑静态值。
- 顶部按钮 **在动画编辑器中编辑**：打开动画面板并定位到该文字的片段。
- 「调试：显示扫光遮罩」保留。

## 4. 给子项目 3 预留的接口

动画包（暂定 `freecapcut.textanim-pack/1`，子项目 3 再细化）由一个文字的一个片段导出：

```json
{
  "format": "freecapcut.textanim-pack/1",
  "name": "弹跳入场",
  "category": "in",
  "duration": 0.8,
  "components": [ { "id": "c_charIn_1", "type": "charIn", "params": {}, "selector": {} } ],
  "tracks": [
    { "path": "textAnim.c_charIn_1.progress", "keys": [ { "t": 0, "v": 0, "ease": "back" }, { "t": 0.8, "v": 1 } ] },
    { "path": "ui.anchoredPosition.y", "relative": "add", "keys": [ { "t": 0, "v": -40, "ease": "easeOut" }, { "t": 0.8, "v": 0 } ] }
  ]
}
```

本期需要保证的约束：

- 组件定义不含时间，关键帧时间以片段起点为 0 —— 导出时无需换算。
- `ui.*` 轨道在编辑器里是绝对值；导出时减去文字静止值，标 `relative: add`（缩放为 `mul`），
  剪辑端叠加在片段自身变换上。
- 剪辑端播放语义（子项目 3 实现）：`in` 对齐片段开头、`out` 对齐片段结尾、`loop` 在片段内重复，
  时长可被用户拉伸（按比例缩放关键帧时间）。

## 5. 错误处理

- 轨道路径里的 `compId` 不存在（组件被删 / 改名）：采样时忽略，动画面板该行标红并提供「删除轨道」。
- 参数名不在 descriptor 白名单：忽略，同上标红。
- 覆盖值做与侧栏相同的 min/max 夹取；非有限数忽略。
- 迁移失败（异常数据）：保留原文档不动，控制台 warn，组件按「无 progress 轨道 → 1」显示。

## 6. 测试

- Node 单元测试（`_tanim_check` 同目录风格，纯 ESM 无 DOM）：
  - `AnimEase`：8 种缓动端点值与单调性（back/elastic 除外只测端点）；
  - `sampleKeys` 带 ease 的分段插值、`step`、单帧、越界；
  - `/2 → /3` 迁移：clamp / loop / pingpong / infinite / timeScale 生成的关键帧；
  - `sampleTextAnim` 覆盖表优先级（覆盖 > 静态值；无 progress → 1）。
- 浏览器验证（编辑器内脚本 + 截图）：
  - 动画编辑器 K 字逐字入场 progress + `ui.anchoredPosition.y`，拖动播放头画面与关键帧一致；
  - 同一片段挂到 Timeline 的 `animation` 轨道，Timeline 播放驱动文字动画（含波浪相位）；
  - 弯曲 + 波浪 + 扫光在 K 帧驱动下仍叠加正确；
  - 打开迁移前的旧工程，画面与迁移前同一时刻一致。

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `js/anim/AnimEase.js` | 新增：缓动预设 |
| `js/anim/FreeCapCutAnimCore.js` | `/2` 格式、带 ease 的 `sampleKeys`、`textAnim.*` 路径写覆盖表、帧开始清空 |
| `js/ui/TextAnimOverrides.js` | 新增：覆盖表与对象时钟 |
| `js/textanim/TextAnimTypes.js` | `/3` 格式、去 `time`、`/2→/3` 迁移 |
| `js/textanim/TextAnimRegistry.js` / `TextAnimBuiltins.js` | `category`，可 K 字段枚举 |
| `js/textanim/TextAnimEngine.js` | `sampleTextAnim` 读覆盖表与片段时间 |
| `js/ui/TextAnimRuntime.js` / `js/ui/TextGeomFx.js` / `js/ui/TextAnim.js` | 去 `t` 参数，读覆盖表 |
| `js/Animation.js` | 文字动画关键帧按钮、轨道标签、关键帧缓动下拉 |
| `js/Sidebar.Object.TextAnim.js` | 去时间字段与播放条，K 帧标记，跳转按钮 |
| `js/Viewport.js` / `js/Editor.js` | 去 `textAnimTime` 相关 |
| `js/timeline/FccTimelineEditor.js` | 采样前调用 `beginTextAnimOverrideFrame()` |
| `docs/animation-format.md` / `js/ui/TEXTANIM.md` | 文档更新 |
| `index.html` 与各 import | 缓存版本号 |
