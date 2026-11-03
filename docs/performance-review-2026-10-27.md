# FreeFilmCut 剪辑端性能评审报告

- 评审对象：`D:\GrokbotWork\FreeFilmCut`（`freefilmcut/apps/web` + Three.js 合成器 + vfxpack 文字动画）
- 评审范围：**剪辑端**（时间线、预览、拖拽交互、音频/波形、合成）
- 评审方式：静态调用链分析 + 复杂度推导（未跑基准，度量方案见第 6 节）
- 日期：2026-10-27

---

## 0. 一句话结论

**播放链路已经做过一轮认真的优化（帧门控、DOM 直写、标尺虚拟化），但"编辑动作链路"（拖拽 / 变换 / 蒙版 / 音量 / 框选）没有跟上：一次 mousemove 会重建整棵 tracks 树、唤醒全编辑器订阅者、重建全部渲染节点，并让音频管理器拆掉自己的解码缓存。** 这是剪辑端卡顿的主因，而不是渲染本身。

---

## 1. 评分总表

| 维度 | 权重 | 得分 | 判断 |
|---|---|---|---|
| 渲染/更新架构（播放循环、帧门控） | 20 | 12 | 播放侧设计良好，编辑侧缺少增量更新 |
| 时间线 DOM 规模与虚拟化 | 15 | 6 | 零虚拟化、零 memo、每元素一个 Radix 菜单 |
| 状态订阅粒度 | 15 | 6 | `useEditor` 一次订阅 9 个 store，元素级大量订阅 |
| 拖拽 / 交互帧预算 | 15 | 6 | mousemove 未合并，吸附 O(N·k)，监听器抖动 |
| 合成与 GPU 管线 | 20 | 9 | 已池化 + 已 LOD，但逐字 Troika + 多 RT blit 仍压主线程 |
| 音频与媒体 | 10 | 5 | 调度设计正确，但 timeline notify 会拆缓存/重启播放 |
| 可观测性与预算护栏 | 5 | 3 | 有 `__renderPerf` / FPS 浮层，无基线、无 CI 门禁 |
| **合计** | **100** | **47** | **D+：可用，50+ 元素或长句花字场景下必然掉帧** |

### 先给肯定的部分（这些不要动）

| 已有优化 | 位置 | 为什么值得保留 |
|---|---|---|
| 播放时钟与 React 解耦 | `timeline/controllers/playhead-controller.ts`、`timeline/components/timeline-playhead.tsx:71` | 播放头靠 controller 直接改 DOM，60fps 不提交 react-dom |
| 时间码 DOM 直写 | `preview/components/toolbar.tsx:75-89` | 注释明确写「play ticks update the span via DOM」，避开了每帧 commit |
| 预览 RAF 帧门控 + 在飞帧合并 | `preview/components/index.tsx:246-353` | `renderingRef` / `pendingRenderRef` / `lastRenderMsRef<40` 三重条件，静止帧会睡眠 |
| 标尺按可视区间生成 tick | `timeline/components/timeline-ruler.tsx:54-98` | 已虚拟化，tick 数量只跟视口宽度有关 |
| 图层 Mesh 池化 | `three-compositor.ts:2977-2984` `acquireMesh()` | 避免每帧 new PlaneGeometry/Material |
| 选中态去重 notify | `selection-manager.ts:77-100` | 相同选择不触发通知，框选不会无脑刷屏 |
| 滚动位置防抖持久化 | `zoom-controller.ts:217-232` | 300ms 防抖，避免滚动时写盘 |
| 已有性能探针 | `diagnostics/render-perf.ts`、`components/fcc-light-fps.tsx` | 后面所有优化都能直接拿来对比 |

---

## 2. P0 问题（决定"剪辑时卡不卡"）

### P0-1　一次参数变更会重建整棵 tracks 树，并唤醒全编辑器

**证据链**

