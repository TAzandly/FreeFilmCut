# 每次交互都掉帧：从"选中一个 clip"到 rAF 长任务

日期：2026-10-27
范围：`apps/web/src`（编辑器 React 层，不涉及合成器）

---

## 0. 结论先说

你贴的那三类现象是**同一个结构性问题**的三种表现，不是三个 bug：

| 你的观察 | 真正的机制 |
|---|---|
| 选中一个 clip 掉帧 | 选中 → 9 个 store 全量扇出 → **整条时间线（尺子刻度 + 工具栏 + 轨道行 + 每个 clip）重新提交** |
| 改一个 clip 参数掉帧 | 滑块的每个 pointermove 都写一次预览 → **每帧 2~16 次同步 React 提交** |
| `'requestAnimationFrame' handler took 51–63ms` | 不是 rAF 的锅：`useSyncExternalStore` 走同步车道，**commit 落在哪个任务里，就在哪个任务里烧完 50ms**，恰好是帧末那个预览 rAF |

一行话：**合成器早就不贵了（4ms），现在贵的是 React 的"谁都能被叫醒，而且一醒就是整棵树"。**

---

## 1. 机制拆解

### 1.1 一个 store，九个管理器，一次 notify 叫醒所有人

```ts
// editor/use-editor.ts（改前）
const subscribeAll = (onChange) => {
  editor.playback.subscribe(onChange);
  editor.timeline.subscribe(onChange);
  editor.scenes.subscribe(onChange);
  editor.project.subscribe(onChange);
  editor.media.subscribe(onChange);
  editor.renderer.subscribe(onChange);
  editor.selection.subscribe(onChange);
  editor.clipboard.subscribe(onChange);
  editor.diagnostics.subscribe(onChange);
};
```

全仓 **142 处 `useEditor(...)`**，其中 **54 处带 selector**。任意一个管理器 `notify()`，这 54 个（实际挂载的更多，因为 clip 会成百上千）selector 全部重算；selector 返回**新对象/新数组**的，`Object.is` 不成立 → 重渲染。

`isShallowEqual` 只对**数组**做逐项 `Object.is`；返回对象字面量的 selector 一律"变了"。这就是扇出的放大器。

### 1.2 选中：一条订阅，整树买单

`selection.setSelectedElements()` → `notify()`。当时订阅"整个 selectedElements 数组"的地方包括：

```
timeline/hooks/use-timeline-resize.ts      ← 在 Timeline 组件体内！
timeline/hooks/element/use-element-interaction.ts ← 也在 Timeline 体内！
timeline/components/index.tsx  TrackLabelsPanel   ← 拥有每一行轨道标签
timeline/components/index.tsx  TimelineTrackRows  ← 拥有每一行轨道（= 每个 clip）
timeline/components/timeline-track.tsx            ← 每条轨道
timeline/components/timeline-element.tsx          ← 每个 clip
```

关键在于**层级**：只要 `Timeline` 本身重渲染，下面全部子树（ruler 的三百多个刻度 DOM、工具栏图标、每条轨道、每个 clip 的 context menu 子树）都跟着重新提交 —— React 不 memo 就不会跳过。改前代码里有一句注释"Parent recommits were rebuilding TimelineRuler ticks + all toolbar icons (~96ms)"，说的就是这件事；那次只摘掉了 shell 自己的订阅，**两个 hook 里的订阅还在**，所以 96ms 只是变成 50~60ms。

### 1.3 改参数：输入频率 = 提交频率

`NumberField` / slider 的 `onScrub` → `onPreview(value)` → `previewElements()` → `applyPreviewOverlay()`（O(全部轨道×元素)）→ `notify()`。

鼠标 pointermove 是 125Hz（高回报率鼠标 1000Hz）。于是**一帧之内会跑 2~16 次完整提交**：

```
pointermove ×125/s
  → applyPreviewOverlay ×125/s
  → notify ×125/s
  → SyncLane commit ×125/s   ← 每次都要 render + diff + commit 整棵订阅树
```

