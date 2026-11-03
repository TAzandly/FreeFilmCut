# 文字动画 v2 — 组件化 + 关键帧 重构方案

> 目标：文字动画从"一张固定 schema（in/out + 固定通道 + 3 个 modulator）"改成 **AE 式可添加组件栈**，
> 并且每个组件参数都能在动画编辑器里 k 帧。
> 现有实现：`js/ui/TextAnim.js`（数据/采样）、`js/ui/TextAnimRuntime.js`（逐字 Troika 预览）、
> `js/Sidebar.Object.TextAnim.js`（侧栏）、`js/Viewport.js` L1414-1510（整文 wipe 段）、`js/ui/TextLayerRT.js`。

---

## 0. 先定三条硬约束（都是踩过的坑）

| 约束 | 原因（实测） |
|------|--------------|
| **组件必须是纯数据 + 纯函数，禁止往 `userData` 塞函数/闭包** | `chainTroikaBeforeRender` 把闭包写进 `troika.userData.fccExtraBeforeRender`，导致自动保存 `DataCloneError: function ... could not be cloned`，整个场景存不进 IndexedDB |
| **整文（text scope）组件只能作用于目标文字自身，不能吃整张 UI RT** | 文字层 RT 里混着背景图片/其他文字。把 alpha-AABB 当遮罩范围 → 背景图被一起扫掉、遮罩范围被别的元素撑大，看起来就是"UV 对不上" |
| **采样必须纯数学，不 new THREE 对象** | 每帧 N(字) × M(组件) 次采样。真正贵的是 char × 花字层数 的 Troika 网格重建，和组件数量无关 |

---

## 1. 数据模型（`freecapcut.textanim/2`）

```json
{
  "format": "freecapcut.textanim/2",
  "enabled": true,
  "components": [
    {
      "id": "c_wave_1",
      "type": "wave",
      "scope": "char",
      "enabled": true,
      "time": { "start": 0, "duration": 1.2, "loop": "clamp", "timeScale": 1 },
      "channels": { "offsetY": true },
      "params": { "amp": 12, "freq": 1.25, "speed": 1 },
      "selector": {
        "unit": "char", "order": "ltr", "start": 0, "end": 1,
        "amount": 1, "delay": 0.6, "ease": "cubicOut", "seed": 1
      }
    },
    {
      "id": "c_in_1",
      "type": "charIn",
      "scope": "char",
      "enabled": true,
      "time": { "start": 0, "duration": 0.8, "loop": "clamp", "timeScale": 1 },
      "channels": { "offsetY": true, "scale": true, "opacity": true },
      "params": { "offsetY": -36, "scale": 0.55, "opacity": 0 },
      "selector": { "order": "ltr", "delay": 0.45, "ease": "cubicOut" }
    },
    {
      "id": "c_wipe_1",
      "type": "wipeReveal",
      "scope": "text",
      "enabled": true,
      "time": { "start": 0, "duration": 1.0, "loop": "clamp" },
      "params": { "direction": "ltr", "soft": 0.08, "edgeIntensity": 2.5, "edgeWidth": 0.03 }
    }
  ],
  "legacy": null
}
```

要点：

- **没有 in / out / loop 相位概念**。时间窗在组件自己身上（`time`），入场/出场就是 `start` 不同的组件。
- **没有 `stagger`**。逐字错开统一收敛到 `selector`（见 §3），一个组件一套，互不干扰。
- 组件顺序 = 叠加顺序（UI 可拖动）。

---

## 2. 组件注册表（复用 `PostProcessRegistry` 的形态）

新文件 `js/textanim/TextAnimRegistry.js`：

