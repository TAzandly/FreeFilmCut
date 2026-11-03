# FreeFilmCut 文字动画 — 当前进度与下月重构交接

> 日期：2026-10-22  
> 目的：记录「已能用、但效率很低」的现状，方便 **下个月用 Cursor 重构**。  
> 相关旧文档：`docs/textanim-v2-plan.md`、`docs/textanim-pack-export.md`、`three.js/editor/js/ui/TEXTANIM.md`

---

## 1. 一句话现状

文字动画 **功能链路已打通**（编辑器创作 → 导出 text-anim 包 → 剪辑端应用 + 预览），但实现是 **「每字一个 Troika + 文字 RT + 相机/纹理后处理 + NLE 逐包 blit」** 叠出来的，播放时主线程负担大（常见 Chrome Violation ~60ms/帧），**不适合作为长期架构，需要重构**。

---

## 2. 已完成（可依赖的行为）

### 2.1 数据与编辑器

| 项 | 状态 | 说明 |
|----|------|------|
| 组件栈模型 `freecapcut.textanim/2` | ✅ | char-scope + text-scope 组件栈；Registry + Builtins |
| 参数单值 + K 帧 | ✅ | 去掉 from→to；动画编辑器 K 帧驱动（含逐字入场） |
| 逐字通道 | ✅ | opacity / offsetXYZ / scale / rotateXYZ；stagger；wave/bend；offsetPath |
| 扫光 wipeReveal | ✅ | text-scope，挂文字 RT；刃光 + soft；须在 char-scope **之后** |
| 合成顺序硬规则 | ✅ | `orderTextAnimComponents`：text-scope 排栈末；Viewport 先 `applyTextAnimsInScene` 再 wipe |
| 动画编辑器 UX | ✅ | 拖关键帧不带动播放头；框选多选；整组平移 |
| 保存 | ✅ | 有项目目录时直接写 `project.json`；IDB sanitize（勿存 HTMLImageElement） |
| 包类型 | ✅ | `manifest.type` 必须为 `text-anim`（`effect` 会被加载器跳过） |
| 导出内容合同 | ✅ | **含** postProcess（Bloom/Deep Glow）；**不含** 花字样式（不覆盖剪辑端花字模版） |
| 资源目录 | ✅ | 剪辑端：`public/text-anims/in|out|loop/` + `index.json`（英文路径） |

### 2.2 剪辑端

| 项 | 状态 | 说明 |
|----|------|------|
| 应用 text-anim 保留花字 | ✅ | 包只驱动动画/PP，不烤花字 |
| 拆字 + 扫光迁入合成器 | ✅ | 对齐编辑器 `TextAnimRuntime` / wipe；尽量共用采样逻辑 |
| 包内 PP | ✅ | 走相机/场景后处理（SS camera / beauty），**不管** textFx 侧栏 |
| 双路径 | ✅ | overlay（无相机 PP）vs beauty PP 再 alpha blit 进 accum |
| Default 透明底 | ✅ | clearAlpha=0；OutputPass **NoBlending**；勿为对齐 bloom 加 uinput 底板 |
| 色彩 | ✅ | NeutralToneMapping；避免 ACES 惨白；Color 背景须进导出 `background` |
| RT 精度 | ✅（2026-10-22） | Texture FX / 文字层 / packRT / **accum** 均为 **HalfFloat**（勿再为 uInput 压回 8 位） |
| uInput | ✅ | 优先 `accum → belowSourceRT` HalfFloat blit；FramebufferTexture 仅兜底 |

### 2.3 已知坑（修过，重构时别回退）

- 拆字：**禁止**把父级 Troika `DerivedMaterial` 直接赋给子字 → `addEventListener is not a function`；只拷样式、各自材质。
- 花字开启动画：每个拆开字带花字 Effect；勿整句 `baseLayout` 再叠一层（曾双层错位）。
- 扫光 AABB：弯后只用墨迹 alpha 框，**禁止**整屏 fallback（否则刀刃竖条通天）。
- Registry 单例：不要对 Registry 模块加 `?v=` 拆成两份空 Map。
- 编辑器 UTF-8：中文 JS 文件勿被截断成 `U+FFFD`（曾缺闭合引号）。
- 播放刷屏 log 已删：`pack anims loaded` / anim sample / uInput debug。

---

## 3. 当前实现方式（为何效率低）

