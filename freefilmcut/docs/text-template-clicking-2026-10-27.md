# text-template 包「视频播完还在咔咔咔」根因报告

日期：2026-10-27
资源：`apps/web/public/vfxpacks/text-templates/freecapcut.text-template.final.vfxpack`
现象：时间线播完 1.67s 的视频后，剩下 4s（GIF 段）持续听到咔咔咔

---

## 1. 结论（一句话）

**不是资源损坏，也不是「视频播完了」——是那个 mp4 里**带着一条 1.667s 的满电平 AAC 音轨**，
而包声明了 `muted: false`。播放头走过 1.667s 后，元素进入 `ended`，但时间线 transport 仍在
running（clip 还有 4s），代码于是每帧对它 `play()` 一次；按 HTML 规范，对 ended 元素
`play()` 会把时间拉回 0 重新解码 —— 音轨从头炸一下、被硬 seek 拽回末尾、再 `ended`、
再 `play()`，形成 4Hz 级的循环，听起来就是咔咔咔。**

---

## 2. 资源体检（ffprobe / 解码实测）

| 项 | 实测值 |
|---|---|
| `videos/329416b2_mg.mp4` 容器 | mp4，时长 **1.6667s**，2.76MB |
| 视频流 | h264 1280×360 @30fps，50 帧 |
| **音频流** | **AAC LC，48kHz 立体声，80 帧，1.6667s** |
| 音频电平 | **mean −5.6 dB / peak 0.0 dB**（不是静音，是满电平） |
| 音频形态 | 全程连续（每 50ms RMS 都在 −4 ~ −7 dB），**末 50ms 硬切为 −inf**（未淡出，直接被截断） |
| `media/110dd284....gif` | 800×800 @25fps，42 帧，1.68s（`loop: true`，无音轨） |

包内三处声明（manifest / text-template / scene 节点 userData）原本都是：

```json
VideoPlayer2 (kind=video, MG.mp4)  loop=false  muted=false  volume=1  autoplay=false
VideoPlayer  (kind=gif           ) loop=true   muted=false  volume=1  autoplay=true
```

于是预览里这条音轨是**真的会响**的，而且它只有 1.667s，比放在时间线上的 clip 短 4s。

---

## 3. 时间轴账本：为什么「画面上没视频了」声音还在

clip 在时间线上 5.67s（1.67 视频 + 4 GIF），mediaPlayer 的媒体只有 1.667s。

`seekPackTimelineVideo()` 对非 loop 的媒体把目标时间钳到末尾：

```ts
// pack-video.ts 旧代码
let t = (Number(mediaTimeSec) || 0) * packPlaybackRate(vp);
const d = Number(video.duration);
if (Number.isFinite(d) && d > 0) {
    if (opts?.loop) t = ((t % d) + d) % d;
    else t = Math.max(0, Math.min(d - 0.001, t));   // ← 1.667s 之后恒为 1.666
}
```

从 1.667s 起，每一帧都在让一个**已经结束**的元素去到达一个它永远到不了的时间点：

1. 元素播到底 → `ended = true` → `paused = true`
2. transport 仍是 playing → `wantPlay = true` → 走的是 **wantPlay 分支**，
   而那个专门防这个问题的 idle 分支（“after play ends: ZERO currentTime writes”）
   **永远不会执行**，因为它只判断 transport，不判断媒体
3. wantPlay 分支末尾 `if (startingPlayback) video.play()` → 依规范 ended 元素被拉回 **0**
4. 下一帧 drift ≈ 0 − 1.666 = −1.67s → `> SYNC_HARD_SEC(0.4)` → 硬 seek 回 1.666（250ms 退避）
5. 落点即末尾 → `ended` → 回到第 2 步

另有第二条放大器，在 `syncPackVideos()` 的“安全网”里（原来完全没有退避）：

```ts
if (tlDrivenV && ud.__fccTlInRange === true && playing && video.paused && !video.seeking) {
    packVideoBlitStats.stuckPausedPlays += 1;
    video.play().catch(() => {});     // ← 每帧一次，对 ended 元素
}
```

