# FreeFilmCut 剪辑端性能优化方案（可执行改造手册）

- 依据：《FreeFilmCut 剪辑端性能评审报告》（`docs/performance-review-2026-10-27.md`，评分 47/100 D+）
- 目标：让"改一个元素的参数"这条路径只付出"一个元素"的代价
- 日期：2026-10-27
- 适用代码：`freefilmcut/apps/web/src`

---

## 0. 先定标准：什么算"解决了"

改造之前先把尺子立起来，否则做完只能靠感觉说"好像快了"。

| 编号 | 场景（固定录制脚本） | 指标 | 达标线 |
|---|---|---|---|
| M1 | 100 元素时间线，拖动单个 clip 3 秒 | 平均帧时间 / 长任务数 | ≤ 16.7ms / 长任务 0 |
| M2 | 100 元素，拖变换手柄缩放 3 秒 | 长任务数（>50ms） | 0 |
| M3 | 播放中拖动音量线 / 蒙版手柄 | 音频中断次数 | 0 |
| M4 | 10 个音频 clip 横向滚动 3 秒 | 每帧 `Layout` 次数 | ≤ 2 |
| M5 | 1080p 播放（含逐字花字 + Bloom） | FPS | ≥ 30（LOD 生效） |
| M6 | 打开 100 元素项目 | 首屏可交互时间 | ≤ 1.5s |

**当前基线（静态推导，需实测确认）**：M1 单次 mousemove 成本 ≈ O(N) 对象分配 + O(30N) 订阅回调 + O(N) 节点重建；1000Hz 鼠标下事件处理量是显示刷新率的 8~16 倍。

> 建议把上表复制到项目 issue，每次合并前填一次实测值。没有数字的优化不可验收。

---

## 1. 总览：四个批次

| 批次 | 内容 | 关系统 | 预期效果 | 风险 |
|---|---|---|---|---|
| **A 止血** | rAF 合并、框选监听、音频拆栈、波形签名 | 1~2 天 | 拖动跟手；播放中拖拽不再爆音 | 低（局部、可单独回滚） |
| **B 结构** | 分 store selector、预览 overlay 版本化 + 结构共享、时长缓存 | 3~5 天 | notify 成本降一个数量级 | 中（触及订阅契约） |
| **C DOM 规模** | memo + 稳定回调、可视区间裁剪、全局右键菜单、节点 diff 复用、吸附二分 | 1 周 | 100 元素下提交组件数 100+ → ~15 | 中高（交互回归要测） |
| **D 渲染管线** | 播放态 LOD 联动；逐字重构 | 按既定计划 | 1080p 播放 ≥ 30fps | 高（放最后） |

**依赖关系**：A 独立可做；B 是 C 的前置（没有结构共享，memo 会一直失效）；C 内部顺序 C1 → C2 → C3/C4；D 不依赖前面。

**一条铁律**：不要为了"看起来更 React"去加 `useMemo` / `React.memo`。在 B 完成之前，任何 memo 都会被"每次新建整棵树"打败，只是白增代码。

---

## 2. 批次 0：先接上度量（30 分钟，必做）

现有探针只能看到**渲染**耗时（`window.__renderPerf`、`components/fcc-light-fps.tsx`），看不到**交互**耗时。补一个长任务与事件频率计数器，放在 dev only。

```ts
// src/diagnostics/interaction-perf.ts
type InteractionPerfState = {
  longTasks: number[];
  moveEvents: number;
  frames: number;
};

export function installInteractionPerf(): () => void {
  if (typeof window === "undefined") return () => {};

  const state: InteractionPerfState = { longTasks: [], moveEvents: 0, frames: 0 };
  (window as unknown as { __interactionPerf: unknown }).__interactionPerf = state;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      state.longTasks.push(entry.duration);
    }
  });
  observer.observe({ entryTypes: ["longtask"] });

  const onMove = () => {
    state.moveEvents += 1;
  };
  document.addEventListener("pointermove", onMove, { passive: true });

  let raf = 0;
  const tick = () => {
    state.frames += 1;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    observer.disconnect();
    document.removeEventListener("pointermove", onMove);
    cancelAnimationFrame(raf);
  };
}
```

在编辑器页面 `useEffect` 里 `installInteractionPerf()`（仅 `process.env.NODE_ENV !== "production"`）。

**怎么读**：拖 3 秒后看控制台

```js
const s = window.__interactionPerf;
({
  eventsPerFrame: (s.moveEvents / s.frames).toFixed(2), // 改前应 >1.5，改后 ≈1
  longTasks: s.longTasks.length,
  maxLongTask: Math.max(0, ...s.longTasks).toFixed(1),
});
```

`eventsPerFrame` 是最直观的"合并生效"证据：A1 落地后应该稳定在 1.0 附近。

---

## 3. 批次 A：止血（1~2 天）

### A1　统一 rAF 合并指针移动

**为什么先做这条**：它是唯一能在不改架构的前提下，把后面所有 O(N) 成本直接砍掉 60%~90% 的改动。1000Hz 鼠标 → 每帧 16 个事件，合并后每帧 1 次。

**新增工具**（放 `src/timeline/controllers/raf-pointer-move.ts`，后面 5 个 controller 共用）：

```ts
export interface PointerPoint {
  clientX: number;
  clientY: number;
}

export interface RafPointerMove {
  push: (point: PointerPoint) => void;
  /** 鼠标抬起前调用：补上最后一帧未处理的坐标，保证落点与鼠标一致 */
  flushNow: () => void;
  cancel: () => void;
}

export function createRafPointerMove({
  onFrame,
}: {
  onFrame: (point: PointerPoint) => void;
}): RafPointerMove {
  let pending: PointerPoint | null = null;
  let frameId = 0;

  const flush = () => {
    frameId = 0;
    const point = pending;
    pending = null;
    if (point) onFrame(point);
  };

  return {
    push(point) {
      pending = point;
      if (frameId === 0) frameId = requestAnimationFrame(flush);
    },
    flushNow() {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      flush();
    },
    cancel() {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      pending = null;
    },
  };
}
```

**改法（以 `timeline/controllers/element-interaction-controller.ts` 为例）**：

原来 `:529` 的 `handleMouseMove` 是「收事件 → 直接干活」。拆成两层：