1. 入口：拖变换手柄每 mousemove 就调用 `previewElements`
   - `preview/controllers/transform-handle-controller.ts:622`（角点缩放）
   - `:716`（边缩放）、`:762`（旋转）
   - 同型调用还有 `masks/use-mask-handles.ts:583`、`timeline/components/audio-volume-line.tsx:91`、`speed/components/speed-tab.tsx:94`、`components/editor/panels/properties/hooks/use-keyframed-param-property.ts:77,102`
2. `timeline-manager.ts:761-797`：`previewElements` → `this.previewTracks = this.applyPreviewOverlay(committedTracks)` → `this.notify()`
3. `timeline-manager.ts:824-852` `applyPreviewOverlay`：**整棵 `SceneTracks` 对象图重建**（`overlay` / `main` / `audio` 全量 `.map`），即使只有 1 个元素的 1 个参数变了
4. `notify()` 的放大效应见 P0-2

**机制**：把"1 个元素 1 个字段的局部变更"实现成了"全局场景快照替换"。结构共享被破坏，下游所有"引用变了→重算"的逻辑全部被激活。

**影响**：变换/缩放/旋转/蒙版/音量/速度/关键帧拖动的每一帧，代价是 O(轨道数 + 元素数) 的对象分配 + 全量通知。这与元素总数成正比，与本次改动的规模无关。

**修法（推荐顺序）**
- 短期：`applyPreviewOverlay` 改为**按 trackId 只重建受影响的轨道**，未命中的轨道直接返回原引用（现在 `hasOverlay` 分支已有，但外层 `overlay/main/audio` 的 `.map` 仍然全跑，且 `SceneTracks` 顶层对象总是新建）
- 中期：把 preview 数据从"场景树副本"里拿出来，改成 **`Map<elementId, Partial<Element>>` 覆盖层**，由读取方在需要的粒度上 apply（渲染节点、时间线元素各自取自己那一条）
- 长期：引入不可变结构共享（或直接上 Immer 的 `produce`），保证未改动子树引用不变

**预期收益**：mousemove 期间的对象分配从 O(N) 降到 O(1~k)，同时让下游的 memo / deep-compare 真正生效。这是后面几条 P0 生效的前置条件。

---

### P0-2　`useEditor` 一次订阅 9 个 store，元素级组件被全量放大

**证据**

```ts
// editor/use-editor.ts:29-49
const subscribeAll = useCallback((onChange) => {
  const unsubscribers = [
    editor.playback.subscribe(onChange),
    editor.timeline.subscribe(onChange),
    editor.scenes.subscribe(onChange),
    editor.project.subscribe(onChange),
    editor.media.subscribe(onChange),
    editor.renderer.subscribe(onChange),
    editor.selection.subscribe(onChange),
    editor.clipboard.subscribe(onChange),
    editor.diagnostics.subscribe(onChange),
  ];
  ...
```

**任何一个 store 的 notify，都会让所有 `useEditor(selector)` 调用点重跑 selector。** 而时间线元素上挂着的 `useEditor(selector)` 调用是：

| 位置 | 订阅内容 | 等价订阅数 |
|---|---|---|
| `timeline-element.tsx:235` / `:1003` / `:1100` | `e.media.getAssets()`（元素本体 / 音频 / 视频瓷砖） | 各 9 |
| `hooks/use-element-preview.ts:22` | `e.timeline.getPreviewTracks()` | 9 |
| `hooks/element/use-element-selection.ts:8` | `e.selection.getSelectedElements()` | 9 |
| `hooks/element/use-keyframe-selection.ts:22,26` | selection 的 2 个 `useSyncExternalStore` | 2 |
| `timeline-element.tsx:305,308` | `useTimelineStore` × 2 | 2 |

**单个时间线元素 ≈ 30+ 条订阅**。100 个元素 = 3000+ 条，每次 notify 全部遍历并执行 selector。全仓库 `useEditor(` 调用 142 处、带 selector 的 48 处，这还只是组件实例之外的部分。