```js
registerTextAnim( 'wave', {
  label: 'Wave', labelZh: '波浪',
  scope: 'char',                    // 'char' | 'text'
  group: 'motion',                  // motion | transform | look | reveal
  channels: [ 'offsetY' ],          // 它声明写哪些通道（UI 可单独关）
  selector: true,                   // 是否支持逐字范围/排序/延迟
  params: {
    amp:   { type: 'number', default: 12,  min: -400, max: 400, step: 0.5, unit: 'px' },
    freq:  { type: 'number', default: 1.25, min: 0, max: 8, step: 0.05 },
    speed: { type: 'number', default: 1,   min: -4, max: 4, step: 0.05 },
  },
  // 纯函数：把自身效果累加进 pose（p = selector 权重 0..1）
  sample( ctx, pose ) {
    const { t, charIndex, params, p } = ctx;
    pose.offsetY += Math.sin( charIndex * params.freq + t * Math.PI * 2 * params.speed ) * params.amp * p;
  },
} );
```

整文组件（走渲染 pass，不出 pose）：

```js
registerTextAnim( 'wipeReveal', {
  scope: 'text',
  group: 'reveal',
  params: { direction: { type: 'select', options: [ 'ltr', 'rtl', 'ttb', 'btt' ], default: 'ltr' }, /* soft / edgeIntensity / edgeWidth */ },
  // 返回一条 pass 指令，由 Viewport 交给 TextLayerRT 执行
  resolvePass( ctx ) {
    return { kind: 'wipe', progress: ctx.p, direction: ctx.params.direction, soft: ctx.params.soft, edgeIntensity: ctx.params.edgeIntensity, edgeWidth: ctx.params.edgeWidth };
  },
} );
```

### 通道表（pose 累加器字段）

| 通道 | 单位 | 合并方式 |
|------|------|----------|
| `offsetX` / `offsetY` | px | 相加 |
| `rotateX` / `rotateY` / `rotateZ` | rad | 相加 |
| `skewX` | rad | 相加 |
| `scale` / `scaleX` / `scaleY` | 倍率 | 相乘 |
| `opacity` | 0..1 | 相乘 |
| `colorMul` | rgb | 相乘 |
| `charProgress` | 0..1 | 后写覆盖（打字机类） |

> 规则固定并写进文档，避免"加了两个组件结果顺序变了"的玄学。

---

## 3. Selector（逐字权重）——把今天的 stagger 抽象出来

```js
// p = 0 完全不受该组件影响，1 = 满量
p = ease( clamp01( (localT - orderIndex * delayStep) / window ) ) * amount * inRange
```

- `order`：`ltr | rtl | center | edges | random(seed)`
- `delay`：总错开时间占 duration 的比例（0 = 同时，1 = 完全串行）→ 等价于今天 `overlap` 的反面
- `start / end`：字符区间（AE 的 Range），`unit: char | word | line`
- 今天的 `sampleCharProgress` 直接变成 `selector` 的默认实现，行为不回归。

**好处**：波浪、抖动、弹入、颜色脉冲共用一个 selector 语义；用户不必在每个组件里重设"从右往左、错开 0.3"。

---

## 4. 关键帧：复用现有 `.anim`，不重造

现有 `freecapcut.anim/1`（`js/anim/FreeCapCutAnimCore.js`）已经是 path → tracks → keys 的通用系统，
`applyAnimToRoot` 按路径前缀分派（transform / ui.* / material.* / postProcess.*）。

**只加一个前缀分支**：

```js
if ( isTextAnimPath( track.path ) ) {      // "textAnim.<componentId>.<param>"
  applyTextAnimPath( obj, track.path, v );  // 写进 fccUI.textAnim.components[i].params[param]
  continue;
}
```

这样：

| 能力 | 是否已有 |
|------|----------|
| 采样 / 缓动 / loop / fps 对齐 | ✅ 现成 |
| 时间线 UI、打帧、删除帧 | ✅ 现成（Animation 面板） |
| 导出到 vfxpack / NLE | ✅ 走同一套 `.anim` |
| 组件的静态参数 | 直接改 `params`（不 k 帧时就是常量） |

优先级：**k 帧 > 组件静态值 > descriptor 默认值**。
每帧顺序：`applyAnimToRoot()` 先写 params → `applyTextAnim()` 再采样 → 不会互相打架。

侧栏每行参数右侧加 ⏱：点击 = 在当前时间写一帧，路径 `textAnim.c_wave_1.amp`。
已 k 帧的行高亮，右键可"删除本参数所有帧"。

