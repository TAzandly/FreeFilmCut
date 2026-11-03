# resolve 长尾：合成器已达标，现在 92% 的帧时间在 resolve（2026-10-27）

承接 `layer-texture-upload-2026-10-27.md`。用户提供了第三份读数。

## 1. 纹理修复完全生效

| 指标 | 修复前 | 现在 | 变化 |
| --- | --- | --- | --- |
| `composite:layers` | 8.74 | **0.29** | **−97%（30 倍）** |
| `three:composite` | 9.83 | **1.21** | −88% |
| `renderFrame` | 10.16 | **1.32** | −87% |

`composite:layers` 8.74 → 0.29 直接证实了「每帧 11MB 全量重传」这个诊断：
去掉多余的 `needsUpdate` 后，3 个图层画 quad 的真实成本就是 0.29ms。

**合成器已经不影响帧率了**：1.21ms 只占 16.67ms 预算的 7%。

`composite` 内部构成也变了：`texts` 0.91 现在占 75%，`layers` 0.29 占 24%。
文本层成了合成器里唯一的成本项（1 个文本 = 0.9ms，走 troika → RT → blit），
可优化但已不是瓶颈。

## 2. 现在唯一的耗时：`resolve`

| span | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| **`resolve`** | **18.15** | **0.4** | **115.1** | **200.5** |
| `renderFrame` | 1.32 | 1.2 | 1.7 | 6 |
| `buildFrame` | 0.19 | 0.2 | 0.3 | 0.3 |
| 其余 | < 0.05 | | | |

每帧总成本 ≈ 18.15 + 0.19 + 0.04 + 1.32 ≈ **19.7ms**，而 p50 只有 1.84ms。

这是一个**极端双峰**：绝大多数帧 1.8ms（≈500fps 的能力），少数帧 130~200ms。

反推慢帧占比：`0.4 × (60−n) + T × n = 60 × 18.15`
- n = 6 → T ≈ 178ms
- n = 8 → T ≈ 134ms

即 **约 10~13% 的帧卡 130~180ms**，大约每 0.3~0.5 秒一次。视觉上比均匀
30fps 更难受 —— 均匀掉帧只是"不够顺"，这种周期性长卡是"一顿一顿"。

`resolve` 不在 `renderFrame` 内，跟合成器无关，是**纯 CPU 的树解析 + 取帧**：
`canvas-renderer.render()` 里 `resolveRenderTree()` → `resolveNode()` 递归。

## 3. 唯一可疑路径：取视频帧

`resolveNode` 里能产生 100ms+ 的只有一个分支：

```
resolveNode (VideoNode)
└─ resolveVideoNode
   └─ await videoCache.getFrameAt({ mediaId, file, time })
      └─ frameChain（按 mediaId 串行）
         └─ resolveFrame
            ├─ 命中当前帧            → 极快（p50 就是这条）
            ├─ iterateToTime         → 解码下一帧，通常快
            └─ seekToTime            → 重新定位关键帧 + 解码 GOP，100~200ms
```

三个关键机制：

1. **`frameChain` 串行**：同一 mediaId 的取帧请求排队。一次 200ms 的 seek
   会把后面所有帧全部堵住 —— 所以单帧的 200ms 会放大成一段卡顿。
2. **seek 触发条件**：`time < lastTime`（回退）或 `time >= lastTime + 2.0`（跳超 2 秒）。
3. **prefetch 只缓冲 1 帧**（`nextFrame`）。播放 30fps 时，只要解码一帧慢于
   33ms，缓冲立刻见底 → 退回迭代 → 迭代也慢 → 最后 seek。

## 4. 新加埋点（下一次跑表直接定位）

`resolve.ts`（按节点类型拆，回答"哪个节点吃掉了长尾"）：

| span | 含义 |
| --- | --- |
| `resolve:video` | 视频节点（含取帧等待） |
| `resolve:image` | 图片节点（`loadImageSource`） |
| `resolve:sticker` | 贴纸（`loadStickerSource`，可能 fetch） |
| `resolve:text` | 文本测量（`measureTextElement`） |
| `resolve:blur` | 模糊背景 |

`services/video-cache/service.ts`（回答"是排队、还是解码、还是 seek"）：

| span / counter | 含义 |
| --- | --- |
| `vcache:queueWait` | 排在 `frameChain` 里等前一帧的时间 |
| `vcache:iterate` | 迭代解码耗时 |
| `vcache:seek` | 重新 seek 耗时 |
| `vcache:sink` | `ensureSink` 初始化（每个 media 一次） |
| `vcache:pathHit` (counter) | 直接命中当前帧的次数 |
| `vcache:seekCount` (counter) | seek 发生次数 |
| `vcache:stale` (counter) | 因 generation 落后被丢弃的请求数 |

全部 `isRenderPerfEnabled()` 门控，关闭时零开销。

## 5. 判读表

跑一次，看 `resolve:video` 是否 ≈ `resolve`：

| 观察 | 结论 | 修法 |
| --- | --- | --- |
| `resolve:video` ≈ `resolve`，`vcache:seek` 大 | 真在 seek | 扩大预取窗口、按 GOP 对齐采样、拖动时降分辨率解码 |
| `resolve:video` ≈ `resolve`，`vcache:queueWait` 大 | 串行排队堵住 | 允许并行取帧 / 按需丢弃中间帧（已有 `stale` 机制，看它是否生效） |
| `resolve:video` ≈ `resolve`，`vcache:iterate` 大 | 解码跟不上播放 | 加深 prefetch（当前只有 1 帧）、降解码分辨率 |
| `resolve:text` 大 | 文本测量 | 缓存 `measureTextElement` 结果（同文本同尺寸只测一次） |
| `resolve:image` / `resolve:sticker` 大 | 资源加载没缓存 | 加 LRU |
| 全部都小，但 `resolve` 仍大 | 长尾不在节点里 | 查 GC / 递归遍历 / `Promise.all` 之外的同步代码 |

`vcache:seekCount` 的 perFrame 最关键：**>0.1/帧 就说明在反复 seek**，
这是最该修的一类；若 ≈0 而耗时仍在，问题就在 `iterate` 或排队。

## 6. 场景前提

这份数据的判读取决于采样时的状态：

- **连续播放**：seek 应该接近 0，出现即 bug；
- **拖动播放头**：每次拖动触发 seek 是必然成本，200ms 属正常量级，该做的是
  "拖动时先出低清帧，停手后再出精确帧"，而不是优化 seek 本身；
- **暂停静止**：`resolve` 应稳定在 0.4ms，出现 200ms 一定有额外原因。

建议下一次分别在「纯播放 3 秒」和「快速拖动」两种状态下各采一次，两张表
一比就能区分。

## 7. 校验

- `tsc --noEmit`：154（与改动前一致）
- `eslint`（`resolve.ts` + `video-cache/service.ts`）：0 error
  （中途 `span(name, fn)` 双参数触发 `opencut/prefer-object-params`，改为对象参数后消除）

---

实测数字来自用户提供的表；根因指向基于代码路径推断，需下一次埋点数据确认。
