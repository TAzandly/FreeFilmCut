# vfxpack clip 从 3s 起播、播放头在 2s 按空格 → 只有咔咔声、无画面

日期：2026-10-27
文件：`apps/web/src/vfxpack/pack-video.ts`

---

## 一、症状拆解

用户描述：播放头停在 2s，vfxpack clip 从 3s 开始；按空格播放后 —— **只有声音"咔咔咔"，画面一直不出来**。

这两句话合起来已经锁定了故障类别：

| 症状 | 含义 |
|---|---|
| 有**咔咔声** | 元素是**未静音**状态（`audible = wantPlay && vp.muted !== true`），并且 `currentTime` 被反复写入 —— 每次 seek 都会咔一声 |
| **画面不出来** | `syncPackVideos()` 里 `if (video.seeking) { continue; }` —— seek 期间跳过 blit，所以 RT 一个像素都没被写进去 |
| **持续不恢复** | seek 是自持续的：元素在 seek 中无法前进 → 下一帧测到同样的偏差 → 又下发一次 seek → `seeking` 永远为 true → blit 永远被跳过 |

结论：**不是没解码，是永远在 seek。**

---

## 二、根因：两个驱动器同时抢同一个 `<video>`

### 2.1 谁在驱动

`three-compositor.ts:1400`：

```ts
syncPackVideos(renderer, built.root, clipLocalTime, {
    driveTransport: !timelineOwnsVideo,   // ← 关键
});
```

而 `timelineOwnsVideo` 的定义（`three-compositor.ts:1353`）是：

```ts
const timelineOwnsVideo = timelines.some((a) => timelineAssetHasVideoTracks(a));
```

它检查的是**时间线里有没有 video 轨道**。

但 vfxpack 的活动画面不在 video 轨道上 —— 它在 `VideoPlayer` 节点里，挂在**图形/文字轨道**上（这正是 `hasPlayingPackVideo()` 注释里写过的情形）。于是：

- `timelineOwnsVideo === false`
- → `driveTransport === true`
- → `syncPackVideos` 认为"没人接管，我自己来"
- → 进入自走时钟分支，`video.play()` + `video.currentTime = targetTime`

与此同时，`samplePackTimeline` 也在驱动同一个元素（`vfxpack/timeline.ts:174` → `seekPackTimelineVideo`），带着软同步状态机（45ms 带内不动 / 400ms 以上 seek / 中间靠 playbackRate 微调）。

**同一个元素，两个驱动器，两套阈值。**

### 2.2 它们怎么打起来的

`syncPackVideos` 里原来的判定是：

```ts
const tlDrivenV = !driveTransport && ud.__fccTlMediaDriven === true;
```

`driveTransport === true` 时这个表达式**恒为 false**，无论时间线是不是真在驱动它。所以自走时钟分支永远会跑，每帧做两件破坏性的事：

1. **`applyPackVideoRate({ video, rate: packPlaybackRate(vp) })`**
   无条件把 rate 写回基准值（只有变化 >0.008 才写，但软同步的 trim 一旦生效就必然 >0.008）→ **软同步的 ±15% 微调每帧被抹掉** → 偏差永远收不回来。

2. **`if (Math.abs(currentTime - targetTime) > 0.2) video.currentTime = targetTime`**
   而且 `targetTime = localVideoTime(video, clipLocalTime, loop)` 用的是 **pack 元素自己的本地时间**，跟 `seekPackTimelineVideo` 里的 `t = mediaTimeSec * rate`（内层 clip 的媒体时间）**是两个不同的时钟**。两个时钟只要有一点错位，偏差就一直 > 0.2s → **每帧 seek**。

结果就是：`video.seeking` 几乎恒为 true → blit 全部跳过 → 画面黑/停在旧帧；元素未静音 → 每次 seek 咔一声。

### 2.3 为什么"2s 按空格、3s 起播"必然触发

这个时序恰好把两个坑叠满：

1. **2s 时** clip 不在范围内，`samplePackTimeline` 走 `seekVideo(obj, null, { playing: false })`（`vfxpack/timeline.ts:180`）→ 元素被 pause + mute，停在某个旧位置（比如上次播放留下的 5s）。
2. **3s 时** clip 进入范围 → `clipChanged` 为真 → `queueVideoSeek(force: true)` 强制把 `currentTime` 拉回 0，然后 `video.play()`。这个 seek 是**异步的，30~250ms**。
3. seek 在飞的过程中，`syncPackVideos` 的自走时钟分支**不知道有人在 seek**（它只在自己的入口处才检查 `video.seeking`，而这一帧的偏差检查发生在 seek 发起之后）→ 又下发一次 `currentTime`。
4. 每次下发都把上一个大 budget 的 seek 取消重来 → **永远落不了地** → 画面永远不出，声音一直在咔。