```ts
// 1) 把原 handleMouseMove 整体改名为 applyPointerMove，签名收 PointerPoint
private applyPointerMove = ({ clientX, clientY }: PointerPoint): void => {
  const scrollContainer = this.deps.viewport.getTracksScrollEl();
  if (!scrollContainer) return;

  if (this.session.kind === "pending") {
    this.beginDragFromPending({
      mousedown: this.session.mousedown,
      clientX,
      clientY,
      scrollContainer,
    });
    return;
  }

  if (this.session.kind === "dragging") {
    this.updateActiveDrag({
      mousedown: this.session.mousedown,
      drag: this.session.drag,
      clientX,
      clientY,
      scrollContainer,
    });
  }
};

// 2) 注意：applyPointerMove 必须在 rafPointerMove 之前声明（类字段按声明顺序初始化）
private rafPointerMove = createRafPointerMove({ onFrame: this.applyPointerMove });

// 3) 事件层只写坐标
private handleMouseMove = ({ clientX, clientY }: MouseEvent): void => {
  this.rafPointerMove.push({ clientX, clientY });
};
```

**必须同时改两处，否则会丢最后一个落点**：

```ts
// activate()/deactivate() 不变，仍订阅 document mousemove/mouseup

private handleMouseUp = (event: MouseEvent): void => {
  // 先把未处理的最后一帧补上，否则 drop 位置用的是上一帧坐标
  this.rafPointerMove.flushNow();
  /* ...原有逻辑... */
};

private finishSession(): void {
  this.rafPointerMove.cancel();
  /* ...原有逻辑... */
}
```

**同样改这 4 处**（模式完全一致）：

| 文件 | 现状 | 注意点 |
|---|---|---|
| `timeline/controllers/resize-controller.ts:246` | 直接订阅 mousemove | 同上；`flushNow` 要在 mouseup 里 |
| `timeline/controllers/keyframe-drag-controller.ts:245` | 同上 | 拖关键帧落点敏感，务必 flush |
| `timeline/controllers/playhead-controller.ts:218` | 同上 | 拖动播放头本身很频繁，收益最大 |
| `bookmarks/hooks/use-bookmark-drag.ts:215` | 同上 | React 版：用 `useRef` 持有 `createRafPointerMove` 实例，effect 清理时 `cancel()` |

**验收**：`window.__interactionPerf.eventsPerFrame` ≈ 1.0；M1 长任务数下降；拖动时元素位置与鼠标无可见延迟（重点看 4K 缩放 400% 时）。

**风险与对策**：
- 首帧延迟约 16ms：拖拽起点会晚一帧。`beginDragFromPending` 里已有 5px 阈值判断，用户无感；但如果你在 `pending` 态有"按下即视觉反馈"的逻辑，保留在 `mousedown` 里，别挪进 rAF。
- 后台标签页 rAF 被节流：鼠标事件同时也不再产生，不构成问题。

---

### A2　框选：监听器只挂一次

**现状**（`selection/hooks/use-box-select.ts:136-182`）：`useEffect` 依赖 `selectionBox`（对象），而每次 mousemove 都 `setSelectionBox(新建对象)` → **每次移动都卸载重挂一对 window 监听**，外加 effect 内闭包读到的是"上一次的 box"。

**改法**：把"是否处于框选态"作为 effect 依赖（布尔），handler 通过 ref 读最新值。

```tsx
const selectionBoxRef = useRef(selectionBox);
selectionBoxRef.current = selectionBox;
const updateSelectionRef = useRef(updateSelection);
updateSelectionRef.current = updateSelection;

const hasSelectionBox = selectionBox !== null;

useEffect(() => {
  if (!hasSelectionBox) return;

  let frameId = 0;
  let pendingPoint: { clientX: number; clientY: number } | null = null;

  const applyMove = () => {
    frameId = 0;
    const box = selectionBoxRef.current;
    const point = pendingPoint;
    pendingPoint = null;
    if (!box || !point) return;

    const container = containerRef.current;
    const nextSelectionBox = {
      ...box,
      currentPos: point,
      bounds: container
        ? getSelectionBoxBounds({ container, startPos: box.startPos, currentPos: point })
        : null,
      isActive:
        Math.abs(point.clientX - box.startPos.x) > 5 ||
        Math.abs(point.clientY - box.startPos.y) > 5 ||
        box.isActive,
    };

    setSelectionBox(nextSelectionBox);
    if (nextSelectionBox.isActive) {
      updateSelectionRef.current(nextSelectionBox);
    }
  };

  const handleMouseMove = ({ clientX, clientY }: MouseEvent) => {
    pendingPoint = { clientX, clientY };
    if (frameId === 0) frameId = requestAnimationFrame(applyMove);
  };

  const handleMouseUp = () => {
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    pendingPoint = null;

    if (selectionBoxRef.current?.isActive) {
      justFinishedSelectingRef.current = true;
      requestAnimationFrame(() => {
        justFinishedSelectingRef.current = false;
      });
    }
    setSelectionBox(null);
  };

  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);

  return () => {
    if (frameId !== 0) cancelAnimationFrame(frameId);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  };
}, [containerRef, hasSelectionBox]);
  // 依赖从 selectionBox（每次移动都变）→ hasSelectionBox（只在开始/结束时变）
```

**顺带修一个正确性问题**：原实现里 `handleMouseUp` 读的是 effect 闭包里的 `selectionBox`，是**上一次**的值，快速点击时可能判断不出 `isActive`。改用 ref 后顺手修掉。

**验收**：框选 100 元素，`eventsPerFrame` ≈ 1；DevTools 里 `addEventListener` 不再随移动增长（Performance 面板搜 `EventTarget.addEventListener`）。

---

### A3　音频：忽略预览态变更

**现状**（`core/managers/audio-manager.ts:107-121`）：订阅 timeline 的**每一次** notify，进函数就 `disposeSinks()` + 清两个缓存；播放中还 `startPlayback` 重头来。配合"预览每帧 notify"，**拖变换手柄的每帧都在拆音频栈**。

**第一步：给 notify 带上变更原因**（`core/managers/timeline-manager.ts`）

```ts
export type TimelineChangeReason = "commit" | "preview";

private listeners = new Set<(reason: TimelineChangeReason) => void>();

subscribe(listener: (reason: TimelineChangeReason) => void): () => void {
  this.listeners.add(listener);
  return () => {
    this.listeners.delete(listener);
  };
}

private notify(reason: TimelineChangeReason = "commit"): void {
  for (const fn of this.listeners) fn(reason);
}
```

然后只改三个调用点：

```ts
previewElements(...) {   // :795-796
  this.previewTracks = this.applyPreviewOverlay(committedTracks);
  this.notify("preview");          // ← 原 this.notify()
}

discardPreview() {       // :821
  this.notify("preview");          // ← 原 this.notify()
}

updateTracks(...) {      // 保持 "commit"（默认值）
  this.notify();
}
```

