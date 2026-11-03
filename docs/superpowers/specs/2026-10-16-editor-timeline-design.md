# Editor Timeline（第一版）设计

日期：2026-10-16  
状态：已确认（2026-10-16）  
范围：编辑器内 Unity 式 Timeline 编排；音频轨 / 粒子 / 后处理开关 **不做**，第一版稳定后再扩展。

---

## 1. 目标

在 FreeFilmCut 资源编辑器中增加类似 Unity Timeline 的编排层：

- 场景中可放置一个 **Timeline** 组件（类似 PlayableDirector）
- 打开独立 **Timeline 编辑窗口**
- 在轨道上编排并预览：
  - 已有 `.anim` 动画片段
  - VideoPlayer（画面仍写入其绑定的 RT）
  - 对象激活 / 显示（Activation）
- 一个全局播放头时间 `t`，统一驱动上述绑定资产

**非目标（第二版及以后）：** 音频轨、粒子、后处理开关、嵌套 Timeline、复杂混合权重、在 Timeline 里重新制作关键帧（制作仍用现有动画编辑器）。

---

## 2. 与现有系统的关系

| 现有能力 | Timeline 中的角色 |
|----------|-------------------|
| 动画编辑器 + `.anim` + `freecapcutAnimController` | 制作与单对象绑定；Timeline **只引用并排程** clip |
| VideoPlayer → RenderTexture | 解码与贴图管线不变；Timeline **只驱动时间 / 播放区间** |
| 剪辑端特效片段 `clipLocalTime` | 导出后由剪辑端用片段本地时间作为 Timeline 的 `t` |
| 剪辑端完整时间线 | 继续负责成片；编辑器 Timeline 服务 **包内编排与预览** |

冲突规则（预览时）：

- 打开 Timeline 预览且正在采样时，**Timeline 优先**于对象上单独的 `freecapcutAnimController` 播放。
- 关闭 Timeline 预览或停止后，恢复对象自身控制器行为（若有）。

---

## 3. 场景组件：Timeline

### 3.1 创建与表示

- 菜单 **添加 → Timeline**，创建一个空 `Object3D`（或 Group）
- `userData.fccTimeline = { ... }`（与 `fccVideoPlayer` / `fccRenderTexture` 同一风格）
- Outliner 显示名称如 `Timeline`，可选角标「时」
- 侧栏选中时显示：时长、帧率、循环模式、**打开 Timeline 编辑器** 按钮

### 3.2 资产存放

- 工程目录：`assets/timelines/<name>.timeline.json`（与 `.anim` 并列）
- `project.json` / 场景节点上保存引用：`timelineProjectPath` 或内嵌 `timelineId`
- 第一版 **允许多个 Timeline 对象**并存
- 编辑器预览：**同一时刻只采样一个**（侧栏勾选 Active，或编辑窗口当前打开的那个）
- 剪辑端：对包内 **每一个** Timeline 资产，用同一 `clipLocalTime` 作为 `t` 依次采样（后采样的 Activation/动画按轨顺序覆盖）

### 3.3 数据模型（逻辑结构）

```text
TimelineAsset {
  format: "freecapcut-timeline/1"
  name: string
  fps: number                 // 默认 30，与动画编辑器一致
  duration: number            // 秒；也可由轨道内容自动撑开
  loop: "clamp" | "loop"
  tracks: Track[]
}

Track {
  id: string
  type: "animation" | "video" | "activation"
  name: string
  muted: boolean              // 静音轨道 = 预览时跳过该轨
  bindingUuid: string         // 场景对象 uuid（Animation/Activation 必需；Video 绑 VideoPlayer）
  clips: TrackClip[]
}

TrackClip {
  id: string
  start: number               // 在 Timeline 上的开始时间（秒）
  duration: number            // 在 Timeline 上占据的长度（秒）
  // 类型相关字段见下
}
```

**Animation clip 字段：**

