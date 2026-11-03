# NLE 切点转场（Transition Edge）设计

日期：2026-10-16  
状态：已确认（用户确认数据模型 / 句柄采样 / 约定名 / UI / MVP 范围）  
范围：剪辑端同轨紧邻 video/image 切点上的转场；编辑器转场 pack（双输入约定 + Timeline 驱动）。

---

## 1. 目标

1. 转场资产只能拖到**同轨紧邻**的两个 clip 中间（切点）。
2. 时间轴 UI 上 A|B **仍紧挨**；视觉上用剪映式斜线块表示转场，**永远各盖 A/B 一半**。
3. 真正的 A→B 重叠来自 **媒体句柄（handles）**；不够则 **定格补帧**。
4. 转场 pack 用约定名接收源/目标贴图；Timeline 动画按面板/拖边时长 **整体缩放**。
5. 时长可在 **属性面板改数字**，也可在时间轴 **对称拖边** 改 D。

---

## 2. 非目标（MVP）

- 起/止对齐、非对称覆盖
- 音频交叉淡化
- 转场作为独立 effect clip 随意拖动
- 跨轨、有间隙切点上的转场
- Ripple 缩短工程时长来凑重叠

---

## 3. 数据模型（切点附着）

转场**不是**普通 timeline element，而是挂在切点上的边：

```ts
TransitionEdge {
  id: string
  trackId: string
  fromElementId: string   // A（出）
  toElementId: string     // B（入）
  packId: string          // 转场 VFX pack
  duration: MediaTime     // 总时长 D（默认 1s）
  // 后续可选：params（pack 暴露参数）
}
```

存储：与 track `elements` 并列，例如 scene/track 上的 `transitions: TransitionEdge[]`。

### 3.1 约束

| 规则 | 行为 |
|------|------|
| 一对 `(from, to)` | 最多一个转场；再拖入 = 替换 pack，MVP **重置 duration 为默认 1s** |
| 放置条件 | 同轨、时间上紧邻（无间隙）、类型为 video 或 image |
| A/B 不再紧邻 / 删除 / 中间插入 | 删除该 `TransitionEdge` |
| 工程总时长 | 不因添加转场而改变（不 ripple 叠轨） |

---

## 4. 句柄、居中区间与定格

### 4.1 切点与窗口

- `cut = A.end`（= `B.start`）
- 转场窗口：`[cut - D/2, cut + D/2]`（居中）
- 窗口外：该轨按现有逻辑只合成当前命中的 clip

### 4.2 媒体时间（窗口内每帧）

| 贴图角色 | Clip | 采样策略 |
|----------|------|----------|
| From（源/出） | A | 优先使用 A 的 **Out 点之后**仍存在的源素材句柄；不足部分用 **A 末帧定格** |
| To（目标/入） | B | 优先使用 B 的 **In 点之前**仍存在的源素材句柄；不足部分用 **B 首帧定格** |

说明（用户确认）：

- 若片段被剪成 A1，A1 的 Out 之后源里还有帧 → 转场必须能用到这些真帧。
- B 同理：In 之前有可用帧则用真帧。
- 仅当某一侧句柄仍不够撑满该侧 `D/2` 时，对该侧缺额定格。

图片：可视为句柄充足，或等价定格；效果一致即可。

### 4.3 时长 D

- 默认：`1s`（按工程 fps 对齐到帧）
- `D_min`：约 2 帧
- `D_max`（MVP）：例如 `min(5s, 2 * min(A.duration, B.duration))`，避免斜线块盖住整段 clip
- 面板改数字与时间轴拖边写入**同一** `duration` 字段

---

## 5. 渲染管线

窗口内每一帧：

1. 按 §4.2 分别渲染 A、B → 临时 RT：`texFrom`、`texTo`
2. 加载/复用转场 `packId` 对应 BuiltPackScene
3. 按 **约定名**（§6）把 `texFrom` / `texTo` 绑到 pack 内**所有**匹配的 `sampler2D` uniform（可跨多个材质/shader）
4. 驱动 pack Timeline（若有）：
   - Pack 作者 Timeline 原长 `T`
   - NLE 时长 `D`
   - 归一化进度 `u = (t - (cut - D/2)) / D`，钳制到 `[0, 1]`
   - 采样时间 = `u * T`（D=0.5、T=1 → 整段动画加速在 0.5s 内播完）
5. 转场 pack 输出替换该轨在窗口内的画面（盖住硬切）