> 兼容性：`subscribe` 的形参从 `() => void` 变成 `(reason) => void`。`() => void` 可赋给它（参数被忽略），`useSyncExternalStore` 的 `(onStoreChange: () => void) => ...` 也满足逆变要求，所以**不需要改任何现有订阅方**。

**第二步：AudioManager 只在"提交"时重建**（`core/managers/audio-manager.ts:107`）

```ts
private handleTimelineChange = (reason?: TimelineChangeReason): void => {
  if (reason === "preview") {
    this.syncPreviewVolume();
    return;
  }

  this.disposeSinks();
  this.preparedClipBuffers.clear();
  this.decodedBuffers.clear();

  if (!this.editor.playback.getIsPlaying()) return;
  void this.startPlayback({
    time: this.editor.playback.getCurrentTime() / TICKS_PER_SECOND,
  });
};
```

**第三步（建议做，否则音量线拖动会失去实时听感）**：保留"预览期改音量"的听觉反馈，但只动增益，不重建解码。

```ts
// audio-manager.ts
private clipGains = new Map<string, GainNode>(); // elementId → 增益节点

// 在 :289 与 :489 两处 new GainNode 之后登记
this.clipGains.set(clip.id, clipGain);

// disposeSinks() 内一并清空
this.clipGains.clear();

private syncPreviewVolume(): void {
  if (!this.editor.playback.getIsPlaying()) return;
  const audioContext = this.audioContext;
  if (!audioContext) return;

  for (const [elementId, gainNode] of this.clipGains) {
    const overlay = this.editor.timeline.getPreviewOverlay(elementId);
    const volume = overlay?.volume;
    if (typeof volume !== "number") continue;
    gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, 0.01);
  }
}
```

配套在 `TimelineManager` 加一个只读入口：

```ts
getPreviewOverlay(elementId: string): Partial<TimelineElement> | undefined {
  return this.previewOverlay.get(elementId);
}
```

> 注意：`clipGains` 的 key 要确认用的是 `AudioClipSource.id`（即 element id）。若 `clip.id` 不是 element id，改用 `clip.timelineElement.id`（`:490` 处已有 `clip.timelineElement` 可用）。

**验收**：M3 —— 播放中拖音量线/蒙版 3 秒，音频无中断、无爆音；Performance 面板里 `disposeSinks` / demux 相关帧消失。

**风险**：如果某些"预览"实际会改变音轨结构（目前没有，`previewElements` 只接受 `Partial<TimelineElement>` 字段覆盖，不改轨道归属），忽略是安全的。将来若把"换轨"也接进 preview，必须重新归类为 `commit`。

---

### A4　波形：签名去掉 `JSON.stringify`，滚动并入 rAF

**现状**（`timeline/components/audio-waveform.tsx:157-181`）：每次滚动帧对 **200 个增益采样**做一次 `JSON.stringify`；`:329-333` 每个音频 clip 挂一个 scroll 监听，各自 `drawVisible()`，其中 `:114` 和 `:127` 各做一次 `getBoundingClientRect()`（强制同步布局）。

**改法一：签名改为字段比较 + 引用比较**

```ts
type RenderSignature = {
  elementWidth: number;
  clipLeft: number;
  clipRight: number;
  visibleWidth: number;
  canvasW: number;
  canvasH: number;
  barCount: number;
  dpr: number;
  clipDurationSec: number;
  sourceStartSec: number;
  pixelsPerSecond: number;
  retime: unknown;
  summaryKey: string;
  summarySampleRate: number;
  summaryTotalSamples: number;
  summaryBucketSize: number;
  gainSamples: number[] | null;   // 引用比较，不序列化
  color: string;
  burnColor: string;
};

const isSameSignature = (a: RenderSignature | null, b: RenderSignature): boolean =>
  a !== null &&
  a.elementWidth === b.elementWidth &&
  a.clipLeft === b.clipLeft &&
  a.clipRight === b.clipRight &&
  a.visibleWidth === b.visibleWidth &&
  a.canvasW === b.canvasW &&
  a.canvasH === b.canvasH &&
  a.barCount === b.barCount &&
  a.dpr === b.dpr &&
  a.clipDurationSec === b.clipDurationSec &&
  a.sourceStartSec === b.sourceStartSec &&
  a.pixelsPerSecond === b.pixelsPerSecond &&
  a.retime === b.retime &&
  a.summaryKey === b.summaryKey &&
  a.summarySampleRate === b.summarySampleRate &&
  a.summaryTotalSamples === b.summaryTotalSamples &&
  a.summaryBucketSize === b.summaryBucketSize &&
  a.gainSamples === b.gainSamples &&
  a.color === b.color &&
  a.burnColor === b.burnColor;
```

原处替换为：

```ts
const nextSignature: RenderSignature = { /* 字段同上 */ };
if (isSameSignature(lastRenderSignatureRef.current, nextSignature)) return;
lastRenderSignatureRef.current = nextSignature;
```

同时把 `lastRenderSignatureRef` 的类型改成 `useRef<RenderSignature | null>(null)`，`clearCanvas` 里置 `null` 保持不变。

> **前提**：`gainSamples` 的数组引用要稳定。目前它每帧重算（`timeline-element.tsx:1020-1027`，dep `[element]`，而 `element` 来自 `useElementPreview` 的每帧新对象）。所以 **A4 必须和下面的小改动一起做**，否则引用比较永远不等、签名永远视为"变了"（虽然仍比 stringify 便宜，但会失去跳过的意义）。

```tsx
// timeline-element.tsx:1020 附近，把 dep 从整个 element 换成真正参与计算的字段
const waveformGainSamples = useMemo(
  () => buildGainSamples({ element: renderElement }),
  [renderElement.id, renderElement.volume, renderElement.animations],
);
```

**改法二：滚动合并 + 跳过无变化滚动**

```ts
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  scrollParentRef.current = findScrollParent({ element: container });
  const scrollParent = scrollParentRef.current;
  if (!scrollParent) return;

  let frameId = 0;
  let lastScrollLeft = Number.NaN;

  const scheduleDraw = () => {
    if (frameId !== 0) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      if (scrollParent.scrollLeft === lastScrollLeft) return; // 纵向滚动等无变化场景
      lastScrollLeft = scrollParent.scrollLeft;
      drawVisible();
    });
  };

  scrollParent.addEventListener("scroll", scheduleDraw, { passive: true });
  return () => {
    scrollParent.removeEventListener("scroll", scheduleDraw);
    if (frameId !== 0) cancelAnimationFrame(frameId);
  };
}, [drawVisible]);
```

