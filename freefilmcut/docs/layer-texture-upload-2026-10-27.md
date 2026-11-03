# 新读数对账：8.74ms 全在 3 个图层的纹理上传（2026-10-27）

承接 `composite-breakdown-2026-10-27.md`。用户提供了修复后的 span + counter 表。

## 1. 修复确认：上一轮的目标全部达成

| 指标 | 修复前 | 修复后 | 结论 |
| --- | --- | --- | --- |
| `renderFrame` mean | 25.57 | **10.16** | −60% |
| `renderFrame` p50 | 39 | **9.9** | 双峰消失，mean ≈ p50 = 单峰 |
| `three:syncPackScenes` | 27.3 (p50) | **0** | 销毁重建抖动彻底消失 |
| `three:forcedOverlays` | 14.42 | **0.04** | 死代码确认 |
| `packSceneDispose` / `framePackIds` | — | **0 / 0** | 无回退 |

账本闭合度（这次非常干净）：

```
renderFrame 10.16
= composite 9.83 + setup 0.06 + pruneTextScenes 0.16 + present 0.05
  + forcedOverlays 0.04 + syncTextures 0.03 = 10.17   （差 0.01）

composite 9.83
= layers 8.74 + texts 1.08 + packs 0 = 9.82          （差 0.01）
```

**打点没有空隙，读数可信。**

## 2. 三个反直觉发现

### ① 这次采样里根本没有 pack

`framePackIds` = **0/帧**，`composite:packs` = **0ms**，`fullscreenPass` = **1/帧**。

上一轮"pack 走 6~10 次全屏拷贝"的推论**不适用于这份数据** —— 采样时播放头下方
没有 vfxpack，只有 3 个普通图层 + 1 个文本层。那份推论的适用范围要收窄。

### ② 不是填充率，也不是 GPU 饱和

- 合成目标只有 **691200 px ≈ 0.69MP**（`threeAccumPixels`/帧）
- 3 个全屏 quad 合计 ≈ 2.1MP 填充 —— 任何独显/核显都在 0.5ms 内
- `fullscreenPass` 1/帧、`three:present` 仅 **0.05ms** → **驱动队列没满**

所以 8.74ms 不可能是 GPU 画不完，只能是 **CPU 侧同步工作**。

### ③ 8.74ms / 3 layer ≈ 每层 2.9ms，画一个 quad 不该这么贵

## 3. 根因：`addLayerMesh` 每帧把全部纹理标脏

```ts
// 修复前
entry.texture.needsUpdate = true;   // 对所有纹理，无条件，每帧
material.needsUpdate = true;        // 对所有材质，无条件，每帧
```

`needsUpdate = true` 会让 `texture.version++`，three.js 随即走 **完整 `texImage2D`
路径（重新 allocate + 全量上传）**，而不是 VideoTexture 的增量 `updateMedia` 路径。

1280×720 RGBA = **3.7MB/张**，3 张 = **11MB/帧**。60fps → 660MB/s 的纯浪费，
而且这段是同步提交，全部落进 `composite:layers`。

这行代码的注释写着 "Keep video / canvas textures fresh each frame"，但：

- **VideoTexture 本来就会自更新** —— 渲染器在 `setTexture2D` 里对 `isVideoTexture`
  调 `updateMedia`，只看 `videoFrame` 是否变化，不需要外部标脏；
- **CanvasTexture（rendered 类）在 `syncRenderedTexture` 里已经自己标脏**；
- **ImageBitmap / HTMLImageElement 不可变**，标脏等于每帧重传静态图。

`syncExternalTexture` 里恰好有一条 `fcc-tl-flower-66` 的注释明确指出这个坑
（"static ImageBitmap/HTMLImageElement must NOT needsUpdate every present —
that re-uploads the whole still every RAF"）—— 说明以前修过一次，
但 `addLayerMesh` 这行把它绕过去了。

`material.needsUpdate = true` 同理：它强制 `initMaterial()`（重建参数集、
重算 program cache key、刷新全部 uniform）。而 `map` 在两个纹理之间切换**不改变
任何 define**（`USE_MAP` 恒为真），只有 null ↔ 非 null 才需要。

## 4. 修复内容

`three-compositor.ts` / `addLayerMesh`：

| 原行为 | 改为 |
| --- | --- |
| 每帧对每个 layer 纹理 `needsUpdate = true` | 仅当源是**被外部原地重绘的 canvas**（`isMutatedCanvasSource`）才标脏 |
| 每帧 `material.needsUpdate = true` | 仅当 `map` / `alphaMap` 发生 **null ↔ 非 null**（define 变化）时才设 |
| mask 纹理同样每帧标脏 | 同上规则 |

新增计数器（用于验证 + 归因下一步）：

| counter | 期望 | 含义 |
| --- | --- | --- |
| `textureForceUpload` | **0** | 本帧被强制标脏的纹理数；非 0 说明还有别处在每帧重传 |
| `texMissExternal` | ? | external 纹理 cache miss：descriptor 的 source 身份变了 |
| `texMissRendered` | ? | rendered 纹理 cache miss：`contentHash` 变了、canvas 重画 |

## 5. 还没解释的一块：`resolve` 长尾

| span | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| `resolve` | 8.41 | **0.5** | 41.6 | **186.6** |

p50 只有 0.5ms，mean 却被少数帧拉到 8.41 → 60 帧里大概 2~3 帧吃了 100ms+。
`resolve` 不在 `renderFrame` 内（所以不影响上面的账本），但这种 186ms 的尖峰
是典型的 shader 编译、`readPixels` 强制同步或内存回收停顿，会直接掉帧。

下一步可查：`resolve` 的调用点是否含 `readPixels` / `getImageData`；若是 wasm 侧，
看是否每次都在等 GPU 完成。这条与合成器本身无关，单独处理。

## 6. 预期收益

| 指标 | 现在 | 预期 |
| --- | --- | --- |
| `composite:layers` | 8.74 | **1.5 ~ 2.5** |
| `three:composite` | 9.83 | 2.6 ~ 3.6 |
| `renderFrame` | 10.16 | **3.5 ~ 4.5** |

剩余下限是 VideoTexture 的每帧增量上传（3.7MB，必需，无法消除）。

## 7. 验证方法

同一场景再跑一次 `window.__renderPerf = true`，看四个数：

1. `composite:layers` 是否降到 1.5~2.5；
2. `textureForceUpload` 是否恒 0；
3. `textureUpload` 是否仍是 ~0.6/帧 —— 若是，看 `texMissExternal` / `texMissRendered`
   哪个在动，那是下一块要修的地方；
4. 画面是否正常（重点看：静态图片层是否还显示、遮罩是否还在、视频是否还在动）。

第 4 点必须人工确认 —— 这次改动动了纹理更新策略，静态图不重传的前提是
"设备像素没变"，若某些图形节点的源 canvas 会被原地重绘，现在靠
`isMutatedCanvasSource` 兜底；如有漏网，画面会停在旧帧。

## 8. 校验

- `tsc --noEmit`：154（与改动前一致）；`three-compositor.ts` 仍为既有 3 个
- `eslint three-compositor.ts`：51 error + 3 warning，与基线一致
  （中途 `as unknown as object` 触发 `no-unsafe-type-assertion`，去掉 cast 后消除）

---

以上数字均来自用户提供的实测表；推断部分基于 three.js 纹理更新路径，
仅供参考。
