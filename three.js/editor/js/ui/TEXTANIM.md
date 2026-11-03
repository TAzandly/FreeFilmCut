# 文字动画 (textanim v3) — Editor 预览

## 数据

- `fccUI.textAnim`，format `freecapcut.textanim/3`（读 `/2`）
- `components[]`：数组顺序 = 叠加顺序，每项
  `{ id, type, scope, enabled, params, channels, selector, suppressCharPose? }` —— **没有时间窗**
- descriptor 的 `category`：`in`（charIn / typewriter / wipeReveal）、`out`（charOut）、`loop`（wave / jitter / bend）
- `scope: 'char'` 出逐字 pose；`scope: 'text'` 不改字形，产出渲染 pass 指令
- 逐字错开 `selector`：`order / start / end / amount / delay / ease / seed`（AE Range 语义）；
  错开在**进度域**：第 r 个字从 `r·delay/(n-1)` 开始，窗口 `1-delay`
- v1 文档打开时自动迁移，原文保留在 `legacy`；`legacyRepaired` 保证 repairs 只跑一次

## 时间 = `.anim` 关键帧

文字动画的时间完全由文字自己的 `.anim` 片段驱动（动画编辑器 / Timeline 的 animation 轨道都走 `applyAnimToRoot`）。
路径（target = 文字 group uuid）：

| 路径 | 含义 |
|---|---|
| `textAnim.<compId>.progress` | 组件进度 0..1；**没有该轨道 = 1（停在终态）** |
| `textAnim.<compId>.enabled` | step，≥0.5 开 |
| `textAnim.<compId>.<param>` / `.<param>.0` / `.1` | 数值 / pair 两端（bool 按 0/1）；select / color 不可 K |
| `textAnim.<compId>.selector.start\|end\|amount\|delay` | 范围与错开 |

- 采样值写进 `ui/TextAnimOverrides.js`（按对象 WeakMap，**import 不带 `?v=`** 保证单例），含片段局部时间
  `time`，作为 wave / jitter 的时钟。没有新采样时保持上一次结果（与 UI 变换轨道一致）。
- `applyAnimToRoot` 处理某个目标前先清空它的覆盖值，所以删掉的轨道不会残留。
- 新建组件（`TextAnimKeys.addDefaultProgressKeys`）在动画面板播放头处写进度帧：in = 0→1 easeOut，
  out = 0→1 easeIn，loop = 单帧 1。删除组件时连带删除它的 `textAnim.<id>.*` 轨道。
- `/2` 的 `time` 由 `TextAnimKeys.migrateTextAnimTimesOn` 转成进度帧（clamp / infinite = 0→1，loop = 锯齿，
  pingpong = 三角，timeScale 缩放），原值存在 `anim.legacyTimes[compId]`。触发点：工程 clip 恢复后
  （`freecapcutAnimsChanged`）、`objectAdded`、侧栏选中文字；**加载过程中（`editor.isLoadingState`）不迁移**，
  否则写入的帧会被随后恢复的 clip 覆盖。
- 侧栏里已 K 的字段只读并标 ◆，值以关键帧为准。

## 模块

| 文件 | 职责 |
|---|---|
| `js/textanim/TextAnimRegistry.js` | descriptor 注册表（**字段白名单**，加新字段必须在这里登记，否则被丢） |
| `js/textanim/TextAnimBuiltins.js` | charIn / charOut / wave / bend / jitter / typewriter / wipeReveal |
| `js/textanim/TextAnimTypes.js` | 默认值 / 归一化 / v1 迁移 / legacy 修复 |
| `js/textanim/TextAnimEngine.js` | `sampleTextAnim(anim, charCount, { time, values }) → {charPoses, passOps, needsCharSplit}` |
| `js/ui/TextAnim.js` | 兼容壳（`sampleWipeRevealProgress(anim, opts)` / `sampleBendProgress(anim, opts)`） |
| `js/ui/TextAnimOverrides.js` | `.anim` 写入的按对象覆盖值 + 时钟 |
| `js/ui/TextAnimKeys.js` | 可 K 字段列表 / 轨道标签 / 默认进度帧 / `/2` 时间迁移 |
| `js/anim/AnimEase.js` | 关键帧缓动预设（linear / easeIn / easeOut / easeInOut / back / elastic / bounce / step） |
| `js/ui/TextGeomFx.js` | 文本级 pass：弯曲（顶点）+ 扫光（片元），注入 Troika 派生材质 |

## 弯曲 bend / 扫光 wipeReveal（材质内实现）