**验收**：M4 —— 10 个音频 clip 滚动，Performance 面板每帧 `Recalculate Style/Layout` ≤ 2 次（改前约 20 次）；滚动时 CPU 从"满核"降到个位数。

**如果 M4 仍不达标**，说明 `getBoundingClientRect` 的强制布局还在生效，再做 A5。

---

### A5（可选，M4 未达标才做）　共享滚动度量：一帧只读一次布局

思路：滚动时**只读一次**滚动容器 rect，把 `{ scrollLeft, rect }` 发布到一个小 store；每个 `AudioWaveform` 从 store 读，再结合自己的 `offsetLeft`（只在 resize 时读一次，滚动时不变）算 `clipLeft`。

```ts
// timeline/components/scroll-metrics.ts
type Metrics = { scrollLeft: number; left: number; right: number };
let current: Metrics = { scrollLeft: 0, left: 0, right: 0 };
const listeners = new Set<() => void>();

export function publishScrollMetrics(el: HTMLElement): void {
  const rect = el.getBoundingClientRect(); // 每帧仅此一次
  const next = { scrollLeft: el.scrollLeft, left: rect.left, right: rect.right };
  if (
    next.scrollLeft === current.scrollLeft &&
    next.left === current.left &&
    next.right === current.right
  ) {
    return;
  }
  current = next;
  for (const fn of listeners) fn();
}

export function subscribeScrollMetrics(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getScrollMetrics(): Metrics {
  return current;
}
```

`subscribeScrollMetrics` 直接接 `useSyncExternalStore`。`AudioWaveform` 里：

```ts
const metrics = useSyncExternalStore(subscribeScrollMetrics, getScrollMetrics, getScrollMetrics);
// clipLeft = Math.max(0, metrics.left - containerOffsetLeft)
// clipRight = Math.min(width, metrics.right - containerOffsetLeft)
```

**收益**：强制布局从 `2 × clips/帧` 降到 `1/帧`。**代价**：多一层模块级状态，务必保证 `publishScrollMetrics` 只在时间线的滚动容器上调用一次（放在 `TracksScroll` 的 rAF 里）。

---

## 4. 批次 B：结构改造（3~5 天）

### B1　拆 store selector（改动最小、收益最直接）

**现状**（`editor/use-editor.ts:29-49`）：`useEditor(selector)` 一次订阅 9 个 store，任何 store notify 都会让所有 selector 重跑。全仓库带 selector 的调用 **48 处**，其中元素级的那几个让每个时间线元素背上 30+ 条订阅。

**新增**（`src/editor/use-editor-store.ts`）：

```ts
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { EditorCore } from "@/core";

const UNSET = Symbol("unset");

export type EditorStoreKey =
  | "playback"
  | "timeline"
  | "scenes"
  | "project"
  | "media"
  | "renderer"
  | "selection"
  | "clipboard"
  | "diagnostics";

function isSameSnapshot({ a, b }: { a: unknown; b: unknown }): boolean {
  if (Object.is(a, b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((item, i) => Object.is(item, b[i]));
}

export function useEditorStore<T>(
  store: EditorStoreKey,
  selector: (editor: EditorCore) => T,
): T {
  const editor = useMemo(() => EditorCore.getInstance(), []);
  const cacheRef = useRef<T | typeof UNSET>(UNSET);

  const subscribe = useCallback(
    (onChange: () => void) => editor[store].subscribe(onChange),
    [editor, store],
  );

  const getSnapshot = useCallback(() => {
    const next = selector(editor);
    if (cacheRef.current !== UNSET && isSameSnapshot({ a: cacheRef.current, b: next })) {
      return cacheRef.current as T;
    }
    cacheRef.current = next;
    return next;
  }, [editor, selector]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const usePlaybackStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("playback", sel);
export const useTimelineStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("timeline", sel);
export const useScenesStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("scenes", sel);
export const useProjectStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("project", sel);
export const useMediaStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("media", sel);
export const useRendererStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("renderer", sel);
export const useSelectionStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("selection", sel);
export const useClipboardStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("clipboard", sel);
export const useDiagnosticsStore = <T>(sel: (e: EditorCore) => T) => useEditorStore("diagnostics", sel);
```

> 命名冲突预警：项目里已有 zustand 的 `useTimelineStore`（`timeline-element.tsx:305` 就在用）。**必须换个名字**，例如 `useEditorTimeline`，避免 import 后行为莫名其妙变化。这条不写清楚一定踩。

**替换方式**（可渐进，按热路径优先）：

| 文件 | 原写法 | 改为 |
|---|---|---|
| `timeline/hooks/use-element-preview.ts:22` | `useEditor((e) => e.timeline.getPreviewTracks())` | 见 B2，改成订阅"本元素的预览版本号" |
| `timeline/hooks/element/use-element-selection.ts:8` | `useEditor((e) => e.selection.getSelectedElements())` | `useEditorSelection((e) => e.selection.getSelectedElements())` |
| `timeline-element.tsx:235 / :1003 / :1100` | `useEditor((e) => e.media.getAssets())` | `useEditorMedia((e) => e.media.getAssets())` |
| `preview/components/toolbar.tsx`、`timeline/components/timeline-ruler.tsx` 等 | `useEditor((e) => e.project...)` | `useEditorProject(...)` |
| 其余 40 余处 | 同上，按 store 前缀机械替换 | — |

机械替换的检索命令：

```bash
cd freefilmcut/apps/web/src
# 按 store 前缀列出全部待替换点
grep -rn "useEditor((e) => e\.\(playback\|timeline\|scenes\|project\|media\|renderer\|selection\|clipboard\|diagnostics\)\." . | grep -v __tests__
```

**验收**：拖变换手柄时，React DevTools Profiler 里参与渲染的组件数下降 ≥ 60%；`notify` 分支数从 ~30N 降到 ~3N（用 `editor.timeline.subscribe` 计数或 Performance 火焰图估算）。

**风险**：
- 漏改的 `useEditor` 仍然是对的（只是慢），所以可以渐进，不必一次改完。
- 同一个组件里多个 store 的 selector 会分别订阅 —— 这本来就是期望行为。
- 不要删除 `useEditor` 的 no-selector 重载（它用的是 `subscribeNone`，不订阅任何东西，是零成本的）。