所以"第一遍正常、来回拖几次再播不正常"和这次的"2s 起播到 3s"是同一族问题的两个入口：**只要让元素在起播瞬间进入"有 seek 在飞 + 另一个驱动器还在发号施令"的状态，就会自锁。**

---

## 三、修复

### 3.1 传输归属改成元素属性，而不是每帧状态

新增 `TimelineVideoDrive.__fccTlBound`，在 `seekPackTimelineVideo()` **最开头**无条件置 `true`（包括 `mediaTimeSec == null` 的那次"仅 park"访问）：

```ts
const kind = packMediaKind(ud.fccVideoPlayer, ud.__fccMediaCache);
// Mark the element as timeline-owned from the very first visit, including the
// "out of range" visit that only parks it.
ud.__fccTlBound = true;
```

理由写在类型注释里：

> Per-frame flags cannot express "who owns transport", because "not driven this frame" means *the timeline parked it*, not *nobody owns it*.

然后 `syncPackVideos()` 两处判定都改成：

```ts
const tlDrivenV = ud.__fccTlBound === true || !driveTransport;
```

- 被 pack 时间线访问过的元素 → **永远由时间线独占传输**，`syncPackVideos` 只负责 blit。
- 真正独立的 pack VideoPlayer（pack 里没有 timeline，一次都没被访问）→ 保持原来的自走时钟行为。

这一改同时修好了 gif / imageSequence 分支 —— 原来 `__fccMediaTime` 会被 pack 本地时间覆盖成错误值，导致图形轨道上的 gif pack clip 取到错帧。

### 3.2 自走时钟不再每帧追 seek

即使将来还有别的路径把元素推进 seek，也不能让它变成永久冻帧：

```ts
if (Math.abs((video.currentTime || 0) - targetTime) > VIDEO_SEEK_PLAY) {
    const now = performance.now();
    if (now - (ud.__fccTlLastSeekKickMs || 0) >= SEEK_CORRECTION_BACKOFF_MS) { // 250ms
        ud.__fccTlLastSeekKickMs = now;
        video.currentTime = targetTime;
    }
}
```

理由：**元素在 seek 中无法前进，所以下一帧测到的还是同一个偏差**；每帧重发只会不停取消上一个 seek，把它从"瞬时偏差"变成"永久冻帧"。

### 3.3 探针同步扩容

`__fccPackVideo()` 新增两个字段：

| 字段 | 含义 |
|---|---|
| `tlBound` | 该元素是否已归属 pack 时间线（`true` 时 `syncPackVideos` 不应再驱动它） |
| `timelineFresh` | 最近 ~2 帧内时间线是否真在驱动它（`__fccTlMediaDrivenAt` + 120ms 窗口） |

修好之后正常播放时应该是：`tlBound: true` / `timelineFresh: true` / `syncMode: "locked"`（偶尔 `trim-slow`/`trim-fast`）/ `seeks` 只在起播时 +1 / `skipSeeking` 不涨。

---

## 四、回归验证清单

按下面顺序操作，每步用 `__fccPackVideo()` 复核：

1. 播放头移到 2s（clip 在 3s）→ 空格播放 → **画面应在 3s 处正常出现**，无咔咔声。
2. 同上，但先把播放头拖到 10s 越过 clip → 再拖回 2s → 空格播放。`seeks` 应在起播时 +1 后不再增长。
3. 播放中按空格暂停 → 再按空格继续（clip 已在范围内，走 `__fccTlStartSeekDone` 路径）→ 不应卡帧。
4. 循环播放越过 clip 首尾边界 3 次 → `waits` 应保持不涨。
5. `__fccPackVideoWatch({ ms: 6000 })` → `skipSeekingPerSec` 应接近 0，`driftMs.p90` < 45ms，`syncModes` 里 `locked` 占绝大多数。

---

## 五、校验

- `pack-video.ts`：**9 个 tsc 错误 / 27 个 lint 错误**，全部是既有历史问题（`premultipliedAlpha` ×3、`material` ×4、`kind`、`ArrayBuffer`、`prefer-object-params` 等），**本次改动 0 新增**。
- 未改动 `three-compositor.ts` 的 `driveTransport` 语义，改动完全收敛在 `pack-video.ts` 内部，不影响其他 pack 类型。

---

> 本报告基于静态代码分析与既有日志线索推导，修复效果以第 4 节清单实测为准。