---

## 5. 运行时分层

```
              ┌─ char 组件 ─┐        每字 pose 累加器 ─→ 应用到 charGroup
 fccUI.textAnim ┤            ├─→ sample ─→ │ opacity/offset/scale/rot │
   .components  └─ text 组件 ─┘            └──────────────────────────┘
                                    └─→ passOps（wipe / blur / 3D）─→ Viewport / TextLayerRT
```

新文件 `js/textanim/TextAnimEngine.js`：

```js
export function sampleTextAnim( obj, tSec ) {
  // → { chars: [ {i, pose} ], passOps: [ ... ], needsCharSplit: bool }
}
```

`js/ui/TextAnimRuntime.js` 退化成两件事：建/销毁逐字 Troika 分组、把 pose 写进 `charGroup`。
（现在它还兼着 sampleCharPose 的调用、wipe 的 rest-pose 特判，全部搬进 engine。）

---

## 6. UI（AE 手感）

```
文字动画  [✓ 启用]                        预览相位 [in ▾] [▶]
[+ 添加动画 ▾]
   ├ 逐字：位置 / 缩放 / 旋转 / 透明度 / 波浪 / 抖动 / 弹入 / 打字机
   └ 整文：扫光 / 模糊呼吸 / 描边呼吸 / 3D 翻转
┌ ≡ 波浪          char   👁  ✕ ┐
│  范围[全部▾] 顺序[LTR▾] 错开 0.6  缓动[cubicOut▾]
│  振幅 12px ⏱   频率 1.25 ⏱   速度 1 ⏱
└──────────────────────────────┘
┌ ≡ 扫光          text   👁  ✕ ┐
│  方向[ltr▾]  柔边 0.08 ⏱  刃光 2.5 ⏱  刃宽 0.03 ⏱
└──────────────────────────────┘
```

- 卡片可折叠、拖动排序、眼睛禁用、✕ 删除（`editor.execute` 走 command，可撤销）。
- 参数控件**由 descriptor 的 `params` schema 生成**（number / color / bool / select / vec2），不写死表单。
- 预设 = 一组组件实例的 JSON（"故障入场""霓虹呼吸"），一键添加。

---

## 7. 迁移（v1 → v2）

`TextAnimTypes.normalizeTextAnim()` 单入口检测 `format`：

| v1 | v2 |
|----|----|
| `in.channels` + `stagger` + `ease` | `charIn`（char） |
| `out.*` | `charOut`（char，`time.start = 0`，预览时反向） |
| `modulators.wave.enabled` | `wave`（char） |
| `modulators.bend.enabled` | `bend`（char） |
| `modulators.wipeReveal` | `wipeReveal`（text） |
| 原对象 | `legacy` 字段原样保留（回滚用） |

旧工程打开即升级；保存写 v2。`v1` 只读兼容一个版本周期。

---

## 8. 落地顺序

| 阶段 | 内容 | 改动面 |
|------|------|--------|
| **P0** | 数据层 + 注册表 + 引擎 + 6 个内置组件 + v1 迁移 + 侧栏组件栈（无 k 帧） | 新增 `js/textanim/*`；改写 `TextAnimRuntime.js`、`Sidebar.Object.TextAnim.js` |
| **P1** | k 帧打通：`textAnim.<id>.<param>` 路径 + ⏱ 打帧 + 面板行 | `FreeCapCutAnimCore.js` 加分支；侧栏加按钮 |
| **P2** | 整文组件 pass 化（wipe / blur / 3D），wipe 收编"按目标对象隔离" | `Viewport.js` L1414-1510、`TextLayerRT.js` |
| **P3** | 预设、曲线编辑器、逐字网格按需重建（性能） | 侧栏 / `TextAnimRuntime.js` |

P0 就能交付可用状态：旧动画自动迁移、新组件可添加 / 叠加 / 排序，只是还不能 k 帧。

---

## 9. 首批内置组件（P0）