---

### B2　预览 overlay：版本号 + 结构共享（B1 的前置闭环）

**问题**（`timeline-manager.ts:761-797`、`:824-852`）：
1. `applyPreviewOverlay` 里 `overlay/audio` 的 `.map` 每次新建数组，`SceneTracks` 顶层对象每次新建 → 下游任何 `===` 比较全部失效
2. `getPreviewTracks()` 返回整棵树 → `useElementPreview` 每个元素都订阅全树、再自己做 `find`（O(N)/元素/帧）

**改造 1：受影响数组/对象复用原引用**

```ts
private applyPreviewOverlay(tracks: SceneTracks): SceneTracks {
  if (this.previewOverlay.size === 0) return tracks;

  const prev = this.previewTracks;

  const applyTrackOverlay = <TTrack extends TimelineTrack>(track: TTrack): TTrack => {
    const hasOverlay = track.elements.some((element) => this.previewOverlay.has(element.id));
    if (!hasOverlay) return track;

    let changed = false;
    const nextElements = track.elements.map((element) => {
      const overlay = this.previewOverlay.get(element.id);
      if (!overlay) return element;
      changed = true;
      return { ...element, ...overlay } as TimelineElement;
    });

    return changed ? ({ ...track, elements: nextElements } as TTrack) : track;
  };

  const mapTracks = <TTrack extends TimelineTrack>(
    list: readonly TTrack[],
    prevList: readonly TTrack[] | undefined,
  ): TTrack[] => {
    let changed = !prevList || prevList.length !== list.length;
    const nextList = list.map((track, index) => {
      const applied = applyTrackOverlay(track);
      if (applied !== track) changed = true;
      else if (prevList && prevList[index] !== track) changed = true;
      return applied;
    });
    return changed ? nextList : (prevList as TTrack[]);
  };

  const overlay = mapTracks(tracks.overlay, prev?.overlay);
  const main = applyTrackOverlay(tracks.main);
  const audio = mapTracks(tracks.audio, prev?.audio);

  if (prev && prev.overlay === overlay && prev.main === main && prev.audio === audio) {
    return prev;
  }
  return { overlay, main, audio };
}
```

这一版之后：拖动一个元素时，`overlay`/`audio` 数组引用不变，只有 `main`（或承载该元素的轨道）变。下游按引用做的 memo 开始真正生效。

**改造 2：per-element 版本号 + O(1) 读取**

```ts
// 字段
private previewOverlayVersion = 0;
private previewElementById = new Map<string, TimelineElement>(); // 已套用 overlay 的元素
private previewElementVersionById = new Map<string, number>();

// previewElements 内，changedOverlayCount > 0 时
this.previewOverlayVersion += 1;
for (const { elementId, updates: elementUpdates } of updates) {
  if (!changedIds.has(elementId)) continue;
  const base = this.findElementById(elementId); // 复用现有 getElementByRef / findTrackIdForElement
  if (!base) continue;
  this.previewElementById.set(elementId, { ...base, ...this.previewOverlay.get(elementId) } as TimelineElement);
  this.previewElementVersionById.set(elementId, this.previewOverlayVersion);
}

// 公开
getPreviewElement<T extends TimelineElement>({ elementId }: { elementId: string }): T | null {
  return (this.previewElementById.get(elementId) as T | undefined) ?? null;
}

getElementPreviewVersion(elementId: string): number {
  return this.previewElementVersionById.get(elementId) ?? 0;
}

// updateTracks / commitPreview / discardPreview 里一并清理三个结构
```

> 清理时机很关键：`commitPreview()` 末尾 `updateTracks(afterTracks)` 会重建树，此时必须 `previewElementById.clear()` 并把所有版本号 +1，否则元素会继续显示旧预览值。

**改造 3：`useElementPreview` 改成订阅本元素版本**

```ts
export function useElementPreview<T extends TimelineElement>({ trackId, elementId, fallback }: {...}) {
	const editor = useEditor();
	// 只订阅 timeline，且返回值是稳定数字 → 别的元素变化不会触发本元素重渲染
	const version = useEditorStore("timeline", (e) => e.timeline.getElementPreviewVersion(elementId));

	const renderElement = useMemo(() => {
		const preview = editor.timeline.getPreviewElement<T>({ elementId });
		return preview ?? fallback;
	}, [editor, elementId, version, fallback]);

	const previewUpdates = (updates: Partial<TimelineElement>) =>
		editor.timeline.previewElements({ updates: [{ trackId, elementId, updates }] });

	const commit = () => editor.timeline.commitPreview();

	return { renderElement, previewUpdates, commit };
}
```

**收益**：
- 元素级订阅从"9 store × 整树" 变成 "1 store × 一个数字"
- `find` 从 O(N)/元素/帧 变成 O(1)（且 `useMemo` 后只在版本变化时执行）

**验收**：100 元素时间线，拖单个元素时 Profiler 中渲染组件数 ≤ 3（当前应接近 100）。

---

### B3　总时长缓存

**现状**（`timeline/index.ts:15-34` + `core/managers/playback-manager.ts:238`）：`calculateTotalDuration` 每次调用都 `[...tracks.overlay, tracks.main, ...tracks.audio]` 分配数组并全量遍历；28 处调用点，其中一处**在 rAF 里每帧调用**。

**改法**：在 `TimelineManager` 里做一层引用缓存。

```ts
private totalDurationCache: { tracks: SceneTracks; duration: MediaTime } | null = null;

getTotalDuration(): MediaTime {
  const tracks = this.getPreviewTracks() ?? /* 已提交树 */;
  const cached = this.totalDurationCache;
  if (cached && cached.tracks === tracks) return cached.duration;
  const duration = calculateTotalDuration({ tracks });
  this.totalDurationCache = { tracks, duration };
  return duration;
}
```

**配合 B2**：结构共享生效后，"拖一个元素不改总时长"这种情况下 `tracks` 引用不变（轨道数不变、元素数不变），缓存命中率会很高。但注意：拖动改变的不只是元素内部字段，`startTime` 也可能变（时间线拖动）→ 那时 `tracks` 引用会变，缓存失效，属于正确行为。

**更省的做法**（如果命中率低）：缓存"最大结束时间"，`getTotalDuration` 只在元素增删/时长变更时重算，位置平移时做增量修正。**不建议一上来就这么做**，先用引用缓存，拿到数据再决定。

**验收**：播放时每帧省一次 O(N) 遍历；`Performance` 面板里 `calculateTotalDuration` 应该从火焰图消失。

---

