# vfxpack 视频与播放头不同步：诊断与修复

> 输入：`vfxpack` 视频更新与剪辑端播放箭头不一致（播放态）
> 结论先行：**时间基准本身是对的，不一致来自"视频元素自己有一套时钟"和"预览只有部分帧会重画"这两件事。**

---

## 1. 先把三个时间对齐，证明基准没错

排查同步问题最容易犯的错是直接改时间换算，结果越改越偏。所以先把链路摊开，逐个核对。

```
playback.currentTimeContinuous      ← performance.now() 推算的连续时间
        │
        ├─ samples 帧对齐 → playback.currentTime (roundFrameTime)
        │
        ├─ preview render({ time: snappedTime })
        │        │
        │        └─ resolve: localTime = timelineTime - element.startTime  (clamp 到 elementDuration)
        │                │
        │                └─ clipLocalTime  →  three-compositor.ts:1365
        │
        └─ bias = continuousSec - snappedSec  →  pack-video.ts:594
                 │
                 └─ tlT = clipLocalTime + bias   ← 等价于 localTime(continuous)
                          │
                          └─ samplePackTimeline(t = tlT)
                                   │
                                   ├─ time  = snapTimeToFrame(tlT, pack.fps)   → 动画 / 后处理
                                   └─ tVideo = playing ? tlT : time            → 视频
                                            │
                                            └─ mediaT = tVideo - clip.start + clip.mediaOffset
                                                     │
                                                     └─ seekVideo(obj, mediaT)
```

逐项核对结果：

| 环节 | 代码 | 结论 |
|---|---|---|
| 连续时钟 | `playback-manager.ts:233-241` | `currentTimeContinuous = performance.now()` 推算，播放箭头用 `roundFrameTime` 后的值，两者最多差半帧 |
| bias 补偿 | `pack-video.ts:594-600` | 把「帧对齐」误差补回到连续时间，逻辑正确 |
| 局部时间 | `animation/resolve.ts:22` | `timelineTime - element.startTime`，clamp 到 `[0, duration]`，正确 |
| pack 视频时间 | `vfxpack/timeline.ts:170` | `tVideo - clip.start + clip.mediaOffset`，正确 |
| 两层时间源一致性 | `three-compositor.ts:1365` 与 `2515-2521` | 主 pack 时间线与 TextAnim 内嵌媒体用的是同一套 `clipLocalTime + bias`，一致 |

**所以不存在"少算了一帧""算错偏移"这类问题。** 问题出在 `seekVideo` 之后。

---

## 2. 三个真正的不一致来源

### 2.1 起播相位差：seek 的代价被永久留在画面上

`pack-video.ts` 的播放分支：

```ts
if (clipChanged || (startingPlayback && !ud.__fccTlStartSeekDone)) {
  queueVideoSeek(ud, video, t, { force: true });   // 异步，耗 30~250ms
}
if (startingPlayback) video.play().catch(() => {}); // 立刻 play
```

`video.currentTime = t` 在 Chromium 里是**异步**的：写入后要等解码器定位到关键帧再往前解到目标帧。4K 素材、GOP 较长时这一步常见 100ms 以上。

于是：

- 播放箭头：从 `t` 开始，`performance.now()` 驱动，立刻走。
- 视频元素：`play()` 之后要等 seek 完成才从 `t` 出帧，**实际起播时刻比箭头晚了一个 seek 的耗时**。

更关键的是原来的纠偏门槛：

```ts
} else if (drift > VIDEO_SEEK_PLAY) {   // 0.2s
```

**0.2 秒 = 6 帧 @30fps。** 只要起播相位差小于 200ms（几乎总是），它就**永远不会被纠正**。整个 clip 从头到尾稳定地慢一截 —— 这正是"不一致"最典型的手感：不是抖，是恒定地差一点。

### 2.2 纠偏本身会造成新的冻结

即使 drift 超过 0.2s 触发了纠正，`syncPackVideos` 里有：

```ts
if (video.seeking) continue;   // 保留上一帧 RT
```

seek 期间不 blit，画面冻住。而一次 seek 之后相位又变了 —— **用 seek 去修 seek 造成的偏移，是拿同一个副作用当解药**。所以纠偏越频繁，观感越差。

### 2.3 画面更新频率被 frame-gate 卡在项目 fps

`preview/components/index.tsx` 决定要不要每个 rAF 都重画：

```ts
const needsLivePresent =
  videoFrameDirty || flowerTextDirty || hasActiveTimelineVideo(editor);
const playPresentEveryRaf = playing && needsLivePresent && lastRenderMs < 40;
```

`hasActiveTimelineVideo` 只认 timeline 元素 `type === "video"`。

**但 pack 的活动画面不是 `VideoElement`，而是 pack 内部的 `VideoPlayer`（视频被贴到 RT 再采样）。** 所以当 pack clip 放在 graphic / text 轨道上时：

- `hasActiveTimelineVideo` → `false`
- `videoFrameDirty` → 播放中不 bump（只有 seeked / gif 上传才 bump）
- ⇒ `playPresentEveryRaf = false`

预览退回 `frame === lastFrameRef.current` 的帧对齐判断，**画面按项目 fps（例如 30）step，而播放箭头按显示刷新率（60）移动**。两倍频差，肉眼就是"视频跟不上箭头"。

---

## 3. 改动