### 3.1 运行时路径（简图）

```
时间线文字 / text-anim 包
  →（可选）TextAnimRuntime 按字拆成 N 个 Troika Text
  → 每字改 pose（矩阵/opacity/材质）
  → 画进文字 RT（HalfFloat）
  → wipe / bend 等 text-scope 片元再处理
  →（可选）buildTextureFxComposer / 相机 EffectComposer（Bloom 等）
  → alpha blit → packRT → accum → present canvas
```

编辑器与剪辑端各有一份相近逻辑（`three.js/editor/js/ui/*` ↔ `freefilmcut/.../vfxpack/textanim/*`），再加合成器里的 PP/blit。

### 3.2 主要成本来源（重构应对准这些）

1. **按字 Troika 实例**  
   每个字独立 mesh/材质/同步；长句 + 花字 Effect 时，CPU 与 draw call 线性爆炸。

2. **主线程每帧全量合成**  
   预览 `useRafLoop` → `CanvasRenderer.render` → Three compositor；Bloom / 多 RT blit / HalfFloat 拷贝都在主线程。播放时常见 `setTimeout handler took ~60ms`（堆栈在 react-dom，实质是帧工作超时）。

3. **双端复制**  
   引擎、Builtins、Runtime、wipe/bend、PP Registry 在 editor 与 clip 各一份，修 bug / 对齐行为成本高，易漂移。

4. **异步字体 + 场景重建**  
   Troika 字体 sync、pack scene build 触发 epoch 重绘；Typr 对部分字体打 `unsupported GPOS/GSUB`（可忽略，但说明解析路径重）。

5. **调试期残留结构**  
   多 RT（text / pack / accum / below）、双重路径（overlay vs beauty）、历史 8 位量化补丁等，增加带宽与分支，即使已 HalfFloat 仍偏重。

---

## 4. 硬合同（重构必须保留）

1. **一条管线、按栈顺序**：后一个组件吃前一个结果（例：波浪后再扫光）；禁止「逐字一路 + 扫光另一路」叠画。  
2. **扫光 = text-scope，始终在 char-scope 之后**；遮罩在文字层，Bloom/Deep Glow 吃过亮像素即可。  
3. **text-anim 包含 PP、不含花字**；剪辑端花字模版不被包覆盖。  
4. **`type: text-anim`**；资源在 `text-anims/in|out|loop/`。  
5. **Default 背景透明合同**：PP 不写死不透明黑；OutputPass 勿用会弄脏 alpha 的 blending。  
6. **中间 RT 保持浮点**（与编辑器一致），不要为了 uInput/`FramebufferTexture` 把 soft glow 压回 8 位。  
7. **不要**为对齐 bloom 给 Default 加 uinput 底板。  
8. 用户偏好：项目在 `D:\GrokbotWork\FreeFilmCut` 原地改；助手可自己开网页看控制台，少让用户贴错。

---

## 5. 关键路径速查

### 编辑器（Three.js Editor）

- `three.js/editor/js/ui/TextAnim.js` — 数据模型  
- `three.js/editor/js/ui/TextAnimRuntime.js` — 拆字 Troika  
- `three.js/editor/js/ui/TextAnimKeys.js` / `TextAnimOverrides.js`  
- `three.js/editor/js/textanim/*` — Registry / Builtins / Engine / Types  
- `three.js/editor/js/Sidebar.Object.TextAnim.js`  
- `three.js/editor/js/TextAnimPackExporter.js`  
- `three.js/editor/js/ui/TextLayerRT.js`、`postprocessing/PostProcessStack.js`

### 剪辑端（OpenCut Classic）

- `freefilmcut/apps/web/src/vfxpack/textanim/*` — 迁入的 Runtime/Engine/Builtins  
- `freefilmcut/apps/web/src/vfxpack/text-layer-rt.ts`  
- `freefilmcut/apps/web/src/vfxpack/postprocess/composer.ts`  
- `freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts` — NLE 合成 / pack blit / uInput  
- `freefilmcut/apps/web/public/text-anims/` — 已导包

### 文档

- `docs/textanim-v2-plan.md` — v2 组件栈设计（仍有效）  
- `docs/textanim-pack-export.md` — 导出约定  
- `docs/superpowers/specs/2026-10-22-textanim-keyframes-design.md`  
- **本文** — 进度 + 效率问题 + 重构目标