- `animId` / `animPath`：引用 `assets/animations/*.anim`（或工程内 freecapcut anim id）
- `clipLocalOffset`：可选，从源 `.anim` 的哪一秒开始采（默认 0）
- `loop`：片段内是否循环源动画（默认 false；超出源时长时 clamp 或按 loop）

**Video clip 字段：**

- `videoPlayerUuid`：可与 `bindingUuid` 相同（绑定即该 VideoPlayer）
- `mediaOffset`：视频文件内偏移（默认 0）
- `loop`：是否在片段时长内循环视频

**Activation clip 字段：**

- 无额外媒体引用
- 语义：`[start, start+duration)` 内绑定对象 **激活显示**；轨道上无覆盖的时间 **隐藏**
- 若同一 Activation 轨上多段 clip，并集为可见区间

---

## 4. Timeline 编辑窗口

### 4.1 入口

- 选中 Timeline 对象 → 侧栏「打开 Timeline 编辑器」
- 或 View 菜单 → Timeline（若当前无 Timeline，提示先添加）

### 4.2 布局（对齐现有动画窗习惯）

- 顶部：播放 / 暂停、停止、到头、当前帧/时间、时长、fps、循环
- 左侧：轨道列表（类型图标 + 名称 + 绑定对象名）
- 右侧：时间尺 + 片段块（可拖动开始、拉时长；整数帧吸附，与动画编辑器一致）
- 底部或右键：添加轨道（Animation / Video / Activation）、添加片段、删除

### 4.3 添加内容的交互

1. **Animation 轨**：选轨道 →「添加片段」→ 弹出当前工程 `.anim` 列表；绑定对象默认用轨的 `bindingUuid`，可改
2. **Video 轨**：绑定场景中的 VideoPlayer；添加片段时默认铺满或按视频时长（若可知）
3. **Activation 轨**：绑定任意对象；在尺上拖出可见区间，或「添加激活段」填起止帧

拖入（可选第一版后做）：从 Outliner 拖对象到空轨自动建 Activation；从资源列表拖 `.anim` 到 Animation 轨。

### 4.4 预览行为

每一帧（或每次 scrub）：

1. 取当前 Timeline 时间 `t`（秒，整数帧对齐）
2. 对每条未 mute 的轨：
   - **Animation**：若某 clip 覆盖 `t`，计算 `local = t - clip.start + clipLocalOffset`，对该 `bindingUuid` 调用现有 `applyAnimToRoot`（单 clip）
   - **Video**：对绑定 VideoPlayer `seek`/`sync` 到 `mediaOffset + (t - clip.start)`（循环规则同剪辑端 pack video）
   - **Activation（已确认）**：绑定对象在片段覆盖的 `[start, start+duration)` 内 → `visible = true`；**片段外强制 `visible = false`**。未被任何 Activation 轨绑定的对象不改动。
3. 触发视口重绘

停止预览时：恢复预览前的可见性快照，避免 Activation 把场景留在半隐藏状态。

---

## 5. 运行时采样（编辑器）

建议模块：`editor/js/timeline/FccTimelineCore.js` + `FccTimelineEditor.js`（窗口 UI）。

- `sampleTimeline(editor, timelineAsset, t)`：纯函数式应用到 scene
- Viewport `animate`/`render`：若 `editor.activeFccTimeline` 在播放，每帧 `sampleTimeline`
- 与 FreeFilmCut 动画窗互斥预览：Timeline 播放时暂停动画窗本地 play（或共用一个 `editor.previewClock`）

---

## 6. 导出 vfxpack

### 6.1 打包内容

- `pack/timelines/<name>.timeline.json`
- manifest / scene.json 中节点 `kind: "timeline"`，`userData.fccTimeline` + `timeline.path`
- 继续打包已被引用的 `.anim`、videos（现有路径）

### 6.2 剪辑端

