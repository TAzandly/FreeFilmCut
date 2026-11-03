# 播放区拖素材为什么掉帧：HUD 拆解 + 通知扇出

日期：2026-10-27
读数：`FPS 32  30.8ms` / `vsync 16.5ms  drops 46%` / `1x 18  2x 12  3x 1  8x 2  max 134ms` / `longtask 3/139ms` / `compose sync 1ms total 4ms`

---

## 1. 先把 HUD 算平

`drops` 的定义（`components/fcc-light-fps.tsx:272-280`）是
`drops / (total + drops)`，其中 `drops = Σ(multiple − 1)`：

```
帧数 = 18 + 12 + 1 + 2 = 33
Σ(m−1) = 12×1 + 1×2 + 2×7 = 28
drops = 28 / (33 + 28) = 45.9% → 46%   ✓ 与 HUD 完全吻合
```

所以这 46% 里：

| 帧型 | 数量 | 含义 |
|---|---|---|
| 1× (≈16.5ms) | 18 | 准时 |
| 2× (≈33ms) | 12 | 每帧刚过预算，吃掉 2 个 vsync |
| 3× (≈49.5ms) | 1 | — |
| 8× (≈132ms) | 2 | 卡顿；`longtask 3/139ms` 说明其中至少一次是 139ms 的同步长任务 |

时间对账：`18×16.5 + 12×33 + 1×49.5 + 2×132 = 1006ms ≈ 30.8×33`。闭合。

**关键结论：`compose sync 1ms total 4ms`。** 合成器只花 4ms（占预算 24%），
所以"掉一半帧"不是画得慢 —— 是这 4ms 之外的 ~25ms 主线程工作。

## 2. 稳态为什么是「一帧一份」

18 帧准时 + 12 帧 2×，不是"每帧都 27ms"，而是**双峰**：轻帧 ≈10ms，重帧 ≈28ms。
原因很直接 —— 拖拽的合并回调和预览渲染是两个独立的 rAF 回调：

```
重帧（每 2 帧一次）:  drag rAF → previewElements → notify 级联 → buildScene
                      → setRenderTree → 渲染 rAF → renderFrame + compose
轻帧（交替出现）:      只有渲染 rAF（树没变，走 idle 跳过）
```

也就是说：**一次拖动，每两帧里有一帧要替整条流水线买单**。

## 3. 一次 drag 帧到底唤醒了什么（这是 25ms 的真身）

```
pointermove  ──rAF 合并──▶ processPointerMove
  └ screenToCanvas         (getBoundingClientRect，强制布局)
  └ snapPosition
  └ setSnapLines(lines)    → PreviewInteractionOverlay 重渲染（每帧新数组）
  └ timeline.previewElements()
       ├ applyPreviewOverlay(committedTracks)     ← O(全部轨道×全部元素)
       │    每条轨道 map 出新数组、被覆盖的元素展开成新对象
       └ notify("preview")
            └ useSyncExternalStore 收到通知 → **每个挂载的 useEditor 都重算 selector**
                 ├ preview/components/index.tsx:118  RenderTreeController
                 │    └ buildScene(全量重建场景图) → setRenderTree
                 │         └ renderer.notify()  ← 第二次级联
                 ├ preview/hooks/use-transform-handles.ts:24  手柄
                 ├ timeline/hooks/use-element-preview.ts        ← 每个 clip 一个（timeline-element.tsx:238）
                 ├ components/editor/panels/properties/*        ← 9 处，属性面板各字段
                 └ masks-tab.tsx:139 / graph-editor/use-controller.ts:19
```

两个放大器：

1. **`getPreviewTracks()` 每帧返回新对象**（`timeline-manager.ts:844` 里
   `applyPreviewOverlay` 造新树）。于是任何"订阅整棵树"的组件都必然重渲染 ——
   **拖 1 个素材 = 时间线上 N 个 clip 全部重渲染**。
2. **`setRenderTree` 内部再 `notify()`**（`renderer-manager.ts:35-38`），
   在 effect 里又触发一轮 React 更新，等于一帧两级联。