**影响**：notify 成本与"屏幕上元素数 × 订阅数"成正比。这也是为什么 `use-editor.ts` 里 `isShallowEqual` 只能救数组——对象返回（如 `getPreviewTracks()` 在 P0-1 下每帧换新引用）直接穿透。

**修法**
- 拆 selector 层：`usePlayback(sel)` / `useTimeline(sel)` / `useMedia(sel)` / `useSelection(sel)`，各自只订阅自己的 store。**这是改动量最小、收益最直接的一条**（改 `use-editor.ts` 加一组薄封装，逐处替换，可渐进）
- 元素级优先换成原生 `useSyncExternalStore(editor.timeline.subscribe, ...)` 单 store 版本
- `useElementPreview` 不要整体订阅 `getPreviewTracks()`，改成订阅"我这个 elementId 的 overlay 版本号"

**预期收益**：notify 分支数下降一个数量级（~30N → ~3N）；同时降低 selector 侧 `find()` 的无效执行。

---

### P0-3　时间线零虚拟化 + 元素组件未 memo

**证据**

```tsx
// timeline/components/timeline-track.tsx:88-114
track.elements.map((element) => {
  const isSelected = isElementSelected({ trackId: track.id, elementId: element.id });
  return (
    <TimelineElement
      key={element.id}
      ...
      onResizeStart={({ event, element, side }) => onResizeStart({ event, element, track, side })}
      onElementMouseDown={({ event, element }) => onElementMouseDown({ event, element, track })}
      onElementClick={({ event, element }) => onElementClick({ event, element, track })}
```

- 全量 map，**没有任何按时间窗口/滚动位置的裁剪**（对比：`timeline-ruler.tsx` 是做了的）
- `timeline-element.tsx:224` `export function TimelineElement(...)` —— **没有 `memo`**
- 上面三个 prop 是**每次渲染新建的箭头函数**，即使加上 `memo` 也会失效
- `TimelineTrackRows`（`timeline/components/index.tsx:749`）同样未 memo，`dragView` 一变整行重建

每个元素的固定成本还包括：一个 `ContextMenu` + `ContextMenuTrigger` + `ContextMenuContent`（`timeline-element.tsx:379-511`，内含 8~10 个 `ContextMenuItem` 的 React 元素）、`useKeyframeDrag`/`useKeyframeBoxSelect` 两个 controller 实例、音频 clip 还会挂 `AudioWaveform` 的 canvas + scroll 监听 + ResizeObserver。

**影响**：DOM 节点数、内存、首次渲染时间、以及**每次父级重渲染的提交成本**都随元素总数线性增长，且这部分元素大部分不在视口内。这是"素材一多就整体变慢"的根因。

**修法**
1. 给 `TimelineElement` 加 `memo`，并把 `onResizeStart/onElementMouseDown/onElementClick` 上提到父级（用 `track` 作为参数或在 `TimelineTrackContent` 内部稳定化），避免内联箭头函数
2. 按可视时间窗口裁剪（`scrollLeft` / `viewportWidth` / `zoomLevel` 已知，直接可算可见区间，与 ruler 用同一套边界）
3. `ContextMenuContent` 上抽成单个全局菜单：右键时设 `contextTarget` 状态，只渲染一份。这一步能一次性砍掉 N 份 React 元素与 Radix Root
4. 音频 clip 的 `AudioWaveform` 在不可见时卸载（`IntersectionObserver` 或与 2 同源的可见区间判断）

**预期收益**：以 100 元素、视口内 15 元素计，单次提交的组件数从 100+ 降到 ~15；DOM 节点数下降 60%~85%（取决于裁剪策略）。

---

### P0-4　`mousemove` 未做 rAF 合并，拖拽期间所有工作按事件频率跑

**证据**

