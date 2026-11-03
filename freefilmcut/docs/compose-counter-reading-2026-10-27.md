# 这张 counter 表能读出什么（2026-10-27）

## 一、先看清它是哪张表

`__renderPerf` 每次 flush 打两张表：

| 表 | 列 | 回答的问题 |
|---|---|---|
| **span 表** | `span / count / meanMs / p50Ms / p95Ms / maxMs` | 时间花在**哪个阶段** |
| **counter 表**（你发的这张） | `counter / perFrame / total / frames` | 每帧**做了多少事** |

你发的是 counter 表。它没有毫秒数，所以不能直接指出 24ms 在哪一段；但它能排除掉一批假设——这已经很有价值。

---

## 二、可以确凿排除的四件事

### 1. 不是"图层太多"

```
frameItems      3 / 帧
frameTextures   3 / 帧
```

每帧只有 **3 个绘制项、3 张纹理**。之前"时间线无虚拟化导致元素过多"这条线，在预览合成这一侧不成立——3 个 item 的上限很低。

### 2. 不是"每帧重新创建纹理对象"

```
textureCacheHit   2.95 / 帧   (177 / 60)
textureUpload     1    / 帧   ( 3 / 3 帧)   ← 60 帧里只有 3 帧发生上传
```

命中率 **98.3%**（2.95 / 3）。上传被完全摊销，每帧成本趋近于零。

### 3. 不是"4K 帧整帧上传"

```
textureUploadPixels   921600 / 帧
```

`921600 = 1280 × 720`，正好是 720p。所以之前"4K 一帧 33MB 走 texImage2D"的猜测可以划掉——源纹理是 720p 级。

### 4. 不是"每帧多次重建合成"

```
threeBlitFrames   1 / 帧
```

每帧只走一次 three 合成 + 一次 present，没有嵌套重建。

---

## 三、这张表**不能**排除的三件事（重要）

### 1. 视频纹理的每帧上传

`textureUpload` 只统计 **descriptor 层要不要新建 texture 对象**（`three-compositor.ts:3048`）。而播放中的 `VideoTexture` 是 three 在 render 时自己 `needsUpdate` 上传的，**不经过这个计数器**。

所以 `textureUpload = 3/60` 不等于"没有每帧上传"。如果场景里有一个在播的视频，每帧仍可能有一次 `texImage2D`（1280×720 ≈ 3.7MB）。

### 2. GPU 时间

整张表没有任何 GPU 侧数据。而 3 个 item 花 24ms ≈ **每个 item 8ms**，这在纯 CPU 侧是不可能的量级——几乎必然是 GPU 填充率 / 显存带宽，而不是 JS 计算。

### 3. 异步等待

`renderFrame` 这个 span 记的是 **wall time**（调用到 promise resolve），中间的 `await` 等待也算进去。`renderForcedOverlays`、`ensureFrameFlowerTexts` 只要有等待，就能吃满 24ms 而 CPU 完全空闲——这与 `longtask 0/0ms` 完全自洽（`longtask` 只统计 >50ms 的块，24ms 的 CPU 本来也测不到）。

---

## 四、一个 10 秒就能定性的实验

预览工具栏有一个**画质选择器**，默认是 **Full Quality**：

```ts
// preview/playback-quality.ts
{ id: "original", label: "Full Quality",   scale: 1    }   ← DEFAULT
{ id: "clear",    label: "High Quality",   scale: 0.75 }
{ id: "smooth",   label: "Medium Quality", scale: 0.5  }
{ id: "low",      label: "Low Quality",    scale: 0.35 }
```

而预览的合成分辨率是 **工程画布尺寸 × scale**（`usePreviewSize()` 取 `settings.canvasSize`，`DEFAULT_PLAYBACK_QUALITY = "original"`）。也就是说：**预览窗口哪怕只显示 800px 宽，内部仍按 1920×1080（或 4K）逐帧做全屏 pass。**

请做这个对照：

1. 保持 Full Quality，播放，记下 `compose total`（例如 24ms）
2. 切到 **Medium Quality**，再播放，再记一次

| 结果 | 结论 | 修法 |
|---|---|---|
| 24ms → 7ms 左右（约 1/4） | **填充率问题**：全屏 pass 太多或分辨率太高 | 降默认预览档位 / 播放期自动降档 / 减少 pass |
| 几乎不变 | 不是填充率，是每帧上传或 await 等待 | 看下面新增的 `three:present` 与 `three:composite` |

这一步不用改一行代码，就能把方向分成两半。

---

## 五、这次补上的两个缺口

### 1. `frameItems.<type>` —— 3 个 item 到底是什么

`frame-descriptor.ts` 里加了按类型拆分：`frameItems.layer` / `frameItems.flowerText` / `frameItems.sceneEffect` / `frameItems.transition`。

这三种的代价差一个数量级：纯 `layer` 是一次 quad 绘制；`flowerText` 是 **Text→RT→blit 两趟**；`sceneEffect` 是整条 pack 后处理链（多趟全屏）。

### 2. `renderFrame` 内部三段 + 合成目标像素

`three-compositor.ts` 的 `render()` 里加了：

| 新增 span / counter | 含义 |
|---|---|
| `three:composite` | 所有 item 的 pass 链（含 pack 后处理） |
| `three:forcedOverlays` | Effects 面板强制预览的 pack |
| `three:present` | accum → canvas 的最终 blit |
| `threeAccumPixels` | 合成目标像素数（`accumRT.w × h`），直接说明填充率基数 |

判读：`three:composite` 占大头 → pass 链；`three:present` 占大头 → 驱动在 present 处同步停顿（`preserveDrawingBuffer: true` 每帧要拷一份）；三段加起来远小于 24ms → 时间在 span 之外，即 `resolve` / `buildFrame` 的 await 里。

---

## 六、还要什么数据

counter 表到此为止了。要定位 24ms，需要**另一张 span 表**，只看四行：

```
resolve  /  buildFrame  /  syncTextures  /  renderFrame
```

加上这次新增的三行：

```
three:composite  /  three:forcedOverlays  /  three:present
```

---

## 七、校验

- 全仓 tsc **195**（基线不变），`three-compositor.ts` 仅原有的 `precise` / `postProcess` ×2 三个错误；`frame-descriptor.ts` 零错误。
- `frame-descriptor.ts` lint 干净；`three-compositor.ts` 新增行段（460–630）零报错，仅存量 51 error + 3 warning。
