# vfxpack 视频：拖动播放头后再次播放失效的根因与修复

> 现象：第一遍播放正常 → 来回拖动播放头几次 → 再按空格播放就不正常。
> 结论：这是**跨 scrub 周期的驱动状态泄漏**，不是解码能力问题。三条缺陷叠在一起，第四条在倍速 ≠ 1 时必然触发。

---

## 1. 驱动状态机

每个 pack `VideoPlayer` 在 `userData` 上维护一套驱动状态（`pack-video.ts:603-630` 的 `TimelineVideoDrive`）：

| 字段 | 谁写 | 语义 |
|---|---|---|
| `__fccTlSeekTarget` | `queueVideoSeek` | 最新的 seek 目标；元素正在 seeking 时**只记不 seek** |
| `__fccTlWantPlay` | `seekPackTimelineVideo` | NLE 是否要自由播放 |
| `__fccTlIdleParked` | idle 分支 / `seeked` 回调 | 已停靠，禁止再 seek（防 `咔咔`） |
| `__fccLastBlitMediaTime` | `syncPackVideos` | 上次 blit 的 `currentTime`，暂停时用来跳过重复 blit |
| `__fccLastDecodedFrames` | `syncPackVideos` | 上次 blit 时的已解码帧数，播放时用来跳过重复 blit |

scrub 期间和播放期间的**唯一差别**，是这套状态里的值。第一遍播放时它们是干净的；拖过一次之后就不干净了。

---

## 2. 四条缺陷

### 缺陷 1（确定）拖动期间 seek 被推迟，松手后目标被丢弃

`queueVideoSeek`：

```ts
ud.__fccTlSeekTarget = t;
if (video.seeking && !opts?.force) return;   // 只记不 seek，指望 seeked 回调补
```

`seeked` 回调（`pack-video.ts:653-660`）只在 `previewState.scrubbing === true` 时才回放这个目标。但用户松手后 `scrubbing` 立刻变 false，于是走 else 分支：

```ts
ud.__fccTlSeekTarget = Number(video.currentTime) || 0;   // ← 覆盖掉待执行目标
ud.__fccTlIdleParked = true;
```

**待执行的目标被丢弃，元素停在拖动途中最末一次 seek 的落点**，与播放头相差一个拖动距离。

### 缺陷 2（确定）play 从旧落点起步

```ts
if (clipChanged || video.paused || drift > VIDEO_SEEK_PLAY) {
  queueVideoSeek(ud, video, t, { force: clipChanged });
}
if (video.paused) video.play().catch(() => {});
```

松手时元素**极可能仍处于 seeking**（拖动期积压的 seek 还没结算）。此时 `force` 只有 `clipChanged` 才为真，同 clip 内必然走"推迟"分支 → 目标又没落下去 → 紧接着 `play()` **从旧落点开始播**。

### 缺陷 3（放大器）救场 seek 与「seeking 时跳过 blit」互相放大

`syncPackVideos` 里：

```ts
if (video.seeking) continue;   // 保留上一帧 RT（fcc-tl-flower-55 的最后好帧策略）
```

播放中若 drift > `VIDEO_SEEK_PLAY`(0.2s)，下一帧发起纠正 seek。seek 期间不 blit → **画面冻结、声音继续**。若一次 seek 无法把差距压进 0.2s（GOP 距离大、磁盘慢、4K 源），下一帧 drift 仍 > 0.2s → 再 seek → 形成**永久 seek 循环**。这是"播放不正常"最直观的形态：一卡一卡 / 画面冻住。

### 缺陷 4（顺带）timeline 路径从不设置 playbackRate

```ts
let t = (Number(mediaTimeSec) || 0) * packPlaybackRate(vp);   // 目标按倍速缩放
```

但元素的 `playbackRate` 只在 `syncPackVideos` 的**非 timeline 驱动**分支里设置。timeline 驱动时元素仍以 1x 前进，而目标按 r 倍推进 → drift 线性增长 → 每帧都触发纠正 seek。**倍速 ≠ 1 时从第一帧就是坏的**（你的 pack 倍速是 1，所以第一遍正常）。