```ts
// timeline/controllers/element-interaction-controller.ts:433
document.addEventListener("mousemove", this.handleMouseMove);
```

同一模式出现在 `resize-controller.ts:246`、`keyframe-drag-controller.ts:245`、`playhead-controller.ts:218`、`bookmarks/hooks/use-bookmark-drag.ts:215`、`selection/hooks/use-box-select.ts:169`。**没有任何一处做"保存最近一次坐标 + rAF 里只算一次"的合并**。

对比：预览面板的滚轮处理（`preview/components/index.tsx:397-454`）和缩放（`timeline/components/index.tsx:256-316`）都做了 `pendingDelta + rAF` 合并——**交互主链路反而漏了**。

**额外的监听器抖动**：`selection/hooks/use-box-select.ts:136-182` 的 `useEffect` 依赖 `selectionBox`，而每次 mousemove 都会 `setSelectionBox(nextSelectionBox)`（新建对象），于是**每次移动都要 `removeEventListener` + `addEventListener` 一对 window 监听**（`:169-170` 与 `:179-180`）。

**影响**：高回报率鼠标（1000Hz）下事件处理频率是显示刷新率的 8~16 倍。每一次都触发 P0-1 → P0-2 → P0-3 的完整链路，CPU 直接饱和，掉帧表现为"拖动时鼠标跟不上手"。

**修法**
- 统一做一个 `useRafPointerMove`（或 controller 基类里的 `scheduleFrame()`）：事件只写 ref，rAF 里算一次、notify 一次
- `use-box-select` 的 effect 依赖改为 `selectionBox?.startPos` 等稳定值，或把 handler 放进 ref，effect 只挂一次
- 拖动期间（`dragView.kind === "dragging"`）把样式更新改成 `transform: translate3d`（`timeline-element.tsx:390` 已经是这么做的，保持），但仍需先在 JS 侧合并

**预期收益**：事件处理上限从"设备回报率"降到 60/s。1000Hz 鼠标下减少 90%+ 的重复计算，且不掉视觉精度。

---

## 3. P1 问题（放大卡顿、造成可感知毛刺）

### P1-1　音频管理器对 timeline notify 过敏：拖动一次就拆一次解码缓存

```ts
// core/managers/audio-manager.ts:46-49
this.editor.timeline.subscribe(this.handleTimelineChange),
this.editor.media.subscribe(this.handleTimelineChange),

// :107-121
private handleTimelineChange = (): void => {
  this.disposeSinks();              // 释放所有 mediabunny Input / Demuxer
  this.preparedClipBuffers.clear(); // 丢掉已解码 AudioBuffer
  this.decodedBuffers.clear();
  if (!this.editor.playback.getIsPlaying()) return;
  void this.startPlayback({ ... }); // 播放中：整条音频链重头开始
};
```

结合 P0-1：**拖动变换手柄的每一帧都会 teardown 音频栈**。不在播放时也在付 `disposeSinks` 的成本；在播放时音频会被反复重启 → 可听见的断续/爆音，且 mediabunny 重新 demux 是重活。

**修法**：`handleTimelineChange` 先判断"是否真的影响音频"——只有 `startTime/duration/trimStart/trimEnd/volume/retime/音轨增删` 才需要重建；`previewElements` 这种预览态变更应该完全忽略（或只做增益更新）。建议给 timeline notify 带上 change 原因（`{kind: "preview" | "commit" | "structural"}`），订阅方按需响应。

**收益**：播放中拖拽不再重启音频；非播放态拖拽省掉每帧一次资源释放。

---

### P1-2　吸附每 mousemove 全量重建 + 线性扫描

```ts
// timeline/group-move/snap.ts:36-45
const snapPoints = buildTimelineSnapPoints({
  sources: [
    () => getElementEdgeSnapPoints({ tracks, excludeElementIds }),   // O(N) 遍历 + 2N 个对象分配
    () => getPlayheadSnapPoints({ playheadTime }),
    () => getAnimationKeyframeSnapPointsForTimeline({ tracks, excludeElementIds }),
  ],
});
```