---

## 6. 下月 Cursor 重构建议目标

按优先级，不必一次做完：

### P0 — 性能骨架

- [ ] **单几何 / 实例化或 glyph atlas**：避免「一字一 Troika」；pose 进 buffer/uniform。  
- [ ] **共享一份采样引擎**（editor ↔ clip 同源包，禁止再复制粘贴两套 Builtins）。  
- [ ] **预览 LOD**：播放时降 PP 分辨率 / 关 MSAA / 可选关 Bloom；导出全质量。  
- [ ] 用 `window.__renderPerf = true` 打底，重构前后对比 `resolve` / `buildFrame` / `renderFrame`。

### P1 — 管线收敛

- [ ] 明确「文字层 RT →（可选）单次 PP → 一次合成」；砍掉重复 blit。  
- [ ] wipe/bend 与 char pose 统一进同一 pass 或同一命令列表（仍遵守栈顺序语义）。  
- [ ] 包格式稳定版：`textanim/2` 冻结字段；旧包迁移脚本。

### P2 — 产品完整度

- [ ] 封面 / 悬停 GIF 与贴纸预览链路完全对齐并稳定。  
- [ ] 模板内置动画（剪辑端不可改）与库动画（可换）边界写清。  
- [ ] 自动化：最少几个视觉回归（入场 + 扫光 + Bloom 透明底）。

### 明确不要做的

- 不要为了「快」退回 8 位 accum（色阶已验证）。  
- 不要把花字样式打进 text-anim 包。  
- 不要再引入第二套与栈顺序无关的扫光通路。

---

## 7. 重构验收建议

1. 同一包：编辑器预览 ≈ 剪辑端预览（布局、扫光、Bloom、透明底）。  
2. 播放：1080p 预览稳定 ≥ 30fps（或可配置的 preview quality 下达标）。  
3. 长句（≥20 字）+ 花字 + 入场 + 扫光 + Bloom：无双层字、无刀刃竖条、无 Default 黑盖。  
4. 控制台无每帧 info 刷屏；GPOS/GSUB debug 可忽略。

---

## 8. 备注（给下个月的 Cursor）

- 用户：duo zhang；工作区 `D:\GrokbotWork\FreeFilmCut`；剪辑端常见 `localhost:3000`。  
- Agent 画像：剪映bot（FreeFilmCut / OpenCut + Three.js）。  
- 用户已判断：**当前实现效率很低，要重构而不是继续打补丁**；打补丁阶段（K 帧、透明、HalfFloat、去 log）到 2026-10-22 可视为收束。  
- 开干前先读：`docs/textanim-v2-plan.md` §0 硬约束 + 本文 §3–§4。


## 9. 预览画质与文字 RT（2026-10-22 晚）

- **已改**：剪辑端文字 blit RT / 文字 PP composer 跟随预览 compose buffer 缩放（lowerTextPreviewScale）。字号/描边仍按工程像素算，只是 RT 降采样。Full Quality / 导出仍为工程分辨率。
- **未做（重构项）**：按字形 AABB 开紧 RT（例如字只要 200×100 却画满 1920×1080）。当前全画布 RT 是为了扫光/布局/全屏 blit 简单；长期应「紧 bbox RT + 带偏移 blit」，省显存与 fill-rate。见下文效率条目。


## 10. toneMapping / Bloom parity (2026-10-23)

- **Restored (user feedback)**: clip text-anim PP again uses
  `resolveTextAnimPackOutputToneMapping` — pack `none`/`0` → **Neutral**. Honoring
  raw `none` on clip made bloom look wrong again; Neutral-for-none was the preferred look.
- **Investigation — why editor none can look OK while clip none blows**:
  1. Editor `Viewport.presentComposerToLetterbox` `_blitMat` clamps `rgb` to `[0,1]`
     and builds straight alpha (`a = max(a, max(rgb))`) after OutputPass.
  2. Clip `renderPackWithPostProcess` already does the same clamp once when
     `transparentClear` (composer→ppRT). A second PP→layer `straightAlphaFromPremul`
     would double-divide and was **not** applied.
  3. Remaining gap under OutputPass `NoToneMapping`: hard clamp of HDR bloom peaks
     ≠ Neutral highlight compression. Editor none+clamp can still look “fine” to the
     author; clip none (even with one clamp) did not match the Neutral look they liked
     after the earlier remap. Config is actually none when authoring; this is not a
     “editor secretly Neutral” issue.