## 5. 批次 C：DOM 规模（1 周）

### C1　`TimelineElement` memo + 稳定回调 + dragView 收窄

这是最容易被做错的一步，分三个小步，缺一不可。

**第一步：把内联箭头函数从 props 里去掉**

现状（`timeline-track.tsx:95-107`）每个元素渲染时新建 3 个箭头函数，即便加了 `memo` 也必然失效。做法是让子组件自己拼 `track`（它本来就收到了 `track`）：

```tsx
// timeline-track.tsx
track.elements.map((element) => (
  <TimelineElement
    key={element.id}
    element={element}
    track={track}
    zoomLevel={zoomLevel}
    isSelected={isElementSelected({ trackId: track.id, elementId: element.id })}
    onResizeStart={onResizeStart}          // 直接透传
    onElementMouseDown={onElementMouseDown}
    onElementClick={onElementClick}
    dragView={isDragMember ? dragView : null}   // 见第三步
    isDropTarget={element.id === targetElementId}
  />
))
```

```tsx
// timeline-element.tsx，props 契约改为
interface TimelineElementProps {
  element: TimelineElementType;
  track: TimelineTrack;
  zoomLevel: number;
  isSelected: boolean;
  onResizeStart: (params: {
    event: React.MouseEvent;
    element: TimelineElementType;
    track: TimelineTrack;
    side: "left" | "right";
  }) => void;
  onElementMouseDown: (params: {
    event: React.MouseEvent;
    element: TimelineElementType;
    track: TimelineTrack;
  }) => void;
  onElementClick: (params: {
    event: React.MouseEvent;
    element: TimelineElementType;
    track: TimelineTrack;
  }) => void;
  dragView: ElementDragView | null;
  isDropTarget?: boolean;
}
```

组件内部三处调用改成带上 `track`（原本由父级补的）：

```tsx
onMouseDown={(event) => onElementMouseDown({ event, element, track })}
```

**第二步：memo，并确认上层回调稳定**

```tsx
export const TimelineElement = memo(function TimelineElement(props: TimelineElementProps) {
  return <TimelineElementInner {...props} />;
});
```

上层 `onResizeStart / onElementMouseDown / onElementClick` 来自 `timeline/components/index.tsx:577-579`，需要确认它们是 `useCallback` 或 controller 实例方法（稳定）。**如果不是**，加一个极小的稳定化工具：

```ts
// src/hooks/use-stable-callback.ts
export function useStableCallback<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R {
  const ref = useRef(fn);
  ref.current = fn;
  const stable = useCallback((...args: Args) => ref.current(...args), []);
  return stable;
}
```

**第三步：`dragView` 只传给被拖成员（关键细节）**

拖动时 `dragView.currentTime` 每帧变，如果所有元素都收 `dragView`，memo 全员失效 —— 等于白做。所以：

```tsx
const isDragMember =
  dragView?.kind === "dragging" && dragView.memberTimeOffsets.has(element.id);

<TimelineElement
  dragView={isDragMember ? dragView : null}
  ...
/>
```

组件内部：

```tsx
const isDragging = dragView?.kind === "dragging";
const dragTimeOffset = isDragging ? dragView.memberTimeOffsets.get(element.id) : undefined;
const isBeingDragged = dragTimeOffset !== undefined;
const dragOffsetY = isDragging && isBeingDragged ? dragView.currentMouseY - dragView.startMouseY : 0;
```

**验收**：拖动单个元素时，Profiler 里 `TimelineElement` 的 render 次数从 N 降到 ~1（被拖的那个 + 落点目标）。

---

### C2　按可视区间裁剪（虚拟化）

**核心难点**：`timeline/components/index.tsx:183` 有注释——他们**故意移除了 `useScrollPosition`**，因为它让整个 Timeline（labels + ruler + toolbar）每个滚动 tick 重渲染。所以**不能**在 TimeLine 顶层再引入滚动 state。

**正确做法**：把订阅下沉到轨道行，且**只在"可见元素集合"变化时才 setState**。

```ts
// timeline/hooks/use-visible-element-ids.ts
export function useVisibleElementIds({
  scrollRef,
  computeVisibleIds,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  computeVisibleIds: () => string[];
}): ReadonlySet<string> {
  const computeRef = useRef(computeVisibleIds);
  computeRef.current = computeVisibleIds;

  const [key, setKey] = useState("");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let frameId = 0;
    const update = () => {
      // 只在空闲帧计算，且只在"集合真变了"时 setState
      const nextKey = computeRef.current().join("|");
      setKey((prev) => (prev === nextKey ? prev : nextKey));
    };
    const onScroll = () => {
      if (frameId !== 0) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        update();
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    update();

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frameId !== 0) cancelAnimationFrame(frameId);
    };
  }, [scrollRef]);

  return useMemo(() => (key ? new Set(key.split("|")) : new Set<string>()), [key]);
}
```

在 `TimelineTrackContent` 里：

```tsx
const scrollRef = useTracksScrollRef(); // 从 editor.viewport 拿容器（viewport.getTracksScrollEl）
const scrollElRef = useRef<HTMLElement | null>(null);
scrollElRef.current = scrollRef;

const visibleIds = useVisibleElementIds({
  scrollRef: scrollElRef,
  computeVisibleIds: () => {
    const el = scrollElRef.current;
    if (!el) return track.elements.map((e) => e.id);

    const bufferPx = Math.max(400, el.clientWidth * 0.25); // 过扫描，避免快速滚动露白
    const startTime = pixelsToTime({ px: el.scrollLeft - bufferPx, zoomLevel });
    const endTime = pixelsToTime({ px: el.scrollLeft + el.clientWidth + bufferPx, zoomLevel });

    return track.elements
      .filter((e) => e.startTime + e.duration >= startTime && e.startTime <= endTime)
      .map((e) => e.id);
  },
});

const renderedElements = useMemo(
  () => track.elements.filter((element) => visibleIds.has(element.id)),
  [track.elements, visibleIds],
);
```

然后用 `renderedElements` 替代 `track.elements.map(...)`。

**三个必须注意的点**：

1. **元素是绝对定位的**（left 由绝对时间算出），所以裁剪不会破坏布局 —— 这点已确认，可以安全裁。
2. **`TransitionOverlays` 也要裁**，否则转场标记还在遍历全量元素（`timeline-track.tsx:110`）。
3. **拖拽中被拖的元素若滚出可视区**，会因为裁剪而消失 —— 必须把 `dragView.memberTimeOffsets` 里的 id 强制加入可见集合：