| type | scope | 通道 | 说明 |
|------|-------|------|------|
| `charIn` | char | offset X/Y, scale, opacity, rotate | 入场（取代 in.channels） |
| `charOut` | char | 同上 | 出场 |
| `wave` | char | offsetY | 正弦浮动 |
| `bend` | char | rotateZ + offsetY | 弧形弯曲 |
| `jitter` | char | offset X/Y + rotateZ | 噪波抖动（seed） |
| `typewriter` | char | charProgress | 逐字硬切（按 selector 顺序） |
| `colorPulse` | char | colorMul | 逐字颜色脉冲 |
| `wipeReveal` | text | —（pass） | 扫光 + 刃光 |

---

## 10. 风险 / 待定

1. **命名兼容**：`fccUI.textAnim` 保留键名，只换 `format`，避免动到工程存档路径。
2. **UI 重排后旧工程**：靠 `legacy` + 迁移兜底；建议 P0 前先备份一份示例工程 JSON。
3. **组件叠加语义**：`replace` 类（charProgress）在多个组件间会互相覆盖 → 文档写清"最后添加的生效"。
4. **NLE 侧**：目前 `freefilmcut` 里没有任何 textAnim 消费代码，v2 数据结构要先定稿再谈 NLE 落地。
5. **性能**：组件数上限建议 8；超过给警告（采样本身便宜，主要防 UI 太长）。

---

## 11. 已定决策（2026-10-20）

| 决策点 | 结论 |
|--------|------|
| 组件粒度 | **AE 式：一个组件带多属性**。`charIn` 一张卡里同时勾位移/缩放/透明度/旋转，`channels` 逐项开关 |
| k 帧入口 | **复用现有 Animation 面板**：参数行右侧 ⏱ 打帧，轨道自动出现在面板的 "Text anim" 分组 |
| P0 范围 | **数据层 + 引擎 + 组件栈 UI**，k 帧留到 P1 |

### 由此产生的两条实现约束

1. **`channels` 是组件实例上的开关表，不是 descriptor 的固定字段**：
   ```json
   "channels": { "offsetY": true, "scale": true, "opacity": true, "rotateZ": false }
   ```
   `sample()` 里每个通道前先判 `if ( ctx.on.offsetY )`，UI 勾选框直接绑这张表。
   descriptor 只声明"我**支持**哪些通道"（`channels: ['offsetY','scale','opacity','rotateZ']`），
   新加实例时全部默认 `true`。

2. **P0 不做 k 帧，但数据结构必须先留好**：
   `params` 里所有数值都是"最终值"，P1 的 `applyTextAnimPath` 只是**在采样前改写它**，
   所以 P0 的组件写法 P1 完全不用改。反之若 P0 把参数硬编码进 `sample()` 常量，P1 要重写。

### P0 任务清单（可直接开工）

| # | 文件 | 动作 |
|---|------|------|
| 1 | `js/textanim/TextAnimTypes.js` | 新建：v2 schema、`normalizeTextAnim`、`migrateV1` |
| 2 | `js/textanim/TextAnimRegistry.js` | 新建：`registerTextAnim` / `listTextAnims` / `createInstance` |
| 3 | `js/textanim/TextAnimBuiltins.js` | 新建：`charIn` `charOut` `wave` `bend` `jitter` `typewriter` `wipeReveal` |
| 4 | `js/textanim/TextAnimEngine.js` | 新建：`sampleTextAnim(obj,t)` → `{chars, passOps, needsCharSplit}` |
| 5 | `js/ui/TextAnimRuntime.js` | 改写：只保留 char 分组构建 + pose 落地，删 `sampleCharPose`/rest-pose 特判 |
| 6 | `js/Sidebar.Object.TextAnim.js` | 改写：组件卡片栈（添加/折叠/拖动/眼睛/删除），参数行由 schema 生成 |
| 7 | `js/ui/TextAnim.js` | 保留导出壳，内部转发 `TextAnimTypes`（避免 6 处 import 断掉） |
| 8 | `js/Viewport.js` | wipe 段改为读 `passOps`，保留你已修好的"按目标对象隔离" |

验收：旧工程打开动画外观不变；能添加两个以上组件并正确叠加；删除/禁用/排序即时生效。