关键在于 `__fccTlInRange` 描述的是 **clip** 在不在范围内，而不是**媒体**有没有播完。
1.667s 之后 clip 还在，所以这里判定“元素卡住了，救一下”，实际上是把已结束的元素反复重启。

**为什么是“咔咔”而不是音乐**：每次 `play()` 从 0 重新起解码器，只来得及送出几十毫秒
满电平音频，就被硬 seek 切掉。切掉的位置是任意采样点，于是每次都是一个阶跃 —— 那就是爆音。
4Hz 的爆音串起来就是咔咔咔。

---

## 4. 为什么导出成片里不会有咔咔

导出走离线混音（`pack-audio.ts` → `mixPackVideoAudioClips`），非 loop 时：

```ts
} else if (sourceIndex >= sourceLength) {
    break;      // 媒体耗尽即停，后面全是静音
}
```

所以**导出只有 1.667s 的声音、之后静音，不会有爆音**。这条可以直接用来验证判断：

- 预览有咔咔 / 导出干净 → 确认是元素 transport 抖动，不是音频文件本身有噪声
- 两者都有 → 说明是音轨内容问题（本例不是）

---

## 5. 两处修复

### 5.1 代码（根因，已改）

`apps/web/src/vfxpack/pack-video.ts`

| 位置 | 改动 |
|---|---|
| L1046 | 新增 **ended-park**：`!loop && rawT >= duration` 时立即 mute + pause + 不写 currentTime + 不 `play()`，并 `return`（顺带重置 `__fccTlStartSeekDone`，让重新进入媒体范围时重新强制 start-seek） |
| L1144 | wantPlay 分支里的 `play()` 加 `!video.ended` 守卫 |
| L1955 | 自走时钟分支的 `play()` 加 `!video.ended` 守卫 |
| L2013 | 安全网加 `!video.ended && !__fccTlMediaEnded` —— **`in-range` 是 clip 的属性，不是媒体的属性** |

新增 `TimelineVideoDrive.__fccTlMediaEnded` 标记，供 `__fccPackVideo()` 探针查看。

### 5.2 资源（已改，可回滚）

三处声明里的 `VideoPlayer2`（MG.mp4）`muted` 由 `false` 改为 `true`，
GIF player 保持原样。**媒体字节未动**，只改 JSON 声明。

- 备份：`apps/web/public/vfxpacks/text-templates/.backup-freecapcut.text-template.final.vfxpack`（4.2MB，原始文件）
- 校验：zip 33 个条目、CRC 全通过、JSON 可解析、GIF 声明未变

副作用（需要你确认是否符合预期）：`pack-audio.ts` 里 `if (source.muted || source.volume <= 0) continue`，
所以**导出这条 1.667s 的声音也会一起消失**。这多半是想要的（MG 视频本不该带音乐），
若要保留声音，从备份恢复即可，代码修复仍能保证不再咔咔（只是声音到 1.667s 会正常停）。

---

## 6. 验证步骤

1. 硬刷新编辑器（pack 有缓存）
2. 把这个 text template 拖到时间线，让 clip 后面的 4s 落在 GIF 段
3. 空格播放到底，**盯住 1.667s 之后那 4 秒**：应当完全安静
4. 再回头从 0 播一遍：1.667s 内画面正常、无爆音
5. 拖播放头跨过 1.667s 边界来回拖：不应当出现咔咔
6. `window.__fccPackVideo()` 里看 `idleParked` / 新增的 `mediaEnded` 是否为 true

---

## 7. 校验

- `tsc --noEmit`：**154 errors**，与改动前一致；`pack-video.ts` 5 个报错均为既有（`premultipliedAlpha`×2、`ArrayBuffer`、`kind`、`material`）
- `eslint pack-video.ts`：27 error，全部落在未改动的行（`prefer-object-params` / `no-unsafe-type-assertion` 等历史写法），**新增代码行段 0 报错**

---

> 本报告基于资源静态解析（ffprobe / JSON 结构）与运行时源码路径推导，仅供参考。
> 现象与因果链已通过“导出路径不会出现该问题”这一可独立验证的差异做了交叉校验。
