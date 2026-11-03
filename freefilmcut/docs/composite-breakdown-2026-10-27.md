# 现在耗时在哪 —— `three:composite` 的内部账本（2026-10-27）

承接：`compose-span-split-2026-10-27.md`（拆 span、修 `syncPackScenes` 抖动）。

## 1. 修复前的账本（用户贴的那张表）

| span | count | meanMs | p50Ms | 备注 |
| --- | --- | --- | --- | --- |
| `renderFrame` | 60 | 25.57 | 39 | 总预算 16.67ms |
| `three:forcedOverlays` | 60 | 14.42 | 27.3 | 名不副实：实际是 `syncPackScenes` + `pruneFlowerTextScenes` + forced-overlay peek |
| `three:composite` | 60 | 9.84 | 9.4 | 真正的绘制链 |
| `resolve` | 60 | 0.3 | 0.3 | |
| `buildFrame` | 60 | 0.21 | 0.2 | |
| `three:present` | 60 | 0.08 | 0.1 | 很小 → 不是 driver stall |
| `syncTextures` | 60 | 0.02 | 0 | |

账本闭合度：25.57 −（14.42 + 9.84 + 0.3 + 0.21 + 0.08 + 0.02）= **0.70ms** 残余，
即 `ensureInitialized` + `accumRT` 清屏 + mesh 拆除，没有漏掉的大块。

`three:forcedOverlays` 的双峰（mean 14.42 < p50 27.3）只能用"约一半帧 ≈0ms、
另一半 27~34ms"解释；`renderFrame` 同理（0.55×38 + 0.45×10.7 ≈ 25.7）。这是
`syncPackScenes` 每帧销毁+重建 pack 场景的直接指纹，已修。

## 2. 修复后：唯一的显性大头

`syncPackScenes` 修复后掉到 ~0.1–0.3ms（只遍历注册表做 Set 比较），于是：

```
renderFrame ≈ 11ms
├─ three:composite   9.4ms   ← 85%
├─ three:setup      ~0.7ms    (半浮点 accum 清屏 + mesh 拆除)
├─ three:present     0.1ms
├─ syncPackScenes   ~0.2ms
└─ 其余              ~0.3ms
```

结论：**现在耗时几乎全在 `three:composite`**。而 `composite` 只有 3 个 item，
说明它跟 draw call 数量无关，跟"每帧全屏拷贝次数 × 像素量"有关。

## 3. 一个 pack 到底要拷几次全屏

mesh-UV 路径（`samplesBelow && packRT && target === accumRT`，即 pack 需要读下方图层）：

| # | 操作 | 目标类型 | 说明 |
| --- | --- | --- | --- |
| 1 | `snapshotBelowSource()`：accum → belowSourceRT | HalfFloat 全屏 | 给 pack 的 `uInput` |
| 2 | accum → packRT | HalfFloat 全屏 | 把下方合成结果变成 pack 背景 |
| 3 | `drawPackTo(packRT)` | — | 见下 |
| 4 | packRT → accum | HalfFloat 全屏 | 结果并回主链 |
| 5 | `presentAccum()`：accum → canvas | 全屏 | 必然有 |

`drawPackTo` 内部还要再展开：

- 有 postProcess → `EffectComposer.render()`：RenderPass + 每个 effect pass + OutputPass，
  每个都是全屏（UnrealBloom 内部还有降采样链）→ 通常 3~5 个全屏 pass；
- 无 postProcess → `renderObjectAntialiased()`：渲染进 4× MSAA 缓冲（写放大 2~4 倍）
  再 resolve blit 一次 → 1 次全屏 + MSAA 带宽；
- `renderPackUIOverlay()`：若 pack 带 UI 图层，再走一遍 MSAA + blit → 1 次全屏。

所以单帧 **6~10 个全屏 pass**。1920×1080 HalfFloat（8B/px）单 pass ≈ 16.6MB 写、
读+写 ≈ 33MB；8 个 pass ≈ **260MB/帧**。60fps 就是 15GB/s，只算合成器。
9.4ms 不是"3 个对象太慢"，是这个带宽账单。

## 4. 新加的打点（回答"到底哪一段贵"）

`three-compositor.ts`：

| span / counter | 含义 |
| --- | --- |
| `three:composite` | 保持不变，总量 |
| `composite:layers` | 普通图层（视频/图片）绘制耗时 |
| `composite:packs` | 所有 pack（含转场）耗时，含 await |
| `composite:texts` | 文本层耗时 |
| `pack:belowSnapshot` | 第 1 次全屏拷贝 |
| `pack:blitIn` | 第 2 次全屏拷贝 |
| `pack:draw` | pack 自身渲染 + postProcess + UI overlay |
| `pack:blitOut` | 第 4 次全屏拷贝 |
| `fullscreenPass` (counter) | 每帧全屏拷贝次数 —— 与 `three:composite` 应近似线性 |
| `fullscreenPassPixels` (counter) | 每帧全屏拷贝的像素总量 |

全部走 `isRenderPerfEnabled()` 门控，关闭时零开销。

## 5. 怎么读新表（决策树）

1. `composite:packs` ≈ `three:composite` → 问题在 pack 链，继续看下一层。
2. `pack:draw` 占大头 → pack 的 shader/postProcess 本身贵（尤其有 bloom 时）。
   → 查 postProcess stack 里启用了几个 effect；bloom 是否可降到半分辨率。
3. `pack:blitIn + pack:blitOut + pack:belowSnapshot` 占大头 → 纯填充率。
   → 首选的省法：pack 在有 below 输入时直接画到 `accumRT`（不清屏、用 alpha 混合、
     `uInput` 绑 `belowSourceRT`），省掉第 2、4 两次往返；风险是 pack 依赖清屏或
    depth 语义，需要逐 pack 验证。
4. `fullscreenPass` ≈ 6~10 且 `composite:layers` 很小 → 确认是 pass 数量问题，
   与对象数无关。
5. 切 Medium Quality（scale 0.5，像素降 4 倍）后 `three:composite` 若从 9.4 → ~2.4，
   则填充率确认无疑；若基本不变，说明 9.4ms 藏在 await 链（视频 seek、`initTexture`
   同步上传），与像素无关。

## 6. 可落地的优化候选（按性价比）

| 优先级 | 做法 | 预期收益 | 风险 |
| --- | --- | --- | --- |
| P0 | pack 有 below 输入时直接画进 accumRT，去掉 accum↔packRT 往返（2 个全屏 pass） | −2 pass，约 −2.5~3ms | pack 清屏/depth 语义需逐个验证 |
| P0 | `presentAccum` 与最后一次 pack blit 合并（pack 结果直接进 canvas） | −1 pass | 有多个 pack / 文本时不可行 |
| P1 | preview 期 pack 后处理 bloom 用半分辨率 | 视 bloom 占比，常 −1~2ms | 观感差异，导出保持全分辨率 |
| P1 | MSAA 只对带几何边缘的 pack 开；纯视频/图片 layer 关 | −1 pass + 省 4× 写放大 | 边缘锯齿 |
| P2 | 播放期自动降档 accum 到 0.75 scale（仅 preview） | 像素 −44% | 预览清晰度 |

## 7. 校验

- `tsc --noEmit`：154 errors，与本轮改动前一致；`three-compositor.ts` 仍为既有 3 个
  （`precise`、`postProcess` ×2）。
- `eslint three-compositor.ts`：51 errors + 3 warnings，与基线一致，新增行段零报错。

---

以上为静态分析 + 经验规则推断，实际结论请以新打点跑出的表为准。