- 构建 pack 场景时加载 Timeline 资产
- 在 `renderOnePack` 里，在现有 `applyAnimToRoot` / `syncPackVideos` 之后或之中：
  - 若 pack 含 Timeline：用 `clipLocalTime` 作为 `t` 调用 `samplePackTimeline`
  - Activation：设对象 `visible`
  - Animation：按 Timeline 轨采样
  - **已确认**：包内 **只要存在至少一个 Timeline 资产**，剪辑端 **只按 Timeline 播动画**（不再对整包 `animClips` 做「全量按 clipLocalTime 采样」）。无 Timeline 的旧包 → 保持现有全量 anim 行为。

### 6.3 剪辑端建轨时长（已确认）

- 导出时写入 `manifest.duration`（秒）：
  - 若包内有 ≥1 个 Timeline 资产 → `duration = max(各 TimelineAsset.duration)`（至少 `0.01`）
  - 若无 Timeline → **不强制**改现有行为（可省略字段，或回退到现有 anim 最长时长逻辑若已有）
- 剪辑端把包拖到时间轴 / 点击「添加到时间轴」时：
  - 若 `manifest.duration` 有效（`> 0`）→ 片段 `duration = mediaTimeFromSeconds(manifest.duration)`
  - 否则 → 保持现有 `DEFAULT_NEW_ELEMENT_DURATION`（5 秒）
- 用户仍可在时间轴上手动拉长/缩短该片段；本规则只影响**首次创建**长度。

向后兼容：旧包无 Timeline、无 `manifest.duration` → 行为不变。

---

## 7. 分阶段实现

### Phase A — 骨架

- Timeline 场景对象 + 侧栏 + 空编辑窗口（尺、播放头、空轨道列表）
- 存盘 `assets/timelines/*.timeline.json`

### Phase B — Animation 轨

- 引用 `.anim`、绑定对象、scrub/play 采样
- 与现有 anim 应用路径打通

### Phase C — Video 轨

- 绑定 VideoPlayer，按 `t` seek 并写入 RT（复用 FccVideo / pack-video）

### Phase D — Activation 轨

- 显隐区间、预览快照恢复
- 导出 + 剪辑端采样

### Phase E — 打磨

- 整数帧吸附、多 Timeline 切换 Active、导出文档与缓存 bust

第一版交付以 **A→D** 为完成标准；音频 / 粒子 / 后处理明确列为后续扩展点（轨道 `type` 预留字符串即可，无需实现）。

---

## 8. 风险与约定

- **同一对象多条 Animation 轨同时覆盖 `t`**：第一版规定后写入覆盖前写入（轨列表顺序）；UI 警告重叠。
- **Activation 与动画同时绑同一对象**：允许；显隐与 TRS 独立。
- **VideoPlayer 未选 RT**：Timeline 仍 seek 视频，但画面无输出（与现行为一致）。
- **中文视频文件名**：导出路径继续用 uuid 前缀 + slug，避免打包失败。

---

## 9. 成功标准

1. 能添加 Timeline，打开独立窗口，看到播放头与轨道。
2. 能把场景中已有 `.anim` 放到 Animation 轨并预览运动。
3. 能把 VideoPlayer 放到 Video 轨，scrub 时 RT / Image 画面跟时间走。
4. 能用 Activation 轨控制物体按时显示/隐藏，停止预览可恢复。
5. 重新导出 vfxpack 后，剪辑端播放该特效时 Timeline 编排生效。
6. 不含音频轨、粒子、后处理开关的实现。

---

## 10. 已确认决策

1. **剪辑端动画**：有 Timeline 的包 → **只按 Timeline** 采样动画；无 Timeline → 旧全量 anim 逻辑。
2. **Activation**：片段外 **强制 `visible = false`**；片段内 `true`。
3. **多 Timeline**：第一版允许场景内多个 Timeline；编辑器预览一次只激活一个；剪辑端对包内全部 Timeline 按 `clipLocalTime` 依次采样。
4. **剪辑端建轨时长**：有 Timeline 的包 → 导出 `manifest.duration = max(Timeline 时长)`；添加到时间轴时用该时长；无 Timeline / 无 duration → 仍用默认 5 秒。