而屏幕 1 秒只看得见 60 个中间值，其余 65 个纯粹是烧 CPU 换掉帧。

### 1.4 为什么控制台把它记在 rAF 头上

- `react-dom-client.development.js` 里 **`requestAnimationFrame` 出现 0 次**（实测 `grep -c` = 0），所以这个 rAF 不是 react-dom 排的。
- DevTools 的 `[Violation]` 附带的位置是**违规被上报时正在执行的脚本**。
- `useSyncExternalStore` 的更新走 **SyncLane**，React 用 `queueMicrotask` 冲刷 —— 微任务在**当前任务末尾**执行，计入任务时长。

所以链路是：某个 rAF 回调（预览循环 `wakePreviewRef`）里发生了 notify → 微任务里跑完整 commit 55ms → 任务超时 → Blink 报在 rAF 头上，脚本位置停在 react-dom。**不是 rAF 慢，是 commit 慢且被记在了 rAF 的任务账上。**

---

## 2. 本轮改动

### 2.1 `diagnostics/store-fanout.ts`（新增）＋ `editor/use-editor.ts`

给每个管理器**各自的**订阅回调，带来源标签和 selector 计时：

```js
window.__editorFanout = true      // 打开
// 然后：点一个 clip / 拖一次滑块 / 拖一次画布
window.__editorFanoutDump()       // 打印表格
window.__editorFanoutReset()      // 清零
```

| 列 | 含义 |
|---|---|
| `wakes` | 该管理器一次 notify 叫醒了多少个 selector |
| `changed` | 其中多少个产出**新快照**（= 会重渲染） |
| `changed%` | 健康值是个位数百分比；选中有几十% 就是问题 |
| `selector ms` / `max sel ms` / `ms/notify` | selector 自身的 JS 成本（不含 commit） |

这张表能回答"50ms 是 selector 算的，还是 React commit 烧的"：`selector ms` 很小而 `changed` 很大 ⇒ 是 commit，不是 selector。

### 2.2 选中改为"按元素布尔订阅"

- `SelectionManager` 新增 `isElementSelected({trackId, elementId})`、`getSelectedElementCount()`、`hasMultipleElementsSelected()`、`getSelectedTrackIdsKey()`。
- 新增 `timeline/hooks/element/use-element-selected.ts`（`useElementSelected` / `useMultipleElementsSelected` / `useSelectedElementCount` / `useSelectedTrackIdsKey`）。
- `timeline-element.tsx`：不再接收 `isSelected` prop，自己订阅自己那一个布尔值；`DeleteMenuItem` 自己订阅数量（菜单打开时才挂载）。
- `timeline-track.tsx`：删掉轨道级 `useElementSelection()`，不再给每个 clip 算 `isSelected`。
- `timeline/components/index.tsx`：`TrackLabelsPanel` 与 `TimelineTrackRows` 改用 `useSelectedTrackIdsKey()`（字符串），行高亮依然正确，但"同一轨道内换一个 clip"不再重渲染这些面板。
- `use-timeline-resize.ts` / `use-element-interaction.ts`：**这两个在 `Timeline` 组件体内**，改成惰性读取（`getSelectedElements: () => editor.selection.getSelectedElements()`），`ResizeConfig.selectedElements` → `getSelectedElements()`。

效果：点一个 clip → 只有**两个** clip 的布尔值翻转（旧的 true→false、新的 false→true），其余 N-2 个 `false === false` 直接跳过，`Timeline` 不再重渲染。

### 2.3 参数写入按帧合并

新增 `timeline/hooks/use-coalesced-preview.ts`：一帧只落一次写。

- `use-keyframed-param-property.ts`：`previewValue` → `push()`；`onCommit` 先 `flush()` 再 `commitPreview()`（否则最后一帧的值会被 commit 吃掉）。
- `use-element-preview.ts`：`previewUpdates` → `push()`；`commit()` 先 `flush()`。

