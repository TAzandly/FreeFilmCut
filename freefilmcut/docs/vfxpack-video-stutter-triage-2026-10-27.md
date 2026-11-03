# vfxpack 视频播放卡顿 —— 是否需要预缓存 + 探针位置

日期：2026-10-27
涉及文件：`apps/web/src/vfxpack/pack-video.ts`

---

## 一、需要"提前缓存"视频吗？—— 不需要

先看这段源码（`pack-video.ts:1107`）：

```ts
function packVideoUrl(pack: LoadedVfxPack, relPath: string): string | null {
	const cached = pack.objectUrls.get(relPath);
	if (cached) return cached;
	const bytes = pack.files.get(relPath);        // ← 整个 mp4 的字节，已经在内存里
	if (!bytes) return null;
	const url = URL.createObjectURL(new Blob([bytes.slice()], { type: videoMime(relPath) }));
	pack.objectUrls.set(relPath, url);
	return url;
}
```

结论：**pack 里的视频是以 `Uint8Array` 形式整体驻留内存的，通过 `blob:` URL 喂给 `<video>`。没有网络请求，没有分片下载，`fetch` 阶段耗时为 0。**

所以：

| 你可能想做的 | 有用吗 | 原因 |
|---|---|---|
| `preload="auto"` | 已经做了 | `pack-video.ts:1389` |
| 额外 fetch 一遍预热 HTTP 缓存 | ❌ 无用 | blob URL 不走网络层 |
| 把视频转成 base64 / IndexedDB 缓存 | ❌ 无用 | 字节本来就在 RAM |
| 等 `loadeddata` 再挂到场景 | 已经做了 | `pack-video.ts:1392-1396` |

**真正决定卡不卡的三件事，预缓存一件都解决不了：**

1. **解码能力** —— 源视频分辨率/码率超过实时解码预算（例如 4K60 素材、HEVC 10bit），浏览器解码线程跟不上，`waiting` 事件频繁触发。
2. **同步 seek 风暴** —— 软同步状态机或 start-seek 在播放中反复写 `currentTime`，每次 seek 都要清空解码缓冲重新 prime，画面直接冻一帧。
3. **合成耗时** —— 元素解码完全正常，但预览每帧要做「全场景 recompose + 视频纹理上传 + blit 到 RT + preserveDrawingBuffer 拷贝」，超过 40ms 就触发 `preview/components/index.tsx:355` 的降帧门限，画面按项目 fps（可能 30）步进，而播放头按 60 走。

这三者的表现肉眼一样，必须用数据区分。这就是下面探针的作用。

---

## 二、`__fccPackVideo()` 在哪 / 怎么发给我

### 定义位置

| 项目 | 位置 |
|---|---|
| 挂载到 window | `apps/web/src/vfxpack/pack-video.ts:2122-2140` |
| 实现函数 | `describePackVideoState()`，同文件 ~1875 行 |
| 生效条件 | `process.env.NODE_ENV === "development"` —— **只在 dev 模式存在，生产包没有** |

### 怎么用

1. 确保是 `bun dev` / `npm run dev` 起的开发服务器（不是 `build` 后的产物）。
2. 打开剪辑页，浏览器 F12 → Console。
3. 播放那段会卡的 vfxpack 视频，卡顿发生时立刻敲：

```js
__fccPackVideo()
```

会打印一张表并返回数组。

### 怎么把数据发给我（三种，任选）

**方式 A（推荐，最省事）—— 一行文本：**

```js
copy(__fccPackVideoJSON())
```

执行后 JSON 已经在剪贴板，直接粘贴到对话里即可（包含 `previewState`、blit 统计、每个 video 的完整状态）。

**方式 B —— 截图：**
`__fccPackVideo()` 会 `console.table`，截图整张表就够。

**方式 C —— 复制对象：**
`__fccPackVideo()` 的返回值在控制台会显示为数组，右键 → *Copy object* → 粘贴。注意这个格式我能读，但不如 A 直接。

---

## 三、新加的判别探针：`__fccPackVideoWatch()`

单帧快照看不出卡顿，必须采一段窗口。新增：

```js
// 播放中执行，保持播放 6 秒，自动汇总
await __fccPackVideoWatch({ ms: 6000 })
```

输出两部分：

**① 每个 video 元素的窗口增量表**

| 字段 | 含义 |
|---|---|
| `res` | 源分辨率，如 `1920x1080` |
| `seeks` | 窗口内该元素被 seek 的次数（增量） |
| `waits` | 窗口内 `waiting`（解码断流）次数（增量） |
| `plays` | 窗口内 `playing`（重新起播）次数（增量） |
| `decodeFps` | 实际解码帧率 = totalVideoFrames / 窗口秒数 |
| `newFrames` | 窗口内新增的解码帧数 |

