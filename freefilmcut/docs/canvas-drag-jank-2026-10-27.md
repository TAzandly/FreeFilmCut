# 画布拖动资源卡顿：一次全量 pipeline / pointer event

2026-10-27 · FreeFilmCut `apps/web`

---

## 1. HUD 读数怎么解释

```
FPS 26   38.7ms
vsync 16.5ms  drops 40%
1x 24   2x 5   9x 2   max 483ms
longtask 4/78ms
compose sync 0ms  total 2ms
```

| 行 | 真实含义 | 说明 |
|---|---|---|
| `FPS 26 38.7ms` | 31 帧 / 1190ms | 窗口被长帧撑到 1.19s，`frameMs = elapsed / frames`，不是"每帧都 38.7" |
| `1x 24 2x 5 9x 2` | 24 帧准时、5 帧掉 1、2 帧 ≥150ms | `9x` 是分箱上限，真实间隔最大 483ms |
| `drops 40%` | 21 / (31+21) | `Σ(multiple−1) = 5×1 + 2×8 = 21`。**40% 完全由那 2 帧长冻结构成**，不是说 4 成帧都晚 |
| `max 483ms` vs `longtask 4/78ms` | 最长帧 483ms，但最长长任务只有 78ms | 关键信号：**这 483ms 不是一段 JS 卡住**，而是几十个 <50ms 的任务首尾相接，或者干脆在等 JS 之外的东西（GPU present 队列 / 解码） |
| `compose sync 0 total 2ms` | 合成器只花 2ms | 上一轮纹理修复仍然有效，**合成器不是这次的原因** |

结论：帧预算被吃在合成器之外 —— 在 pointermove → 预演更新 → 全量 store 通知 → React 提交 这条链上。

## 2. 根因：这条链每个 pointer 事件跑一次

`preview/controllers/preview-interaction-controller.ts` 的 `onPointerMove` 原本直接同步执行整条 pipeline：

```
pointermove（原生事件）
  → viewport.screenToCanvas()
      → preview-viewport.tsx:342  getBoundingClientRect()   ← 强制同步布局
  → snapPosition()                                          ← 全元素遍历
  → onSnapLinesChange → setState                            ← React 提交 #1
  → timeline.previewElements()
      → applyPreviewOverlay()（重建 previewTracks）
  → notify("preview")
      → useEditor 的 9 个 manager 订阅、141 个调用点重算 selector
      → 时间线重渲染（TimelineElement 未 memo 化）
      → 预览重合成 + present                                 ← GPU 提交
```

一个事件 = 一次强制布局 + 一次 React 提交 + 一次合批 present。而 pointermove 频率远高于刷新率
（125Hz 鼠标 ≈ 2.4 次/帧，1000Hz ≈ 16 次/帧），所以**每帧被要求做 2~16 次完整提交**。

用读数反推单次成本：`38.7ms / (每次 8~15ms × 2~4 次/帧)` 自洽 —— 也就是说
**帧率被"每个事件一次提交"钉死在 26fps，而不是被某一次很贵的操作钉死**。

### 为什么时间线拖拽手感不同

同一仓库里，时间线侧的拖拽控制器**早就做了 rAF 合并**，并且都在 `__interactionPerf` 里登记了：

| 控制器 | 合并工具 | 探针名 |
|---|---|---|
| `timeline/controllers/element-interaction-controller.ts:569` | `createRafPointerMove` | `timeline.drag` |
| `timeline/controllers/resize-controller.ts` | `createRafPointerMove` | `timeline.resize` |
| `timeline/controllers/playhead-controller.ts:346` | `createRafPointerMove` | `timeline.playhead` |
| `timeline/controllers/keyframe-drag-controller.ts:348` | `createRafPointerMove` | `timeline.keyframeDrag` |
| **`preview/controllers/preview-interaction-controller.ts`** | **无** | **无** |
| **`preview/controllers/transform-handle-controller.ts`** | **无** | **无** |

`timeline/controllers/raf-pointer-move.ts` 的文件头注释已经把这件事写明了：
"1000 Hz mouse emits ~16 moves per displayed frame, running the full drag pipeline
for each of them saturates the main thread" —— 只是画布这两条路径没接上。

## 3. 改动

### `preview/controllers/preview-interaction-controller.ts`

- `onPointerMove` 只做 `recordPointerMove()` + `rafPointerMove.push()`，不再执行 pipeline。
- 新增 `applyCoalescedMove()`（每帧最多一次）→ `processPointerMove()`，内部拆三段计时：
  `preview.dragRect`（rect 读取 + 强制布局）、`preview.dragStore`（snap + 预演 + notify）。
- `onPointerUp`：先 `flushNow()` 再 `commitPreview()`，否则快速松手会丢掉最后几像素。
- `onPointerUp` 里 gesture 仍是 `pending` 时也先 flush —— 否则一次 <16ms 的快甩会被当成单击，元素根本不动。
- `abortActiveGesture()` 里 `cancel()`，避免回滚后又落一帧。

### `preview/controllers/transform-handle-controller.ts`

同样的合并（缩放/旋转手柄），探针 `preview.handleDrag` / `preview.handleDragRect`，
`onPointerUp` 先 flush，`cancel()` / `destroy()` 取消待执行帧。

全部探针走 `isInteractionPerfEnabled()` 门控，关闭时零开销。

## 4. 验证

```js
window.__interactionPerf = true;   // 打开
// 拖动画布上的一个资源 2~3 秒，然后看控制台折叠组 [interaction-perf]
```

| 列 | 期望（修复后） | 不满足说明什么 |
|---|---|---|
| `moves/s` | 120~1000（鼠标事件率，不变） | — |
| `work/s` | **≤60** | 仍 >60 说明还有别的路径在每事件跑 |
| `perMove` | **2~16**（每帧合并掉的事件数） | ≈1 说明合并没生效 |
| `preview.drag` meanMs | ≤16 | >16 则单帧超预算，看下面两行拆分 |
| `preview.dragRect` meanMs | 记录值 | 大 → `getBoundingClientRect` 的强制布局是主成本，下一步缓存 rect |
| `preview.dragStore` meanMs | 记录值 | 大 → React 提交 + store 扇出是主成本，下一步收窄 `notify` 粒度 |

HUD 侧同步看：`drops` 应从 40% 掉到个位数，`9x` 那两帧若仍存在，说明还有一个与合并无关的长冻结。

## 5. 已知残余问题（本轮不动）

- `longtask 4/78ms` 与 `max 483ms` 对不上：那 2 帧 150~483ms 的冻结不是单段 JS，
  合并去掉后如果仍出现，需要单独查（候选：首帧 overlay 着色器编译、GC、视频解码等待）。
- `getBoundingClientRect()` 仍然每帧一次（合并后 ≤1 次/帧）。若 `preview.dragRect` 均值偏高，
  下一步是在 gesture 开始时缓存 rect，pointerup 时失效。
- `TimelineElement` 未 `React.memo`，每个 `notify("preview")` 都会重渲染。合并后只剩 1 次/帧，
  暂可接受；若 `preview.dragStore` 仍高，才是它的账。

## 6. 校验

- `tsc --noEmit`：154 errors，与改动前一致；两个改动文件 0 error。
- `eslint`：两个文件 4 个 error，全部是既有的 `as HTMLElement`（`currentTarget as HTMLElement`
  等 4 行），新增区段 0 报错。

> 本报告基于静态代码分析与 HUD 读数的数学自洽性推导，修复效果以 `__interactionPerf` 实测为准。