为什么必须重造树：预览 canvas 的跳过条件是
`renderTree === lastSceneRef.current && frame === lastFrame`（`preview/components/index.tsx:389`）。
树身份不变就不重绘 —— 所以"让画面动"今天唯一的手段就是造一棵新树。这是架构层面的耦合点。

## 4. 已改：把「订阅整棵树」收窄成「订阅这个元素」

`timeline/hooks/use-element-preview.ts` 原来：

```ts
useEditor((e) => e.timeline.getPreviewTracks());   // 每帧新树 → 必然重渲染
const previewTracks = editor.timeline.getPreviewTracks();
```

改为只订阅本元素：

```ts
const renderElement = useEditor((e) => {
  const tracks = e.timeline.getPreviewTracks() ?? e.scenes.getActiveSceneOrNull()?.tracks ?? null;
  if (!tracks) return fallback;
  return findTrackInSceneTracks({ tracks, trackId })?.elements.find((el) => el.id === elementId) ?? fallback;
});
```

为什么有效：`applyPreviewOverlay` 只对被覆盖的元素展开新对象，其它元素**引用不变**
（`timeline-manager.ts:886-891`）。所以：

- 被拖的元素 → 新引用 → 重渲染（本来就要动）
- 其它 clip → 引用不变 → `useEditor` 的快照缓存 `Object.is` 命中 → **不重渲染**

这一处覆盖了时间线所有 clip（`timeline-element.tsx:238`）和属性面板 9 个调用点，
即把「1 拖 N 渲染」降为「1 拖 1 渲染 + 面板」。

## 5. 新增读数（下次一次定案）

| 读数 | 回答什么 |
|---|---|
| `preview:buildScene` | 全量重建场景图每帧多久（O(全部元素)） |
| `preview:publishTree` | `setRenderTree` + 其同步 notify 的耗时 |
| `preview:treePublish`（counter） | 每帧发布次数，拖动时应该 =1 |
| `timeline:applyPreviewOverlay` | 造新树本身的耗时 |
| `preview:notifyReceivers`（counter） | 每次 preview 通知唤醒多少个订阅者 |

判读：若 `buildScene + publishTree` 已占大头 → 下一步做「原地改 transform」；
若都很小、帧仍然 2× → 剩下的是 React 提交本身（dev 模式翻倍），先跑 prod 复测。

## 6. 下一步（按收益/风险排序，尚未实施）

1. **transform-only patch（根治）**
   预览树节点带上 `elementId`（`scene-builder.ts` 里 6 个 newNode 各加一行），
   拖动时不再 `buildScene`，而是遍历现有树把目标节点的 `params.transform.position`
   改掉 + 唤醒渲染 rAF（跳过条件里加一个 treeEpoch）。届时 `previewElements` 可以
   完全不 notify React。风险点：位置关键帧的动画覆盖、多选、文字/花字节点。
2. **少一次级联**：`setRenderTree` 的 notify 与 React 无关的订阅者分离（renderer 内部
   用事件通道通知 canvas，而不是走 useSyncExternalStore）。
3. **`setSnapLines` 值比较**：不吸附时每帧 `setSnapLines([])` 仍是新数组；改成
   「内容相同就不 setState」。收益小（手柄本来要动），但零风险。
4. **prod 复测**：`next build && next start`。dev 的 React 19 + StrictMode 会双跑
   render/effect，同类读数在 prod 通常腰斩。

## 7. 验证

1. 拖素材 → HUD：`drops` 应从 46% 明显下降，`2x` 计数减少，`FPS` 上行
2. `preview:notifyReceivers` 仍然很大（=挂载的 useEditor 数）是正常的，
   但**不该再等于重渲染的组件数**
3. 时间线上多 clip 的项目：拖动收益最明显（从 N 渲染降到 1）
4. 功能回归：拖拽跟手、吸附线、多选一起拖、拖完提交可撤销、属性面板数值实时变化

校验：`tsc --noEmit` 154 errors，与改动前一致；`eslint` 改动文件
（`use-element-preview.ts` 1 条既有的 unsafe assertion，`preview/components/index.tsx`
1 条既有 warning，`timeline-manager.ts` 3 条既有 unsafe assertion）均无新增。

> 本报告基于静态代码分析与 HUD 读数的算术对账，仅供参考；实际收益以改动后的 HUD 读数为准。
