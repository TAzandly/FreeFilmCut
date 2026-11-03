# 剪辑端性能改造 · 第一批实施记录（PR-1 ~ PR-3）

- 日期：2026-10-27
- 对应方案：`docs/performance-solution-2026-10-27.md` 批次 0 + A1 + A2 + A3 + A4
- 状态：**已落地并通过类型检查 / ESLint 增量校验（未跑浏览器实测）**

---

## 1. 改动清单

### 新增文件

| 文件 | 作用 |
|---|---|
| `src/timeline/controllers/raf-pointer-move.ts` | rAF 指针合并工具：`push(point)` 只写坐标，`flushNow()` 补最后一帧，`cancel()` 清理 |
| `src/diagnostics/interaction-perf.ts` | 交互侧探针：统计 `pointermove` 频率、各拖拽管线的**真实执行次数**、长任务（>50ms） |

### 修改文件

| 文件 | 改动 | 行为变化 |
|---|---|---|
| `src/timeline/controllers/element-interaction-controller.ts` | mousemove 拆成「事件层 push 坐标」+「rAF 层 `applyPointerMove` 跑完整拖拽」 | 一次拖动每帧只算一次，不再按鼠标回报率算 |
| `src/timeline/controllers/resize-controller.ts` | 同上；顺带把构造函数里的两个 `bind` 去掉（改箭头字段） | 同上 |
| `src/timeline/controllers/keyframe-drag-controller.ts` | 同上 | 关键帧拖动同上 |
| `src/timeline/controllers/playhead-controller.ts` | 同上；`scrub()` 的参数类型从 `MouseEvent \| ReactMouseEvent` 收窄为 `{ clientX: number }` | 拖动播放头同上 |
| `src/timeline/bookmarks/hooks/use-bookmark-drag.ts` | mousemove 合并到 rAF；新增 `lastDraggedTimeRef` + `flushPendingMoveRef` | 合并后仍保证「落点 = 松手位置」 |
| `src/selection/hooks/use-box-select.ts` | effect 依赖从 `selectionBox`（对象，每帧新建）→ `hasSelectionBox`（布尔）；handler 走 ref + rAF；`userSelect` 那个 effect 同样改依赖 | 框选期间**不再每次移动重挂 window 监听** |
| `src/core/managers/timeline-manager.ts` | 新增 `TimelineChangeReason = "commit" \| "preview"`；`subscribe` 形参带上 reason；`previewElements` / `discardPreview` 发 `"preview"`；新增 `getPreviewOverlay(elementId)` | 订阅方能区分「预览态」与「已提交」 |
| `src/core/managers/audio-manager.ts` | `handleTimelineChange(reason?)`：`preview` 直接返回（并只更新增益）；新增 `clipGains` 登记表 + `syncPreviewVolume()` + 注销逻辑 | **拖动时不再拆解码缓存/重启音频链**；音量线拖动仍可听 |
| `src/timeline/components/audio-waveform.tsx` | `renderSignature` 从 `JSON.stringify` 改为逐字段比较（`gainSamples` 按引用比）；scroll 监听并入 rAF 且跳过 `scrollLeft` 未变的滚动 | 滚动时不再字符串化 200 个增益值；不再对不产生变化的滚动重绘 |
| `src/timeline/components/timeline-element.tsx` | 新增 `useStableGainSamples()`，用「音量/静音/时长/animations」做 memo key | 任意位置的拖拽不再导致所有音频 clip 重算 200 个采样、传入新数组 |
| `src/app/editor/[project_id]/page.tsx` | 挂载 `<InteractionPerfProbe />`（仅 dev） | 提供度量入口，生产构建无影响 |

---

## 2. 关键设计说明（为什么这样改）

### 2.1 合并点放在「工作回调」而不是「事件」

事件层仍收到全部 `pointermove`（浏览器不给我们拦），但只做一件事：`pending = point`。真正的计算在 rAF 里跑一次。所以探针统计的是**工作回调执行次数**（`work/s`）而不是事件数——后者不会因为合并而变少，用它当指标会误判。

### 2.2 mouseup 必须先 flush

合并带来的唯一风险是「最后一帧没算就松手」，表现为落点比鼠标早一帧。四处 `handleMouseUp` 都在最前面调 `flushNow()`，把排队中的坐标立刻算掉，再走提交逻辑，所以落点精度与改前一致。

### 2.3 `notify(reason)` 是向后兼容的

`subscribe` 的形参由 `() => void` 放宽为 `(reason) => void`：

- 现有订阅方传 `() => void` 依然合法（参数被忽略）
- `useSyncExternalStore(subscribe, ...)` 要求的 `(onStoreChange: () => void) => ...` 也满足逆变要求

所以**没有任何一个既有订阅方需要改**，只有 `AudioManager` 主动读了 reason。

### 2.4 音量预览为什么不会失效