然后对 `group.members` 的每个成员做 2 次 `resolveTimelineSnap`（`snapping/resolve.ts:12-29`，线性扫描，**未排序、无二分**），全组实际是 4 次/成员。

**复杂度**：每次 mousemove = O(N) 分配 + O(N·k·4) 比较（k = 选中元素数）。100 元素 + 10 选中 ≈ 4000 次比较 + 数百个临时对象，乘以未合并的事件频率。

**修法**：把 snapPoints 按时间排序后在拖拽开始时构建一次（拖拽期间只有"被拖元素自身"在变，其它元素的边界是静态的），resolve 改成二分查找；keyframe snap 同理。

**收益**：从 O(N·k) 降到 O(logN·k)，且分配趋近于 0。

---

### P1-3　波形每次滚动都重绘，且签名里 `JSON.stringify` 整个增益数组

```ts
// timeline/components/audio-waveform.tsx:157-181
const renderSignature = JSON.stringify({
  ...,
  gainSamples: gainSamplesValue ?? null,   // 200 个数字 → 每一个滚动帧都要字符串化
});

// :329-333
const handleScroll = () => { drawVisible(); };   // 每个音频 clip 都挂一个
```

`drawVisible` 内部还会 `container.getBoundingClientRect()`（`:114`）和 `scrollParent.getBoundingClientRect()`（`:127`）——**每个音频 clip 在每次滚动事件里各做 2 次强制布局读取**，然后全量重绘 canvas。

**修法**：签名改成只比"变化的输入"（`visibleWidth/clipLeft/pixelsPerSecond/...` 用字段比较，不要整体 stringify）；`gainSamples` 单独用引用比较；滚动回调合并到 rAF 且只在"可视区间真正变化"时重绘；rect 用滚动容器的已知 scrollLeft 推算，避开 `getBoundingClientRect`。

**收益**：滚动时每帧的字符串化开销从数十 KB 降到 0；强制布局次数从 2×clips 降到 0~2。

---

### P1-4　`getTotalDuration()` 是 O(N) 且被高频调用

```ts
// timeline/index.ts:15-34
export function calculateTotalDuration({ tracks }) {
  const orderedTracks = [...tracks.overlay, tracks.main, ...tracks.audio]; // 每次分配
  ...遍历所有元素
}
```

28 处调用点，其中 `core/managers/playback-manager.ts:238` 在 **rAF 里每帧调用一次**（`updateTime`），`clampTimeToTimeline`（`:260`）在每次 seek 里再调一次。

**修法**：在 `TimelineManager` 里缓存总时长，随 `updateTracks` / 元素增删改失效；或干脆在 scenes 变更时计算一次。

**收益**：播放时每帧省一次 O(N) 遍历 + 数组分配；seek 频繁的擦洗场景收益更明显。

---

### P1-5　渲染树每次预览变更整体重建，深比较兜不住

```tsx
// preview/components/index.tsx:119-133
useDeepCompareEffect(() => {
  const renderTree = buildScene({ tracks, mediaAssets, duration, canvasSize, ... });
  editor.renderer.setRenderTree({ renderTree });
}, [tracks, mediaAssets, activeProject?.settings.background, width, height]);
```

两个问题：
1. `useDeepCompareEffect` 对**整棵 tracks 树**做深比较——P0-1 下每帧都是新对象，深比较全量跑一遍，然后判定"变了"（因为确实变了）→ 白做
2. 判定变了之后 `buildScene`（`services/renderer/scene-builder.ts:37` `buildTrackNodes`）为**所有元素 new 一遍节点**，未改动元素的节点身份也丢失 → 下游按节点身份做的任何缓存（文字贴图、视频 texture、canvas）全部失效