**② `[vfxpack] playback window summary` 汇总**

| 字段 | 含义 |
|---|---|
| `appFps` | 预览实际 rAF 帧率 |
| `blitPerSec` | 每秒真正的 RT blit 次数 |
| `skipSeekingPerSec` | 每秒因「元素正在 seek」而跳过 blit 的次数 —— **这就是「画面冻住但声音在跑」的计数** |
| `skipUnchangedPerSec` | 每秒因「帧未变化」跳过的次数（正常应接近显示器帧率 - 解码帧率） |
| `driftMs.p50/p90/max` | 视频与播放头偏移的分布 |
| `syncModes` | 各同步分支命中次数（`locked` 应占绝大多数） |

### 判读对照表

| 现象 | 结论 | 该改哪里 |
|---|---|---|
| `waits > 0` 且 `decodeFps` 明显低于源帧率 | **解码瓶颈** | 降素材：1080p→720p、H.264 替代 HEVC、码率 ≤ 8Mbps。代码层无解 |
| `seeks` 每秒 > 2，`syncModes` 里 `hard-seek` 占比高 | **seek 风暴** | 查 `SYNC_HARD_SEC`/`__fccTlWantPlay`；可能是 `mediaOffset` 乘 rate 的已知偏差在放大漂移 |
| `skipSeekingPerSec` > 5 | **seek 期间冻帧** | 同上，seek 太频繁 |
| `appFps` < 45，但 `waits = 0`、`seeks ≈ 0` | **合成瓶颈** | 全场景 recompose 太重（`resolveRenderTree` 串行 await、`measureTextElement` 零缓存、`preserveDrawingBuffer` 每帧拷 8MB） |
| `appFps ≈ 60`，`decodeFps ≈ 30`，`skipUnchangedPerSec ≈ 30` | **完全正常** | 源是 30fps 素材，blit 按解码帧走，这是正确行为 |
| `blitPerSec` > `decodeFps` × 1.5 | **重复 blit 浪费** | `webkitDecodedFrameCount` 缺失（非 Chromium），退化成每 rAF 全量上传 |

---

## 四、这次改了哪些代码

只加观测，不改行为，默认零开销（三个事件监听 + 几个计数器）。

`apps/web/src/vfxpack/pack-video.ts`：

1. 新增 `PackVideoCounters`（`seekCount` / `seekMs` / `waitingCount` / `playingCount`）与 `attachPackVideoCounters()`，在 `registerLivePackVideo()` 里挂一次。
2. 新增 `packVideoBlitStats`（`blit` / `skipSeeking` / `skipUnchanged`），在 `syncPackVideos()` 的两个 blit 点和三个 skip 点计数。
3. 记录 blit 目标 RT 尺寸（`__fccBlitRtW/H`）—— 若 RT 是 2160p 而预览画布只有 720p，那是纯填充率浪费。
4. `describePackVideoState()` 扩充：`res` / `rtRes` / `bufferedEnd` / `waits` / `plays` / `seeks` / `seekMs` / `totalFrames` / `droppedFrames`（`getVideoPlaybackQuality()`，Chrome 的标准 API，是「画面确实在掉帧」的权威数据）。
5. 新增 `watchPackVideoState()` + `window.__fccPackVideoWatch`。
6. 新增 `window.__fccPackVideoJSON()`。
7. `__fccPackVideo()` 现在自带 `console.table`。

校验：`pack-video.ts` 仍为原有 9 个 tsc 错误 / 27 个 lint 错误，新增代码 0 新增。

---

## 五、如果确认是合成瓶颈，下一步做什么（按性价比排序）

1. **`measureTextElement` 加缓存** —— 现在每帧每个 TextNode 都重新 `measureText`，静态场景纯浪费。
2. **`resolveRenderTree` 去掉串行 await** —— 逐节点 await 把并行变成串行。
3. **预览/导出分离 `preserveDrawingBuffer`** —— 预览关掉，导出才开。
4. **播放期静态层缓存** —— 场景里不动的东西只渲染一次到背景 RT，每帧只重绘有视频的那一层。这是最大的一笔，也最复杂。

前三条都是「不改变行为、只省算力」，可以独立 PR。

---

> 本报告基于静态代码分析与经验规则给出，实际结论请以 `__fccPackVideoWatch()` 的实测数据为准。