窗口外不跑转场 pack。

---

## 6. Shader / Uniform 约定名（灵活绑定）

对齐现有 below-input（`uInput` 等）做法：**按名字扫描 pack 内全部材质**，声明了就绑；**不要求**同一 shader 里同时有两个参数。

### 6.1 推荐名（作者优先）

| 角色 | 推荐 uniform |
|------|----------------|
| 源（出 = A） | `uTransitionFrom` |
| 目标（入 = B） | `uTransitionTo` |

### 6.2 别名（一并识别）

- From：`uTransitionFrom` · `uFrom` · `transitionFrom`
- To：`uTransitionTo` · `uTo` · `transitionTo`

### 6.3 绑定规则

1. 材质可同时声明 From+To（经典 dissolve）
2. 材质 B 只有 From、材质 C 只有 To（多 pass）——均合法
3. 只声明一侧亦可（另一侧作者自备）
4. **不**依赖 manifest 写死槽位；约定名即契约
5. Pack `type: "transition"` 用于资源库分类与落点校验

编辑器验证用 dissolve：单 shader 声明 `uTransitionFrom` + `uTransitionTo`，Timeline 驱动 mix 即可。

---

## 7. UI（剪映风格）

### 7.1 落点

- 仅 `type: transition` pack 可落到同轨紧邻 video/image 切点
- 拖拽时高亮切点缝；非法目标禁止放置
- 松手创建或替换 `TransitionEdge`

### 7.2 外观

- 切点上斜线半透矩形，左右各覆盖 `D/2`
- 正中转场标记（⋈ 或等价图标）
- 覆盖在 A|B 之上；**不改变** clip 块仍紧挨的几何布局

### 7.3 交互

| 操作 | 行为 |
|------|------|
| 点击斜线块 / ⋈ | 选中该转场（不是选 clip） |
| 拖左缘或右缘 | **只改总时长 D**；另一侧镜像移动；切点始终居中 |
| 属性面板 `duration` | 与拖边同一数据；改后 Timeline 按 `T/D` 缩放 |
| Delete | 删边，不删 A/B |

拖 A/B 导致不再紧邻、或中间插入元素 → 删除该边。

---

## 8. 与现有系统的关系

| 现有 | 本设计 |
|------|--------|
| `pack.type === "transition"` + effect 轨落点提示 | 改为切点附着；effect 轨不再作为转场主路径 |
| below-input `uInput` 约定 | 平行增加 From/To 约定名集合 |
| 合成器按 clip 单路采样 | 转场窗口内双路采样 + pack 合成 |
| Timeline 驱动 pack 动画 | 转场用归一化 `u * T` 映射到作者 Timeline |
| 资源库 Transitions 页 | 拖拽目标改为切点，而非任意 effect 轨空隙 |

---

## 9. 验收标准（MVP）

1. 两段紧邻 image/video 之间可拖入 dissolve 转场；斜线块居中各盖一半。
2. 面板改 D、拖边改 D，始终对称；预览中淡入淡出时长与 D 一致。
3. A 被修剪后 Out 后仍有源帧时，转场重叠区使用真帧而非无故定格。
4. 某一侧句柄不足时，缺额定格，转场仍可播放且工程时长不变。
5. Pack 内不同材质分别只声明 From 或 To 时，绑定仍正确。
6. 删除转场 / 拆开 A|B 后，硬切恢复且无残留边。

---

## 10. 实现备注（非绑定实现顺序）

建议落点（实现计划阶段细化）：

- 类型与持久化：`timeline/types`、scene 序列化
- 命令：`add/replace/remove/setDuration` TransitionEdge（可撤销）
- UI：timeline 切点 hit-test、斜线 overlay、对称 resize
- 合成：`three-compositor` 转场窗口分支 + From/To bind helper（镜像 `below-input.ts`）
- 编辑器：dissolve 示例 pack（约定名 + Timeline）

---

## 11. 已确认决议摘要

| 议题 | 决议 |
|------|------|
| 架构 | A — 切点附着，非独立 effect clip |
| 对齐 | 居中，各 D/2 |
| 媒体 | 句柄优先，不足定格 |
| 时长 | 默认 1s；面板数字 + 对称拖边 |
| Pack Timeline | 作者长 T，NLE 长 D，按 `u*T` 整体缩放 |
| Uniform | `uTransitionFrom` / `uTransitionTo` + 别名；按名灵活绑定 |
