# 渲染性能收敛报告（第四份读数）

日期：2026-10-27
范围：`three-compositor.ts` / `resolve.ts` / `video-cache/service.ts`
读数来源：`window.__renderPerf = true` → 60 帧 span 表 + counter 表

---

## 1. 结论

**性能目标已达成。** 单帧 CPU 成本稳定在 **1.95ms（mean）/ 0.7ms（p50）**，占 60fps 预算
16.67ms 的 **11.7% / 4.2%**。合成器（0.60ms）与树解析（1.35ms）都不再是瓶颈。

唯一残留：60 帧内发生 **2 次 seek**，各 35.3ms，构成全部剩余长尾。

---

## 2. 四轮读数对照

| 轮次 | `renderFrame` mean | `resolve` mean | `resolve` max | 主要问题 |
|---|---|---|---|---|
| 1 | 25.57 | — | — | `syncPackScenes` 27.3ms 销毁/重建抖动（双峰） |
| 2 | 10.16 | 8.41 | 186.6 | `composite:layers` 8.74ms，纹理每帧全量重传 |
| 3 | 1.32 | 18.15 | 200.5 | 合成器已达标，瓶颈转到 `resolve` 长尾 |
| **4（本次）** | **0.60** | **1.35** | **45** | 稳态，仅 2 次 seek |

第 3 轮的 18.15 / 200.5 未再复现。关键证据：本次 span 表**没有 `vcache:sink` 行**，
说明 `ensureSink()` 在这 60 帧内一次都没有初始化新 sink——采样窗口是**已预热的媒介**。
第 3 轮的长尾来自冷启动（`initializeSink` + 首次 canvas 解码，100~200ms 量级），
而非稳态 seek。两轮不可直接比较，**本轮数据才是稳态真值**。

---

## 3. 耗时账本（本次）

| span | mean | p50 | p95 | max |
|---|---|---|---|---|
| `resolve` | 1.35 | 0.3 | 0.8 | 45.0 |
| `renderFrame` | 0.60 | 0.4 | 1.5 | 9.1 |
| `three:composite` | 0.49 | 0.3 | 1.3 | 9.0 |
| `vcache:seek`（2 次） | 25.15 | 35.3 | 35.3 | 35.3 |
| `vcache:iterate`（1 次） | 9.4 | 9.4 | 9.4 | 9.4 |

**闭合校验**

- `resolve` max 45.0 ≈ `vcache:iterate` 9.4 + `vcache:seek` 35.3 = **44.7** ✓
  （同一帧：先走迭代 9.4ms 失败，再退化到 seek 35.3ms）
- `resolve` mean 1.35 ≈ (35.3 + 44.7) / 60 = **1.33** ✓
  → **两次 seek 占到平均值的 98.8%**，其余 58 帧几乎为 0。
- `renderFrame` max 9.1 ≈ `three:composite` max 9.0 ✓（同样落在 seek 那两帧，属排队等待）

**帧率影响**：60 帧中 2 帧超预算（35.3 / 44.7 > 16.67），按 vsync 计约丢 3~4 帧，
即 **~93~95% 帧准时**。第 3 轮是 10~13% 的帧卡 130~180ms（每 0.3~0.5 秒一顿），
体感差异是天壤之别。

---

## 4. `textureForceUpload` = 1/帧 是**正确值**，不是回归

第 3 轮把 `addLayerMesh` 里无条件的 `needsUpdate` 改为只对被就地重绘的 canvas 触发。
本次计数：

| counter | perFrame | 解读 |
|---|---|---|
| `textureForceUpload` | **1.00**（60/60 帧） | 每帧恰好 1 张，即唯一那个视频层 |
| `frameItems.layer` | 2.83（170 次） | 每帧约 2.83 个图层 |
| `textureCacheHit` | 2.40（144 次） | 144 命中 / 170 次图层绘制 |

若旧代码仍在，这个数会是 **170**（每次图层绘制都标脏）；现在 170 → 60，且 60 精确等于
帧数而非图层数。来源可确证：`resolve.ts:336` 把视频帧以 `source: frame.canvas` 交给合成器，
`CanvasSink` 每帧给出新的 canvas 内容，**这一张必须重传**。

成本下限：0.95MP（`textureUploadPixels` 949248）× 4B × 60fps ≈ **228MB/s**。
这是 mediabunny canvas 路径的固有成本，除非改用 `texSubImage2D` 同一张纹理原地更新。

---

## 5. 本次新增：seek 归因计数器

`video-cache/service.ts` 新增 `vcache:seekCause:<reason>`，四类归因：

| reason | 判定条件 | 该怎么修 |
|---|---|---|
| `cold` | `currentFrame == null` | 起播前预热一帧（idle 时预取），把 35ms 移到用户按播放之前 |
| `rewind` | `time < lastTime` | 拖动/回退，**成本合法**；做低清预览而不是优化 seek |
| `jump` | `time >= lastTime + 2.0` | 跳转，同上 |
| `iterateMissed` | 前向迭代失败后又去 seek | 唯一「白付一次钱」的分支：先烧 9.4ms 再烧 35.3ms |

同时把魔数 `2.0` 提为 `ITERATE_WINDOW_S` 常量（原判断与归因共用同一阈值）。

下一轮只需看这一行：若是 `cold` → 加预热；若是 `jump`/`rewind` → 属正常，收工；
若是 `iterateMissed` → 让迭代失败时直接置 `iterator = null`，跳过 9.4ms 的空走。

---

## 6. P2 候选（当前不动，留作后续）

1. **miss 帧双重上传**：`textureUpload` 26 次（25 帧）与 `textureForceUpload` 60 次存在重叠
   ——`syncExternalTexture` 缓存未命中时已 `dispose`+新建+上传，随后 `addLayerMesh`
   又因 canvas 源标脏再传一次。可省约 26 次 0.95MP 上传/秒。
2. **外部纹理缓存键不稳**：170 次图层绘制中 26 次未命中，说明 `frame.canvas` 的对象身份
   在部分帧发生变化，导致每次 miss 都 `dispose` + 新建 WebGLTexture（GL 对象churn）。
   若改为按 `(mediaId, frameId)` 复用同一张纹理，可消掉这部分抖动。

两者合计不到 0.4ms，当前预算余量 15ms，**不值得现在动**。风险收益比不划算。

---

## 7. 校验

- `tsc --noEmit`：154 errors，与改动前完全一致；`video-cache/service.ts` 0 error
- `eslint`：`video-cache/service.ts` 0 error（仅既有 `no-html-link-for-pages` 环境告警）

---

> 本报告基于静态代码分析与 `__renderPerf` 实测读数的自洽性推导，仅供参考。
> 结论中的因果链（尤其第 3 轮 200ms 的归因）为基于证据的推断，非直接观测。