---

## 3. 改动（`apps/web/src/vfxpack/pack-video.ts`）

| # | 位置 | 改动 | 解决 |
|---|---|---|---|
| 1 | `seeked` 回调 else 分支 | 松手后若待执行目标与落点相差 **> 0.1s**，静音补一次定位并 `return`；落地后差 < 0.1s 才 park | 缺陷 1。且**自终止**：补完后目标即满足，不会复发 |
| 2 | `seekPackTimelineVideo` wantPlay 分支 | 新增 `__fccTlStartSeekDone`，**每个播放会话强制 seek 一次**（`force: true` 穿透 `video.seeking` 的推迟） | 缺陷 2：起播位置必定等于播放头 |
| 3 | 同上，drift 纠正 | 新增 `SEEK_CORRECTION_BACKOFF_MS = 250` 退避 | 缺陷 3：把"永久 seek 循环"降级为最多 4 次/秒 |
| 4 | 同上 | 补 `video.playbackRate = packPlaybackRate(vp)` | 缺陷 4 |
| 5 | 文件末尾 | 新增 `describePackVideoState()`，开发态挂到 `window.__fccPackVideo` | 让下次复发能直接看状态，不靠猜 |
| 6 | `clearPackVideoSeekChases` | 播放结束时复位 `__fccTlStartSeekDone` / `__fccTlLastCorrectionMs` | 保证下一次播放重新强制 seek |

关键取舍：

- **`force: true` 是穿透点。** Chrome 会合并连续 `currentTime` 写入，最后一次生效，所以强制覆盖一个在途 seek 是安全且便宜的；不这么做就只能等 seeked，而那正是丢目标的来源。
- **补一次定位用 0.1s 阈值，不是 0.04s。** 阈值太紧会让"落点略有偏差"也再次 seek，重新引入循环；0.1s 是肉眼不可辨的帧级误差，足够 park。
- **保留 `if (video.seeking) continue`。** 去掉它会在 seek 期间闪黑；问题不在"跳过 blit"，而在"为什么一直在 seek"。

---

## 4. 验收清单

复现路径必须全部走一遍：

1. 播放到中段 → 暂停 → 来回拖 5 次 → 空格播放：**起播位置应等于播放头**，无"先冻一帧再追"
2. 连续快速拖拽，跨越多个 clip 边界（`clipChanged` 路径）
3. 拖到片段结束处再播放（`idleParked` 与 `loop` 边界）
4. 倍速 ≠ 1 的 pack（缺陷 4 的回归）
5. 播放中反复拖动 → 再播放

观察手段：

```js
__fccPackVideo()
```

| 字段 | 健康值 |
|---|---|
| `seeking` | 偶发 true，不应长期停在 true |
| `seekTarget` 与 `currentTime` | 播放中差值应 < 0.2 |
| `idleParked` | 播放中必须为 `false` |
| `startSeekDone` | 播放中为 `true` |
| `correctionAgeMs` | 偶发出现；**连续刷新都出现说明还有 drift 源没消除** |
| `transport` | 与 NLE 实际状态一致 |

---

## 5. 校验结果

```
pack-video.ts  tsc --noEmit  →  9 error（全部为既有：premultipliedAlpha ×3、ArrayBuffer、kind、material ×4）
pack-video.ts  eslint         →  新增代码零问题（最大报错行号 1458 < 新增块起点 1660）
```

⚠️ 该文件在我改动之前就有这 9 个类型错误，与本次改动无关。

---

## 6. 必须说明的边界

本环境无法启动编辑器复现，以上是基于状态机的静态推演 + 代码级修复。缺陷 1、2、4 是可证的逻辑错误（状态被覆盖 / 该设的属性没设），缺陷 3 是放大器。**请按第 4 节实测确认**；若仍不正常，把 `__fccPackVideo()` 的输出发我，能直接看出卡在哪个字段。

*本报告基于静态代码分析，实际行为以实测为准。*
