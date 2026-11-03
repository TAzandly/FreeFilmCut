# "只有播放箭头在 vfxpack clip 上时，里面的视频才正常播放"

日期：2026-10-27
文件：`apps/web/src/vfxpack/pack-video.ts`

---

## 一、先说清楚：一半可能是正确行为

必须先区分两种情形，因为它们需要完全相反的结论：

| 情形 | 现象 | 是否 bug |
|---|---|---|
| **A. 播放头在 pack 元素上、但不在内层 video clip 的范围内** | 视频停在内层 clip 的最后一帧/首帧，不动 | **不是 bug**。内层 clip 只覆盖一段区间，出区间就该冻住 |
| **B. 播放头从别处播放，进入内层 clip 范围的那一刻** | 画面不开始动，或先黑一下再也不出 | **是 bug**。元素应该在进入区间时 `play()` |

上一轮修完"2s 起播、3s 进 clip 只有咔咔"之后，如果你看到的是 **A**，那是正常的；如果看到 **B**，那是下面这条链路的问题。

---

## 二、B 情形：为什么可能"进区了也不播"

上一轮的修复把传输权判给了时间线（`__fccTlBound`），这修好了双驱动打架，但同时**收窄了唯一的启动入口**：

| | 修复前 | 修复后 |
|---|---|---|
| 谁调用 `video.play()` | `syncPackVideos` 自走时钟（每帧都试） | **只有** `seekPackTimelineVideo` 的 `wantPlay` 分支 |
| 出区间时 | 自走时钟照样拽着播 | 被正确 park（暂停+静音） |

于是"能不能起播"就完全押在 `seekPackTimelineVideo` 这一条路径上。它有四个前置条件，任一个不满足画面就永远不动：

```ts
const wantPlay = !!(opts?.playing && previewState.playing);
...
if (startingPlayback) video.play().catch(() => {});
```

1. `opts.playing` —— 来自 `three-compositor.ts:1379` 的 `timelinePlaying: nlePlaying`
2. `previewState.playing` —— 来自 `preview/components/index.tsx:308` 的 `setPackVideoPreviewState`
3. `startingPlayback = video.paused`
4. 而且必须真的走到 `seekPackTimelineVideo`（即预览这一帧确实重绘了、`samplePackTimeline` 确实访问了这个元素）

其中第 3 条最脆：**`startingPlayback` 只在 `video.paused === true` 时为真**。如果元素因为任何原因处于"`paused === false` 但没在推进"的僵死状态（seek 卡住、`play()` 被上一次 `pause()` 打断），这条路径就再也不会叫它 `play()` —— 而自走时钟已经被禁用，于是**没有任何代码会救它**，正好表现为"只有把播放头直接放到 clip 上（重新触发一次 park→start）才恢复"。

---

## 三、本次改动

### 3.1 出区间时把播放会话状态彻底复位

`mediaTimeSec == null`（clip 不在范围）分支原来直接 `return`，`__fccTlStartSeekDone` 等标记原样保留。现在补上：

```ts
ud.__fccTlInRange = false;
ud.__fccTlStartSeekDone = false;
ud.__fccTlLastCorrectionMs = 0;
ud.__fccTlSyncMode = "idle";
```

理由：**离开 clip 就是一次播放会话结束**。不清这些，下一次进区会继承上一次的中间态，导致"从区间外播进来"和"把播放头放上去再播"两条路径行为不一致 —— 这正是你观察到的差异。

### 3.2 加一道起播兜底（不动时间线权威）

`syncPackVideos` 是每帧唯一还会遍历到所有 player 的地方。新增：

```ts
if (tlDrivenV && ud.__fccTlInRange === true && playing && video.paused && !video.seeking) {
    packVideoBlitStats.stuckPausedPlays += 1;
    video.play().catch(() => {});
}
```

约束条件写得很死，保证它不会把上一轮的双驱动问题带回来：

- 只在**已绑定时间线**且**本帧在区间内**时生效（出区间的元素照旧 park）
- 只在 `video.paused` 时生效（时间线已经叫过 `play()` 的话它是 no-op）
- **不写 `currentTime`，不写 `playbackRate`** —— 只做"开始播"这一件事，瞄准永远是时间线说了算
- `!video.seeking` —— seek 在飞时不动它（那会取消 seek）

`stuckPausedPlays` 计数进了探针：**如果这个数在增长，就说明时间线路径确实漏掉了起播**，可以直接定位；如果一直是 0，说明问题不在这里。

### 3.3 新增逐帧录像探针

`__fccPackVideo()` 是静态快照，看不到"边界那几帧发生了什么"。新增：

```js
await __fccPackVideoRecord({ ms: 5000 })
```

每帧采样，**只在离散状态变化时打一行**，输出表格：

| 列 | 含义 |
|---|---|
| `ms` | 相对开始录制的毫秒 |
| `ct` | `video.currentTime` |
| `rate` | `playbackRate` |
| `paused` | 元素是否暂停 |
| `seeking` | 是否有 seek 在飞 |
| `inRange` | 上一帧时间线是否认为它在 clip 区间内 |
| `transport` | NLE 是否在播放 |
| `syncMode` | 同步状态机分支 |
| `seeks` / `waits` | 累计 seek / 解码断流次数 |

**判读**：跨过 clip 起点时，期望看到

```
inRange: false → true    paused: true → false    ct 开始递增    syncMode: idle → start-seek → locked
```

如果看到 `inRange: true` 但 `paused` 一直是 `true`，且 `syncMode` 停在 `idle`，说明 `seekPackTimelineVideo` 根本没被调用到（预览没重绘 / `samplePackTimeline` 没访问该元素）；
如果 `syncMode: start-seek` 之后 `ct` 不涨，说明 seek 卡死。

`__fccPackVideo()` 也新增两个字段：`inRange`（本帧是否在区间内）、`stuckPaused`（在区间内、正在播放、但元素仍暂停 —— 这就是"坏了"的那一帧）。

---

## 四、校验

`pack-video.ts`：**9 个 tsc 错误 / 27 个 lint 错误**，全部为既有历史基线，本次 0 新增。

---

## 五、怎么确认

1. 把播放头放到 clip **之前**，按空格，让播放头自然走进 clip。
2. 同时（或事后重放）执行 `await __fccPackVideoRecord({ ms: 6000 })`。
3. 把表格发我。

如果视频这次能正常起播了，也请跑一次 `__fccPackVideoWatch({ ms: 6000 })`，确认 `stuckPausedPlays` 是不是 0 —— 如果大于 0，说明兜底在生效，那时间线路径确实有漏，需要单独修那条路径。

---

> 本报告基于静态代码分析，A/B 两种情形的区分请以第 5 节实测录像为准。