只动两个文件：`vfxpack/pack-video.ts`、`preview/components/index.tsx`。

### 3.1 软同步取代硬 seek

新增阈值与增益：

```ts
const SYNC_BAND_SEC   = 0.045;  // 死区，约 1.5 帧 @30fps，看不出来就不动
const SYNC_HARD_SEC   = 0.4;    // 超过就走 seek（速度追不回来了）
const SYNC_GAIN       = 1.2;    // 比例增益
const SYNC_RATE_LIMIT = 0.15;   // 速度微调上限 ±15%
```

播放分支变成四态：

| 状态 | 条件 | 动作 |
|---|---|---|
| `start-seek` | clip 切换 / 本次会话首次播放 / 已有 seek 在途 | 强制 seek 一次，rate 归基准 |
| `hard-seek` | `\|drift\| > 0.4s` | 退避 seek（沿用原有 250ms backoff） |
| `trim-slow` / `trim-fast` | `0.045s < \|drift\| ≤ 0.4s` | **只改 playbackRate**，seek 到 `baseRate * (1 - drift*1.2)` |
| `locked` | `\|drift\| ≤ 0.045s` | rate 回到基准 |

为什么用速度微调而不是 seek：

- 0.1s 的偏移，rate 调 12%，**0.8 秒内自然追平**，全程没有冻结帧；
- 播放中不产生新的 `seeking`，也就不会触发 `if (video.seeking) continue` 的冻画面；
- 视觉上只是极轻微的速度变化，比"卡一下再跳"好得多。

`playbackRate` 只在变化超过 0.008 时才写（`applyPackVideoRate`）。原先每帧无条件赋值，Chromium 每次都会重算管线，这也让"不纠正"这个稳态很难成立。

### 3.2 让 pack 视频进入 live present 判定

```ts
export function hasPlayingPackVideo(): boolean {
  for (const video of livePackVideos) {
    if (!video.paused) return true;
  }
  return false;
}
```

```ts
const needsLivePresent =
  videoFrameDirty || flowerTextDirty ||
  hasActiveTimelineVideo(editor) ||
  hasPlayingPackVideo();      // ← 新增
```

播放中 pack 视频会逐 rAF 出帧，`lastRenderMs < 40` 仍然守着性能上限（合成慢于 40ms 会自动退回帧对齐，不会失控）。暂停时元素是 `paused`，返回 `false`，静止帧休眠逻辑完全不受影响。

### 3.3 可观测

`__fccPackVideo()` 新增两个字段：

| 字段 | 含义 |
|---|---|
| `driftMs` | 视频相对播放头的时间差，**正值 = 视频超前**，负值 = 视频滞后 |
| `syncMode` | 当前处于四态中的哪一个 |

`seekTarget` 与 `currentTime` 的差是 seek 层面的，`driftMs` 是最终呈现层面的 —— 判同步要看后者。

---

## 4. 验收

播放中反复执行：

```js
__fccPackVideo()
```

| 观察 | 判读 |
|---|---|
| `syncMode` 在 `trim-*` 与 `locked` 之间切换，`driftMs` 单调收敛到 ±45ms 内 | 正常 |
| `syncMode` 长期停在 `hard-seek`，`seeking: true` | seek 压不进去，看素材（GOP / 4K / 磁盘） |
| `driftMs` 稳定在 -XXX ms 且 `syncMode: locked` | 说明死区被撑大了，把 `SYNC_BAND_SEC` 调小 |
| `driftMs` 在 ±300ms 之间来回跳 | 有两个时钟在打架，检查是否还有别处写 `currentTime` |
| `playing: true` 但 `driftMs` 不变 | 元素没在推进，看 `paused` / `readyState` |

画面层面看两件事：

1. 播放中画面是否**连续**（没有周期性冻一帧）
2. 播放头经过某个可辨识画面（比如某一帧文字）时，视频里的同一画面是否**同时**出现

---

## 5. 没做的事与已知边界

**1. `mediaOffset` 被 playbackRate 二次缩放（未修，需 API 变更）**

```ts
let t = (number_of_media_time) * packPlaybackRate(vp);
```

`mediaT` 已经含 `clip.mediaOffset`。当 `rate !== 1` 且 `mediaOffset !== 0` 时，正确值应是 `(tVideo - start) * rate + mediaOffset`，现在的写法把 offset 也乘了进去，误差为 `mediaOffset * (rate - 1)`。

默认 pack 都是 1 倍速、offset 为 0，所以不触发。修它要改 `seekVideo` 的签名把 offset 单独传下来，改动面比收益大，留作独立 PR。

**2. 画面更新频率的上限仍在合成侧**

`playPresentEveryRaf` 依赖 `lastRenderMs < 40`。如果单个 pack 合成需要 30ms，预览只能到 ~33fps，此时视频仍会看起来比箭头"糙"。这是 `resolveRenderTree` 逐节点 `await` + `measureTextElement` 零缓存的老问题（见 `performance-review-2026-10-27.md`），不是同步逻辑能解决的。

**3. 音画关系**

vfxpack 视频默认 muted，走 `<video>` 自身时间轴；剪辑端音频走 WebAudio。两者本来就不同源，这次的软同步只把**画面**贴到播放头，不会把视频自带音轨对齐到 WebAudio —— 这类 pack 若要出声，应该走项目的音频链路而不是元素音轨。