`flush` 是**必须**的：`commitPreview()` 把 overlay 变成真实编辑，还躺在 `pendingRef` 里的值会被静默丢弃（面板显示新值、工程存旧值）。

为此新增 `timeline/preview-flush.ts`（一个极小的注册表）：每个合并器把 `flush` 登记进去，`TimelineManager.commitPreview()` / `discardPreview()` 第一件事就是 `flushPendingPreviews()`。这样**无论谁**发起 commit/discard（面板、蒙版菜单、音量线、控制器直接调），在途的值都不会丢，也不会在 discard 之后落在没人清理的 overlay 上。

### 2.3.1 预期与实测对比的一点提醒

"从空选点第一个 clip"这个动作，**轨道行面板仍会重渲染一次**：行高亮的 key 从 `""` 变成 `"trackA"`。行面板拥有所有 clip，而 `TimelineElement` 没有 `memo`，所以这一次仍会重画 clip。真正把它变成"只重画 2 个"需要给 clip 加 `memo` + 把三个回调 curry 进 clip（见第 4 节），本轮没做。

### 2.4 顺手去掉的两笔固定开销

- `preview/components/index.tsx`：`useDeepCompareEffect` → `useEffect`。`use-deep-compare-effect` 的 `dequal` 是**每次渲染都跑**的（不是只在依赖变化时），代价 = 遍历整棵 tracks（每条轨道 × 每个元素 × 每个参数 / 蒙版 / 特效 / 关键帧）。而 `updateSceneTracks` 与 `applyPreviewOverlay` 都必然换新对象，引用比较已经更严格且免费。
- `renderer-manager.ts`：`setRenderTree` 增加引用相等短路，避免"同一棵树再发一次"造成整轮扇出。

---

## 3. 验证清单

```js
window.__editorFanout = true;
window.__renderPerf  = true;
```

1. **点一个 clip**（从空选到选中）
   - `selection` 行：`wakes` 仍然很大（订阅点本来就多），但 **`changed` 应该只剩个位数**。
   - HUD `drops` 应从 40%+ 降到个位数。
2. **拖一次滑块 1~2 秒**
   - `changed` 对应 `timeline` 行应 ≈ 帧数（60/秒），而不是 125~1000/秒。
   - `__renderPerf` 里 `preview:treePublish` 计数应 ≈ 帧数。
3. **控制台 `'requestAnimationFrame' handler took`** 应大幅减少；若仍有 30ms+，用 Performance 面板看 `commitRoot` 展开后是
   `Recalculate Style` 还是 `Layout` 占大头 —— 那就是还剩哪个子树在大范围重渲染。

回归点（手工过一遍即可）：多选/框选、右键菜单的"删除 N 个"数字、轨道行高亮、拖动 clip 与拖右边缘改时长、蒙版参数滑杆松手后数值是否被保存。

---

## 4. 还剩什么（本轮未做）

| 项 | 现状 | 建议 |
|---|---|---|
| `buildScene` 每预览帧全量重建 | 已埋点 `preview:buildScene`，**还没看过你的读数** | 若 >4ms，下一步做 "只 patch 变动节点"（elementId + 原地改 transform + treeEpoch 唤醒），而不是重建整棵树 |
| `TimelineElement` 没 `memo` | 只要祖先重渲染就全量重画，props 里还有每次新建的箭头函数 | 把 `track` 交给 clip 自己 curry 回调后 `memo`，提交类操作用才真正只重画受影响的 clip |
| `audio-volume-line` / 蒙版握手柄拖动 | 仍是每 pointermove 一次写 | 复用 `useCoalescedPreview` |
| `fcc-light-fps` HUD 自身 rAF | 常驻探针 | 不测时可关 |

---

> 本报告基于静态代码分析、React 19 `useSyncExternalStore` 的调度语义与既有 HUD/span 读数推导，收益以你复测的 `__editorFanout` / `__renderPerf` 为准。架构没有银弹：这些改动的共同前提是"订阅粒度 = 实际使用的粒度"，如果你的项目里 clip 数量只有几十个，收益会不如预期明显。