**修法**：节点构建改成按 `elementId` 复用——`buildScene` 接受上一棵树做 diff，`element` 与 `mediaAsset` 引用未变的节点直接复用；`setRenderTree` 只在"节点集合真的变了"时替换。配合 P0-1 的结构共享，这一步才真正省下来。

**收益**：拖动单元素时，节点重建数从 N 降到 1；文字/视频类元素的贴图不再每帧重建。

---

### P1-6　逐字 Troika + 多 RT blit 压主线程（已知，需要按既定 P0 计划重构）

`docs/textanim-progress-2026-10.md:78` 已记录："预览 `useRafLoop` → `CanvasRenderer.render` → Three compositor；Bloom / 多 RT blit / HalfFloat 拷贝都在主线程。播放时常见 `setTimeout handler took ~60ms`"。

本次评审确认该结论仍然成立，且成本来源未变：逐字 mesh + 每字同步、text RT → pack RT → accum → present 的多段拷贝、PP 在主线程跑。

**这条不建议在本次迭代内动**（属于文档里已排期的 v2 重构：单几何/实例化、glyph atlas、预览 LOD）。但**建议先落地一个便宜的止血点**：把 `preview/playback-quality.ts` 的 LOD 与"是否启用 Bloom / 是否降 PP 分辨率"真正联动到播放态（播放时降到 0.5× PP + 关 MSAA，暂停恢复全质量）。这条比重构便宜一个数量级。

---

### P1-7　每帧一次的全元素扫描

```ts
// preview/components/index.tsx:299-300
const needsLivePresent = videoFrameDirty || flowerTextDirty || hasActiveTimelineVideo(editor);

// :140-167
function hasActiveTimelineVideo(editor) {
  const tracks = [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]; // 每帧分配
  for (const track of tracks) for (const el of track.elements) { ... }              // 每帧 O(N)
}
```

播放时每个 rAF 都做一次"有没有视频元素在播放头下"的全量扫描 + 数组拼接。

**修法**：结果只在"场景变化 / 播放头跨过元素边界"时失效，缓存到 manager 里。

---

## 4. P2 问题（可维护性 / 次要开销）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P2-1 | `getElementKeyframes` 每次渲染算两遍 | `timeline-element.tsx:284` 与 `:301` | 应 `useMemo` 一次复用 |
| P2-2 | `getKeyframeIndicators` 未 memo | `timeline-element.tsx:282-292` | 选中元素的每个渲染都重建 Map + 排序 |
| P2-3 | 波形增益采样随预览对象失效 | `timeline-element.tsx:1020-1027`（dep `[element]`） | `useElementPreview` 返回新对象 → 200 个采样每帧重算 |
| P2-4 | `Timeline` 拖动时整棵子树重渲染 | `hooks/element/use-element-interaction.ts:63-64` → `timeline/components/index.tsx:117` | Toolbar / Ruler / Labels 已各自订阅，但 `TimelineTrackRows` 仍全量跑 |
| P2-5 | 每个元素一个 Radix `ContextMenu` | `timeline-element.tsx:379`、`timeline/components/index.tsx:834` | 建议合并为单一全局右键菜单 |
| P2-6 | 轨道高度前缀和每次渲染重算 | `timeline/components/index.tsx:842` `getCumulativeHeightBefore` | O(T²)，轨道多时可见；可一次算出前缀和数组 |

---

## 5. 卡顿归因图（编辑动作视角）

```
用户拖拽 / 变换手柄
   │  (mousemove, 最多 1000/s，无 rAF 合并 —— P0-4)
   ▼
previewElements()                      ← 每帧调用
   ├─ applyPreviewOverlay: 重建整棵 SceneTracks  —— P0-1   [O(N) 分配]
   ├─ notify()
   │    ├─ 3000+ 条订阅遍历 —— P0-2                       [O(30N)]
   │    ├─ AudioManager.handleTimelineChange
   │    │    └─ disposeSinks + clear 解码缓存 (+ 播放中重启音频) —— P1-1
   │    └─ RenderTreeController
   │         ├─ useDeepCompareEffect 深比较整棵树 —— P1-5    [O(N) 深比较]
   │         └─ buildScene: 全部元素 new 节点 —— P1-5        [O(N) 分配]
   └─ Timeline 重渲染（controller.notify → rerender）
        └─ 所有元素（含视口外）重渲染 —— P0-1/P0-3          [O(N) 组件]
             └─ 每元素 30+ 订阅 + Radix 菜单 + canvas
```