```tsx
const forcedIds = dragView?.kind === "dragging" ? Array.from(dragView.memberTimeOffsets.keys()) : [];
```

**验收**：500 元素项目，DOM 节点数（DevTools Elements 面板搜索 `[data-timeline-element]`）与视口内元素数同阶；首屏可交互 ≤ 1.5s（M6）；滚动时 CSS 长帧数不增加（用 M4 方法验证没有引入回归）。

---

### C3　全局右键菜单（一次性砍掉 N 份 Radix 树）

现状（`timeline-element.tsx:379-511`）：每个元素一个 `ContextMenu + Trigger + Content`，内含 8~10 个 `ContextMenuItem`。100 元素 = 100 份 Radix Root + 1000 个 React 元素常驻内存。

**改法**：只保留一份，用"当前右键目标"驱动。

```tsx
// timeline/components/timeline-context-menu.tsx
const contextTargetAtom = { trackId: "", elementId: "" };   // 放现有 store 或 React context

// TimelineElement 里
<div
  onContextMenu={(event) => {
    event.preventDefault();
    setContextTarget({ trackId: track.id, elementId: element.id });
    contextMenuRef.current?.open(event);   // 直接命令式打开
  }}
>

// Timeline 根节点渲染一份
<TimelineContextMenu target={contextTarget} />
```

**收益**：常驻 React 元素减少 ~1000 个；元素组件的 props/内部结构变简单，memo 更有效。

**风险**：Radix 的受控打开、定位（`anchor`）、键盘可访问性要按官方文档调整；这是**交互回归风险最高**的一项，务必手工过一遍：右键位置、子菜单、快捷键、关闭后焦点回归。

---

### C4　`buildScene` 按 elementId 复用节点

**现状**（`preview/components/index.tsx:119-133`）：`useDeepCompareEffect` 对整棵树深比较，然后 `buildScene` 为所有元素 `new` 节点。未改动元素的节点身份丢失 → 文字贴图、视频 texture 等下游缓存全部失效。

**改法**：把节点构建变成"可复用工厂"。

```ts
// services/renderer/scene-builder.ts
export type NodeCacheEntry = {
  element: TimelineElement;
  mediaAsset: MediaAsset | undefined;
  node: AnyBaseNode;
};

export type BuildSceneOptions = {
  previous?: Map<string, NodeCacheEntry>;
};

export function buildScene(args: {
  tracks: SceneTracks;
  mediaAssets: MediaAsset[];
  duration: MediaTime;
  canvasSize: TCanvasSize;
  background: TBackground;
  previous?: Map<string, NodeCacheEntry>;
}): { root: RootNode; cache: Map<string, NodeCacheEntry> } {
  // buildTrackNodes 内，对每个 element：
  const cached = previous?.get(element.id);
  if (cached && cached.element === element && cached.mediaAsset === mediaAsset) {
    nodes.push(cached.node);      // 直接复用，贴图/texture 全保留
    nextCache.set(element.id, cached);
    continue;
  }
  const node = createNodeForElement({ element, mediaAsset, ... });
  nextCache.set(element.id, { element, mediaAsset, node });
  nodes.push(node);
}
```

调用侧：

```tsx
const nodeCacheRef = useRef<Map<string, NodeCacheEntry> | undefined>(undefined);

useDeepCompareEffect(() => {
  const { root, cache } = buildScene({ tracks, mediaAssets, duration, canvasSize, background, previous: nodeCacheRef.current });
  nodeCacheRef.current = cache;
  editor.renderer.setRenderTree({ renderTree: root });
}, [tracks, mediaAssets, background, width, height]);
```

**注意**：节点复用要求 `element` 引用稳定 → 依赖 B2 的结构共享。否则每个元素引用都变，缓存永远不命中（但不会错，只是没收益）。

另外：`useDeepCompareEffect` 在 B2 之后可以降级为普通 `useEffect`（因为引用比较已经足够），能省掉一次全树深比较。**这一步建议放在 B2 之后单独提交，便于回滚。**

**验收**：拖动一个文字元素时，`__renderPerf` 的 `syncTextures` p50 应有明显下降（未改动元素的贴图不再重建）。

---

### C5　吸附：拖拽开始时构建一次 + 二分查找

**现状**（`timeline/group-move/snap.ts:36-45`）：每次 mousemove 都 `buildTimelineSnapPoints`（O(N) 遍历 + 2N 个对象），再对每个成员做 4 次线性 `resolveTimelineSnap`（`snapping/resolve.ts:12-29`）。

**关键洞察**：拖拽期间**其它元素的边界是静态的**，只有被拖元素自身在动（而且它已经被 `excludeElementIds` 排除）。所以 snapPoints 应该**在 `beginDragFromPending` 时构建一次**。

```ts
// element-interaction-controller.ts
private session: { kind: "dragging"; drag: DragProgress; snapPoints: SnapPointSet } | ...

// beginDragFromPending 内
const snapPoints = buildTimelineSnapPoints({ sources: [...] }); // 一次性

// updateActiveDrag → snapResult 内
const result = resolveGroupEdges({
  group,
  anchorStartTime: frameSnappedTime,
  snapPoints,           // 传入已构建好的集合
  zoomLevel,
});
```

```ts
// snapping/resolve.ts：排序 + 二分
export type SortedSnapPoints = { times: Float64Array; points: SnapPoint[] };

export function buildSortedSnapPoints({ points }: { points: SnapPoint[] }): SortedSnapPoints {
  const sorted = points.slice().sort((a, b) => a.time - b.time);
  const times = Float64Array.from(sorted.map((p) => p.time));
  return { times, points: sorted };
}

export function resolveTimelineSnap({ time, threshold, snapPoints }: {...}): SnapPoint | null {
  const index = lowerBound(snapPoints.times, time);
  let best: SnapPoint | null = null;
  let bestDistance = threshold;
  for (const candidate of [index - 1, index]) {           // 只需看相邻两个
    const point = snapPoints.points[candidate];
    if (!point) continue;
    const distance = Math.abs(point.time - time);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}
```

**注意**：播放头位置在拖拽期间可能变（自动滚动跟随），此时 snapPoints 里的 playhead 项需要单独更新 —— 建议把 playhead 项**排除在缓存之外**，在 resolve 时单独比较（只有 1 个点，O(1)）。

**验收**：10 个选中元素、100 元素项目拖动，Profiler 中 `buildTimelineSnapPoints` 不再出现；拖动帧时间下降。

---

## 6. 批次 D：渲染管线（按既定计划，最后做）