`previewElements` 的 `updates` 里音量是 `{ params: { volume } }`（dB）。`AudioManager` 在 preview 时不再重建，改为扫 `clipGains`（elementId → 该元素当前所有已排程的 GainNode），用 `dBToLinear(volume)` 做 `setTargetAtTime`。

- 增益节点在 `node.onended` 里注销，避免长播放时集合无限增长
- 动画音量（关键帧）在预览期间会被这个瞬时值覆盖，提交后会重建 → 可接受

---

## 3. 怎么验收

### 3.1 打开度量

```js
window.__interactionPerf = true;   // 之后每秒打印一次
```

输出示例（拖动 3 秒后）：

```
[interaction-perf] 812 moves/s · 0 long task(s) · worst 0.0ms
┌───────────────┬─────────┬────────┬─────────┬────────────┐
│ pipeline      │ moves/s │ work/s │ perMove │ total work │
├───────────────┼─────────┼────────┼─────────┼────────────┤
│ timeline.drag │     812 │     58 │   0.071 │        174  │
└───────────────┴─────────┴────────┴─────────┴────────────┘
```

**判读标准**：

| 指标 | 改前（预期） | 改后（达标） |
|---|---|---|
| `perMove` | ≈ 1.0（每个事件都跑全量） | ≤ 0.15（约等于 刷新率 / 回报率） |
| `long task` 数 | 拖动期间多次 | 0 |
| `worst` | 经常 > 50ms | < 16ms |

用 `window.__interactionPerfReset()` 可以清零重来。`window.__renderPerf = true` 仍可叠加使用看渲染侧。

### 3.2 手工回归清单（这批改动必测）

| # | 操作 | 期望 |
|---|---|---|
| 1 | 拖动单个 clip 到另一轨道 | 位置跟手；松手落点与鼠标一致（放大到 400% 缩放再试一次） |
| 2 | 拖动 clip 后**立即**松手（快速甩动） | 落点是松手处，不是中间某帧 |
| 3 | 拖 clip 左右边缘 trim | 同上；`hasResizeChanges` 仍能识别"没变"时不提交 |
| 4 | 拖动关键帧 | 同上；松手后关键帧时间正确 |
| 5 | 拖动播放头 / 点标尺 | 时间码跟手；单击标尺仍能跳到点击位置 |
| 6 | 拖动书签 | 落点正确 |
| 7 | 框选一片 clip（含快速甩动） | 选框跟手；松手后选中集合正确；`Esc`/点击空白仍能取消 |
| 8 | **播放中**拖音量线 | 有音量变化听感，**无断续/爆音**（这是本批重点） |
| 9 | **播放中**拖蒙版/变换手柄 | 音频不中断（改前会断） |
| 10 | 播放中改音量后松手 | 提交后音量自动化正确、波形更新 |
| 11 | 滚动时间线（10+ 音频 clip） | 波形跟随正确，无明显卡顿；纵向滚动不触发重绘 |
| 12 | 拖动任意元素后看音频 clip 波形 | 波形不应闪烁/重绘（`gainSamples` 引用应稳定） |

---

## 4. 校验结果

```
tsc --noEmit -p tsconfig.json  →  改动文件 0 error
eslint（13 个改动文件）        →  改动代码 0 error / 0 warning
```

**说明**：仓库本身存在 **155 个既有的 tsc 错误**（`text-properties-view`、`three-compositor`、`storage/migrations`、`drag-drop-controller` 等）以及 7 个既有 lint 错误，均与本次改动无关，本次未触碰。因此 **`next build` 在改前就是失败状态**，不能用它当门槛；本次以「改动文件零新增错误」为准。

---

## 5. 已知取舍 / 遗留

| 项 | 现状 | 后续 |
|---|---|---|
| 音量**动画**（关键帧）预览期听感 | 预览期用瞬时值覆盖，提交后恢复自动化 | 可接受；如要精确，需按 localTime 计算增益曲线 |
| `getBoundingClientRect` 仍每帧每 clip 各一次 | 已合并到 rAF，但 clip 数多时仍是 2N 次强制布局 | 方案 A5（共享滚动度量），仅在 M4 指标不达标时做 |
| 吸附仍是 O(N·k) 线性扫描 | 未动 | 方案 C5 |
| 时间线仍无虚拟化、元素无 memo | 未动 | 方案 C1/C2（依赖 B2 结构共享先行） |
| `useEditor` 仍一次订阅 9 个 store | 未动 | 方案 B1 |

---

## 6. 建议的下一步

1. **先实测这批**（第 3.1 节），把 `perMove` 和长任务数记下来贴到 PR 里
2. 通过后做 **B2**（预览 overlay 版本号 + 结构共享）——它是 C1/C2 的前置，不做则 memo 永远失效
3. B2 之后再上 C1（memo 三件套），两者间隔很短，可以同一个迭代

> 回滚粒度：本批 5 个 controller 改动彼此独立，任何一个出问题可以只回滚那一个文件；`notify(reason)` 与 `audio-manager` 必须成对回滚。