同时进行的时间线拖动还有另一条链：

```
mousemove → frameSnappedMouseTime (getBoundingClientRect)
          → snapGroupEdges: 重建 snapPoints + O(N·k) 线性扫描 —— P1-2
          → resolveDropTarget → resolveGroupMoveForDrop
          → controller.notify → 整个 Timeline 重渲染 —— P0-4
```

---

## 6. 优化路线图与验收

### 第 1 步（1~2 天，改动小、见效最快）
1. **P0-4** 给所有拖拽 controller 加 rAF 合并；修 `use-box-select` 的 effect 依赖
2. **P1-1** `handleTimelineChange` 忽略 preview 类变更
3. **P1-3** 波形签名去掉 `JSON.stringify(gainSamples)`，滚动回合并入 rAF

> 这三条不改架构，但能立刻消除"拖动时鼠标跟不上"的最刺手感。

### 第 2 步（3~5 天）
4. **P0-2** 拆出分 store 的 selector hooks，逐处替换（`usePlayback`/`useTimeline`/`useMedia`/`useSelection`）
5. **P0-1** `applyPreviewOverlay` 改为受影响轨道级重建；`SceneTracks` 顶层尽量复用
6. **P1-4** 总时长缓存

### 第 3 步（1 周）
7. **P0-3** `TimelineElement` memo + 稳定回调 + 可视区间裁剪 + 全局右键菜单
8. **P1-5** `buildScene` 按 elementId diff 复用节点
9. **P1-2** snapPoints 排序 + 二分

### 第 4 步（按 `textanim-progress` 既定计划）
10. **P1-6** 播放态 LOD 止血 → 之后的逐字重构（实例化 / glyph atlas）

### 验收指标（建议四组基线，改动前后各测一次）

| 场景 | 指标 | 目标 |
|---|---|---|
| 100 元素时间线，拖动单个 clip | 平均帧时间 / 掉帧率 | 帧时间 ≤ 16.7ms，掉帧 < 5% |
| 100 元素，拖变换手柄缩放 | 主线程长任务数（>50ms） | 0 |
| 播放中拖音量线 / 蒙版 | 音频中断次数 | 0 |
| 横向滚动（10 个音频 clip） | 每帧强制布局次数 | ≤ 2 |
| 1080p 播放（含花字 + Bloom） | FPS | ≥ 30（LOD 开启） |

### 度量方法（复用现有探针，无需新写工具）
1. `window.__renderPerf = true` → 控制台每 60 帧输出 `resolve` / `buildFrame` / `syncTextures` / `renderFrame` 的 p50/p95/max（`diagnostics/render-perf.ts`）
2. `components/fcc-light-fps.tsx` 的 FPS 浮层（`localStorage.fccFps = "1"`）
3. Chrome Performance 面板录"拖拽 3 秒"，看主线程火焰图里 `applyPreviewOverlay` / `notify` / `buildScene` 的占比——这三个应该会主导
4. 建议补一个 `PerformanceObserver({entryTypes:["longtask"]})` 的 dev 计数器，把"掉帧"从主观感受变成数字

---

## 7. 一句话给下一棒的交接

> 播放链路别动（已经是对的）。要动的只有一件事：**让"改一个元素的参数"这条路径只付出"一个元素"的代价**——现在是付出了"整个场景"的代价，而且是按鼠标回报率的频率付。