**D1（便宜、先做）**：把播放态 LOD 真正联动。

`preview/playback-quality.ts` 已有 `scaleCanvasSize` 与四档质量，但默认是 `original`。建议：

```
播放中：scale 0.5 + 关 MSAA + 关 Bloom
暂停中：恢复用户设置的全质量
```

在 `preview/components/index.tsx` 的渲染入口根据 `playback.getIsPlaying()` 选择 scale，播放态切换时只重建一次 RT（不是每帧）。

**收益**：`docs/textanim-progress-2026-10.md:78` 记录的 `~60ms` 长任务能砍掉相当一部分，成本远低于重构。

**D2（不在本次）**：逐字 Troika → 单几何 + 实例化 + glyph atlas。属于文档里已排期的 v2 重构，需要独立设计，不要和性能止血混在同一个分支里。

---

## 7. 改动清单速查表

| 编号 | 文件 | 改动量 | 收益 | 风险 |
|---|---|---|---|---|
| 0 | `diagnostics/interaction-perf.ts`（新增） | ~40 行 | 建立度量 | 无 |
| A1 | `timeline/controllers/raf-pointer-move.ts`（新增）+ 5 个 controller/hook | ~60 行 + 5 处各 ~15 行 | 事件频率 16×→1× | 低 |
| A2 | `selection/hooks/use-box-select.ts:136-182` | ~40 行重写 | 消除监听抖动 | 低 |
| A3 | `core/managers/timeline-manager.ts`（notify 签名）+ `audio-manager.ts:107` | ~30 行 | 播放中拖拽不再拆音频栈 | 低 |
| A4 | `timeline/components/audio-waveform.tsx:157-181, 329-333` + `timeline-element.tsx:1020` | ~50 行 | 滚动不再 stringify | 低 |
| A5 | `timeline/components/scroll-metrics.ts`（新增，可选） | ~40 行 | 强制布局 2N→1 | 中 |
| B1 | `editor/use-editor-store.ts`（新增）+ 48 处替换 | ~80 行 + 机械替换 | notify 分支降一个数量级 | 中 |
| B2 | `timeline-manager.ts:761-852` + `use-element-preview.ts` | ~120 行 | 元素级订阅 9→1，find O(N)→O(1) | 中 |
| B3 | `timeline-manager.ts`（新增 `getTotalDuration` 缓存） | ~20 行 | 播放每帧省一次 O(N) | 低 |
| C1 | `timeline-element.tsx`（props 契约）+ `timeline-track.tsx` | ~60 行 | memo 真正生效 | 中 |
| C2 | `timeline-track.tsx` + `hooks/use-visible-element-ids.ts`（新增） | ~70 行 | DOM 降 60%~85% | 中高 |
| C3 | 抽 `timeline-context-menu.tsx` | ~150 行 | 砍 N 份 Radix 树 | 高（交互） |
| C4 | `scene-builder.ts` + `preview/components/index.tsx:119` | ~80 行 | 节点/贴图复用 | 中 |
| C5 | `group-move/snap.ts` + `snapping/resolve.ts` | ~60 行 | O(N·k)→O(logN·k) | 中 |
| D1 | `preview/components/index.tsx` + `playback-quality.ts` | ~30 行 | 播放帧时长下降 | 低 |

---

## 8. 不要做的事（常见误改）

| 误改 | 为什么不行 |
|---|---|
| 给 `useEditor` 的 `getSnapshot` 加深度比较 / 全量 `JSON.stringify` | 每次 notify 都做 O(树) 比较，比现在的 bug 还慢 |
| 用 `IntersectionObserver` 做时间线虚拟化 | 元素本身就在 DOM 里才有 IO 结果，顺序反了；应该按时间区间裁剪，再 ID 判断 |
| 在 `Timeline` 顶层恢复 `useScrollPosition` | `index.tsx:183` 的注释已经踩过这个坑：整棵树每帧重渲染 |
| 给 `TimelineElement` 加 `memo` 但不改内联回调 / 不收窄 `dragView` | memo 会 100% 失效，只是增加了比较成本 |
| 把 `applyPreviewOverlay` 换成 Immer `produce` | 引入依赖 + 每次仍要遍历整棵树；先做引用复用，够用再谈 |
| 在 A1 阶段就顺手改渲染管线 | 无法归因收益，出问题也定位不到 |

---

## 9. 执行顺序（建议按 PR 拆）

| PR | 内容 | 预计 | 依赖 |
|---|---|---|---|
| PR-1 | 批次 0（度量）+ A1 | 0.5 天 | — |
| PR-2 | A2 + A3（含 A3b） | 0.5~1 天 | — |
| PR-3 | A4（+A5 如需要） | 0.5 天 | — |
| PR-4 | B2（结构共享 + 版本号 + `useElementPreview`） | 1~2 天 | — |
| PR-5 | B1（分 store hooks，逐目录替换） | 1~2 天 | PR-4 |
| PR-6 | B3 + C1（时长缓存 + memo 契约） | 1 天 | PR-4 |
| PR-7 | C2（裁剪）+ C5（吸附） | 1~2 天 | PR-6 |
| PR-8 | C4（节点复用）+ `useDeepCompareEffect` 降级 | 1 天 | PR-4 |
| PR-9 | C3（全局右键菜单） | 1 天 | PR-6 |
| PR-10 | D1（播放态 LOD） | 0.5 天 | — |

**每个 PR 都必须附一组 M1~M6 实测数字**（至少 M1/M2）。没有数字的 PR 不合并 —— 这是防止"改完没人知道有没有用"的唯一办法。

---

## 10. 交接备注

1. **本方案的所有行号基于 2026-10-27 的代码快照**，改动前请以实际文件为准。
2. 播放链路（`playback-manager.ts` 的时钟、`timeline-playhead.tsx` 的 DOM 直写、`preview/components/index.tsx:246-353` 的帧门控、`timeline-ruler.tsx` 的 tick 裁剪）**已经是对的，不要动**。
3. 如果只能做一件事：做 **A1**。它是唯一"1 小时改动、立刻可感"的一条。
4. 如果只能做两件事：**A1 + A3**。这两条一起解决"拖动卡 + 播放中拖拽爆音"两个最刺手的问题。

---

> 免责声明：本方案基于静态代码分析与复杂度推导，未在目标机器上跑基准测试。所有"预期收益"为基于调用链的估算，实际数值需用第 0 节的度量方法实测确认。架构没有银弹，改哪一条请结合团队排期与回归成本综合判断。