两者都在 `TextGeomFx.applyTextGeomFxInScene` 里，每帧在 `applyTextAnimsInScene` **之后**调用（要读已摆好的逐字矩阵）。
**不走 RT**：Overlay / SS-Camera 两种画布行为一致，Camera 后期（Bloom 等）照常作用于文字，可同时多个文字各自弯曲/扫光。

- 注入方式：给文字下每个 Troika 材质（各花字层、描边材质、逐字克隆）设 `onBeforeCompile`
  （troika DerivedMaterial 会在自己的 shader 注入**之后**调用它）+ 包一层 `customProgramCacheKey`（后缀 `|fccGeomFx1`）。
  uniform 按材质对象存 WeakMap（描边材质是 `Object.create(face)`，必须各自一份）。不往 userData 里塞函数/THREE 对象。
- **坐标系 = 文字根节点（fccUI text group）局部空间**。顶点先用 `uFccToRoot`（mesh→root 的局部矩阵链）转到根空间，
  记 `vFccRootPos`（**弯曲前**坐标），再弯曲、`uFccFromRoot` 转回。所以：
  - 逐字 wave / charIn 先移动字，弯曲再整体变形 → 两者叠加；
  - 扫光用弯曲前坐标算遮罩 → 刀口跟着字一起弯，不会是屏幕上的直线。
- 包围盒来自 Troika 排版 `textRenderInfo.visibleBounds`（逐字模式用隐藏的 `__fccTextAnimLayout`），外扩 max(2, 6%)。
  **不随逐字动画变化**，所以 wave 时弯曲中心 / 扫光刀口不抖。
- 弯曲期间 `glyphGeometryDetail = 6`（每字 49 顶点），否则字四角只有 4 个顶点，弯不出弧度；停止后恢复 1。
- 弯曲是伪透视：rotZ → 按 x 绕 Y / 按 y 绕 X 转入深度 → `F/(F-z)` 缩放 xy，z 不写回（不影响 UI 排序）。

### 扫光要点

- 进度语义：`progress 0 = 全隐`，`1 = 全显且没有刃光`。
  → **进度 0 和 1 都看不到扫光**，只有中间过程能看到；在动画编辑器里把播放头放在两帧之间看效果。
- `suppressCharPose`（UI 叫「独占显隐」）：开启后字形回到 rest pose + opacity 1，显隐完全由片元 reveal 控制。
  v1 是隐式行为（否则 stagger 淡入会盖住扫光），v2 改成实例开关，`wipeReveal` 默认开启。
- `invert: true` = 出场扫光（v1 的 out 相位扫光迁到这里）。
- Shader：u/v = 根空间坐标在包围盒内归一化并 clamp 到 0..1（描边/阴影超出包围盒的部分跟随边缘时刻）；
  LTR `mask=1-u`；`reveal=step(thresh, mask)`，soft 只拉宽填充衰减，不在字里挖洞。
- 每个花字层各自算遮罩，结果一致（同一套 uniform）。
- 刃光写进普通 8bit 帧缓冲，亮度封顶 1.0；TextFx 的 Bloom 阈值要低于 1 才能吃到刃光。

## 通道与参数

- `comp.channels` 是**实例上的开关表**，descriptor 只声明支持哪些通道（`channels`）+ 新建时默认开哪些（`defaultChannels`）。
- 参数键名以 descriptor `params` 为准，不是 UI 标签。例：wave 的 Y 振幅键是 `amp`（标签写「振幅Y」），X 是 `ampX`。

## 调试

- 侧栏「调试：显示扫光遮罩」→ `editor.textAnimWipeDebug` / config `sidebar/text/wipeDebug`
- 调试画面 = 每层文字×reveal 合成（非纯灰条）；青=刃光

## 缓存

模块 URL 带版本号，改文件必须同步 bump，否则浏览器吃旧缓存：

- `TextAnimRuntime.js` / `ui/TextAnim.js` / `TextGeomFx.js` / `TextAnimKeys.js` → `?v=fcc-ui-138`
  （同一模块所有 importer 必须用同一 URL，否则被加载两份）
- `TextLayerRT.js` → `?v=fcc-ui-137`
- `anim/FreeCapCutAnimCore.js` → `?v=fcc-anim-15`
- `js/textanim/*` → `?v=fcc-tanim-17`
- `TextAnimOverrides.js` / `AnimEase.js` 不带版本号（单例）
- 单测：`node --test three.js/editor/test/textanim-keys.test.mjs`