- **Kept**: Bloom composer FBO = authored `resW/resH`.
- **Not dropped yet**: Neutral remap for text-anim PP (document as temporary until a
  scrub proves clip none ≡ editor none end-to-end).
- **Verify**: hard-refresh OpenCut → scrub sweep mid wipe; halo should match the
  earlier Neutral-for-none clip look. No editor `?v=` bump (editor files unchanged).


## 11. none + Bloom LDR path (2026-10-23)

- **Answer**: Bloom does **not** require tonemap. Tonemap only rolls off HDR at OutputPass.
  If beauty is clamped to LDR before UnrealBloom, **none + Bloom** is valid and matches
  authoring under Config none.
- **Code**: `LdrPreBloomClampPass` in editor `PostProcessStack.js` and OpenCut
  `vfxpack/postprocess/composer.ts` — inserted before first bloom/deepGlow iff
  OutputPass toneMapping is `NoToneMapping`. Neutral/ACES unchanged (HDR bloom).
- **Removed**: clip `resolveTextAnimPackOutputToneMapping` none→Neutral remap.
  Text-anim PP now uses `resolvePackOutputToneMapping` (none stays none).
- **Verify**: hard-refresh editor (`?v=fcc-ui-163`) + OpenCut → scrub sweep mid wipe
  under none; halo should match editor without Neutral remap. Re-export not required.

## 12. Tight text-layer RT (AABB + bloom pad) — 2026-10-23

**Decision:** Do **not** use a fixed 400×200 (or any fixed) text RT. Size from **dynamic ink AABB + bloom-aware pad**, dirty-update on layout/style/bloom/radius/design-res/preview-scale — not every opacity tick.

**Pad formula (project / authored pixels):**
- Base AA pad ≈ 8px (even when bloom strength≈0).
- Plus Troika/bend fraction pad (~6% of ink max-side) inside measure.
- Plus flower stroke/shadow extra from style.
- **Bloom (UnrealBloomPass):** `radius` is a **0..1 mip-weight lerp**, not pixels. Pad uses mip-kernel reaches ≈ `[12, 40, 112, 288, 704]` project-px at 1:1 PP density, mixed by radius, scaled by strength (`sMul ≈ 0.75 + 1.25·s`), then `max(…, 64, 0.08·canvasMax, min(0.22·canvasMax, 0.45·inkMax·…))`, clamp ≤ `0.48·canvasMax`. Fixes hard RT seams when authored radius is tiny (e.g. sweep `0.01`) but wipe/HDR still grows a wide soft skirt.
- DeepGlow: `max(radius*64+32, 48·min(2, intensity+0.35), 0.06·canvasMax)`.
- Result clamped to canvas. Large halo naturally expands toward full-canvas (same cost as today).

**2026-10-23 pad fix:** previous `radius * 0.55 * inkMax` under-padded because UnrealBloom `radius` is not a pixel radius; halo hard-clipped at tight RT edges on clip. Formula now mip-reach based (shared with editor `TextLayerAabb.js`).

**Clip (OpenCut) — landed:**
- Helper: freefilmcut/apps/web/src/vfxpack/text-layer-aabb.ts
- 	hree-compositor.renderOneFlowerText: resolve padded rect → tight HalfFloat RT (it hysteresis) → overlay frustum or PP setViewOffset → litTextureToTarget({ destRect }).
- PP path keeps **1:1 authored density** on the tight FBO (bloom texel ≈ project px). Overlay path still undersamples by preview quality.
- Composer signature uses **actual RT size** after hysteresis so AABB breathing does not rebuild EffectComposer every frame.

**Editor:** pad helper mirrored in 	hree.js/editor/js/ui/TextLayerAabb.js + ensureTextLayerRenderTarget(..., {fit}). Overlay TextFx / SS-camera scene PP still full project RT for now (scene-wide composer). Clip path is the perf-critical one.

**Verify:**
1. Hard-refresh clip; scrub a small sweep text with Bloom — no hard halo seams at RT edge.
2. Change font size — RT grows/shrinks (check via __renderPerf / WebGL memory if needed); no per-frame realloc while only opacity/char pose stays inside pad.
3. Compare bloom size vs editor for the same pack radius (should stay close; large radius may still near-full canvas).
