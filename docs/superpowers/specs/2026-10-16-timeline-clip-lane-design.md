# Timeline 轨上片段拖移 / 拉边设计

日期：2026-10-16  
状态：已确认（用户确认布局 / 交互 / 实现）  
范围：编辑器 Timeline 窗口内，Animation / Video / Activation 三种轨的 clip 可视化与拖拽编辑。

---

## 1. 目标

对齐 Unity Timeline 的基本操作手感：

1. 每个 clip 在轨道时间轴上显示为可拖动的色块，可**任意移动**位置（改 `start`）。
2. 拖动色块**左/右边缘**改变 clip 长度（改 `duration`；拉左边时联动 `start` 使右端不动）。
3. 三种轨类型行为一致。
4. 保留现有数字输入框（start / duration 等），与色块**双向同步**。

**非目标（本版不做）：** 交叉淡化 (blend)、多选、重叠自动推挤、嵌套轨组、Zoom 横向缩放尺。

---

## 2. 与现有系统的关系

| 现有 | 本设计 |
|------|--------|
| `FccTimelineEditor.js` 轨列表 + 数字框 | 增加每轨一条 clip lane DOM |
| `clip.start` / `clip.duration` 数据模型 | **不变** |
| 标尺 `timeFromEvent` / `snapTimeToFrame` | 复用为 lane 坐标换算 |
| `commitAssetEdit` / `computeContentDuration` | 拖拽松手或数字改值后调用 |

采样逻辑 `sampleTimeline` 无需改动。

---

## 3. 布局

每条轨两行结构：

1. **轨头行**：名称、绑定、静音、删除（保持现状）。
2. **片段行（clip lane）**：
   - 左侧宽度 = 标尺左侧 `LABEL_W`，空白对齐；
   - 右侧 `position: relative` 的 lane，高度约 28px，宽度与标尺内容区一致；
   - 每个 clip 为 `position: absolute` 色块：
     - Animation：偏蓝
     - Video：偏橙
     - Activation：偏绿
   - 色块内短标签（animId /「Video」/「Active」等）。

3. **数字行**（保留）：start、duration；Video 另有 mediaOffset、loop 等。改数字立即重排色块。

窗口默认高度可略增，便于同时看到多轨 lane。

---

## 4. 交互

### 4.1 拖中间（move）

- 改 `clip.start`，`duration` 不变。
- 时间吸附：`snapTimeToFrame(t, asset.fps)`。
- 约束：`start ≥ 0`。
- 若 `start + duration > asset.duration`，通过 `commitAssetEdit` → `computeContentDuration` **撑开** timeline 时长。

### 4.2 拖左边（resize left）

- 右端固定：`end = start + duration` 不变。
- 新 `start` 吸附后，`duration = end - start`。
- 最短时长：`1 / fps`（至少一帧）。

### 4.3 拖右边（resize right）

- 只改 `duration`（吸附后 ≥ `1/fps`）。
- 超出 asset.duration 时同样可撑开总时长。

### 4.4 与标尺 scrub 的关系

- 在色块上 `mousedown` 时 `stopPropagation`，避免触发标尺 scrub。
- 拖拽过程用 document 级 `mousemove` / `mouseup`（与窗口拖动、scrub 同一套监听，用 mode 互斥）。

### 4.5 松手与预览

- 拖拽过程中可实时更新色块位置与数字框显示。
- `mouseup`：`commitAssetEdit(true)`（若正在 Timeline 预览则 resample）。

---

## 5. 实现要点

**文件：** 主要修改 `three.js/editor/js/timeline/FccTimelineEditor.js`。

**辅助函数：**

- `timeToX(t, laneWidth, duration)` / `xToTime(x, laneWidth, duration)`
- `bindClipDrag(el, clip, mode: 'move' | 'left' | 'right')`
- 左右边热区约 6px，`cursor: ew-resize`；中间 `cursor: grab` / `grabbing`

**刷新策略：**

- `rebuildTracksUI`：结构变化时重建 lane 与色块。
- `updateUI`（播放头走动）：只更新 playhead / 时间文字 / 标尺，**不**重建色块，避免打断拖拽。
- 数字框 `onChange`：更新 clip 字段后重排该色块 `left`/`width`（或轻量 `syncClipBlocks()`）。

**缓存：** Timeline 相关 import 保持或 bump 至 `?v=fcc-ui-35`。

---

## 6. 成功标准

1. 三种轨上的 clip 色块可拖到任意合法时间位置。
2. 拉左右边可改变长度，最短一帧；数字框与色块一致。
3. 拖片段时不会误触发标尺 scrub。
4. 播放/scrub 采样行为与改数字框时一致（仍由 `start`/`duration` 驱动）。
5. 不做 blend / 多选 / 自动推挤。

---

## 7. 已确认决策

1. 范围：**Animation + Video + Activation** 全部支持。
2. UI：**色块 + 数字框** 双保留。
3. 方案：每轨 DOM clip lane（非整板 Canvas）。
4. 不做交叉淡化与多选。
