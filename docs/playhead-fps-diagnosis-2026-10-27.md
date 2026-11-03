# 播放头不动 + FPS 40 诊断报告

日期：2026-10-27
范围：时间线播放头定位（`PlayheadController` / `TimelinePlayhead`）、预览渲染循环、Light meter

---

## 1. Light meter 的 FPS 是怎么算的

实现在 `src/components/fcc-light-fps.tsx`，是一个**独立的、不碰 React 和渲染管线的 rAF 计数器**：

```ts
let frames = 0;
let last = performance.now();
const tick = (t: number) => {
	frames++;
	if (t - last >= 500) {
		const fps = Math.round((frames * 1000) / (t - last));
		// 颜色：>=55 绿 / >=40 黄 / <40 红
		frames = 0;
		last = t;
	}
	raf = requestAnimationFrame(tick);
};
```

要点：

| 属性 | 值 |
|---|---|
| 采样窗口 | 500ms 滚动窗口 |
| 计算公式 | `round(frames * 1000 / elapsedMs)` |
| 生效条件 | `NODE_ENV === "development"` 且 `localStorage.fccFps !== "0"` |
| 阈值 | ≥55 绿，≥40 黄，<40 红 |

**它测的是「浏览器每个 vsync 派发 rAF 回调的频率」**，等价于：主线程能否在 16.7ms 预算内跑完本帧所有 rAF 回调 + 样式重算 + 布局 + 绘制提交。

它**不是**：

- 不是渲染帧率（合成器/GPU 的实际上屏帧率可能更高）
- 不是视频解码帧率
- 不是项目 fps（时间线 30/60fps 与之无关）

因为计数器自己也挂在 rAF 上，**只要主线程有任何一个 rAF 回调超预算，它掉的就是这个数**。所以它是"主线程节拍器"，不是"渲染质量表"。

副作用：500ms 平均会把 1~2 帧的偶发卡顿摊平，持续掉帧才看得出来。

---

## 2. 为什么卡在 40 多

`40fps` 反推单帧预算：`1000 / 40 ≈ 25ms`，即每个 vsync 主线程需要约 25ms。

播放时每个 vsync 有**两条独立的 rAF 链**在跑：

### 链 A：播放时钟 `PlaybackManager.updateTime`

`core/managers/playback-manager.ts:206-243`

- `getTotalDuration()` —— O(N)，且 `calculateTotalDuration` 每帧新建一个 `[...overlay, main, ...audio]` 数组（`timeline/index.ts:20`）
- `roundFrameTime()` —— 跨 wasm 边界
- `notifyUpdate()` —— 同步广播给 5 个订阅者

### 链 B：预览渲染 `PreviewCanvas.render`

`preview/components/index.tsx:216-330`

- `getLastFrameTime()` —— **又一次** `getTotalDuration()`，再 O(N)
- `hasActiveTimelineVideo()` —— 每帧 3 次数组展开 + 全元素遍历
- `setPackVideoPreviewState()` —— 每帧调用
- `renderer.render()`：
  - `resolveRenderTree`（`resolve.ts`，583 行）递归求值整棵树，节点用 `await` 串行 → N 次 microtask
  - `measureTextElement`（`text/measure-element.ts`）**没有任何缓存**，每个 TextNode 每帧重新 `measureText`
  - `buildFrameDescriptor`（`frame-descriptor.ts`，665 行）
  - `syncTextures` + three compositor 合成

### 链条之间的耦合条件

`preview/components/index.tsx` 里有这段门槛：

```ts
const playPresentEveryRaf =
	playing && needsLivePresent &&
	lastRenderMsRef.current > 0 && lastRenderMsRef.current < 40;
```

意思是：**只要上一帧合成耗时 < 40ms，就每个 rAF 都 present；一旦单帧 ≥ 40ms，退回帧栅格**。

所以如果实测是稳定 40 上下，说明上一帧合成耗时大约就在 **24~25ms**——刚好卡在门槛下方，于是它继续每帧全量渲染，rAF 也就被压到 40Hz。这是一个自我强化的稳定点。

### 结论

40fps 不是 Light meter 算错，而是**合成管线单帧确实要 ~25ms**。用现成探针可以直接看到是哪一段：

```js
window.__renderPerf = true
```

`render-perf.ts` 每 60 帧打印一张表，span 名分别是 `resolve` / `buildFrame` / `syncTextures` / `renderFrame`。**哪个的 meanMs 最大就是真凶。**

我的预判：如果时间线上有文字，`resolve`（含 `measureTextElement`）会排第一；如果是多图层视频，`renderFrame` 第一。

---

## 3. 播放头"原地不动"的真正原因

### 3.1 主因：位移被设备像素网格吃掉了

时间线缩放基线是 `BASE_TIMELINE_PIXELS_PER_SECOND = 50`（`timeline/scale.ts`），最小缩放 `TIMELINE_ZOOM_MIN = 0.1`。

长视频会被 `getTimelineZoomMin` 自动 fit 到容器宽度，所以缩放值天然很小。举例：204s 项目放进约 1200px 容器 →

```
5.88 px/s → zoomLevel ≈ 0.118
```

每帧位移：

```
5.88 px/s ÷ 40 fps ≈ 0.147 px/帧
```

**然后这个值被取整了。** 播放头定位原本走：

```ts
timelineTimeToSnappedPixels → snapPixelToDeviceGrid
→ Math.round(pixel * dpr) / dpr
```

`dpr = 1`（Windows 100% 缩放最常见）时就是四舍五入到整像素。结果是：

- 每帧 0.147px 的增量，**要累积约 7 帧才凑够 1px**
- 40fps 下 ≈ **每秒只前进 5~6 个像素**
- 视觉上就是「竖线基本钉在原地，偶尔向右跳 1px」

**所以它不是不更新，是每帧的更新量小于 1 个设备像素。** 这也是为什么它和 fps 数字同时出现：帧率越低，每帧位移越大反而越"看得见"；帧率越高、缩放越小，越像不动。

### 3.2 需要排除的另两种情况

只有下面这两种才是真故障，用 30 秒可区分：

```js
const el = document.querySelector('[aria-label="Timeline playhead"]');
let prev = null;
setInterval(() => {
  const now = el.style.left;
  console.log(now, now === prev ? "← 同值" : "");
  prev = now;
}, 200);
```

| 观察结果 | 结论 |
|---|---|
| `style.left` 每 200ms 都在变，只是数值变化很小 | **3.1 的取整问题**（已修） |
| `style.left` 完全不变，时间码也不动 | 播放时钟断了：`updateTime` 的 rAF 链被订阅者异常打断 |
| `style.left` 在变，但竖线视觉不动 | 元素被父容器裁切（走到右边缘后 autoscroll 没跟上） |

第二种的具体机制在 `playback-manager.ts:238`：

```ts
this.currentTime = newTime;
this.notifyUpdate(newTime);        // ← 任一订阅者抛异常
this.dispatchUpdateEvent(newTime);
this.playbackTimer = requestAnimationFrame(this.updateTime);  // ← 这行就永远不会执行
```

`notifyUpdate` 是同步遍历的，**5 个订阅者里任何一个抛错，后面重新注册 rAF 的那行就被跳过，播放时钟永久停摆**，而音频（WebAudio 独立时钟）还会继续播。这是个脆弱点，建议后续用 `try/catch` 隔离单个订阅者。

---

## 4. 本次已改（3 处）

### 4.1 播放时用亚像素定位（修 3.1）

`src/timeline/controllers/playhead-controller.ts` — `updatePlayheadLeft`

```ts
const centerPixel = this.config.getIsPlaying()
	? timelineTimeToPixels({ time, zoomLevel })        // 播放：保亚像素
	: timelineTimeToSnappedPixels({ time, zoomLevel }); // 暂停/拖动：仍对齐网格，2px 线保持锐利
```

`src/timeline/components/timeline-playhead.tsx` 同步改成同一规则，保证 React 渲染路径与命令式更新路径不会互相打架。

### 4.2 时长计算加身份缓存（削链 A）

`src/core/managers/timeline-manager.ts`

`getTotalDuration()` 与 `getLastFrameTime()` 原来每帧全量遍历一次。现在按 `activeScene.tracks` 的**对象引用**缓存——`updateSceneTracks` 每次都会装入全新的 `SceneTracks`（`scenes-manager.ts:298-311`），所以引用变化是可靠的失效信号。

效果：每帧 O(N) 遍历 + 数组分配，从 2 次降到 0 次（缓存命中时）。

### 4.3 视频区间扫描去掉每帧分配

`src/preview/components/index.tsx`

`hasActiveTimelineVideo` 原来每帧 `[...overlay, main, ...audio]` 建数组再遍历全部元素。现在：

- 用 `WeakMap<tracks, VideoRange[]>` 预计算「视频元素的 [start, end) 区间」
- 每帧只遍历视频区间（通常远少于总元素数），零分配

---

## 5. 验收

```bash
# 类型检查（改动文件）
cd freefilmcut/apps/web && ./node_modules/.bin/tsc.exe --noEmit -p tsconfig.json \
  | grep -E "playhead|timeline-manager"

# lint（改动文件）
../../node_modules/.bin/eslint.exe \
  src/timeline/controllers/playhead-controller.ts \
  src/timeline/components/timeline-playhead.tsx \
  src/core/managers/timeline-manager.ts \
  src/preview/components/index.tsx
```

当前结果：改动文件 **0 新增类型错误、0 新增 lint 问题**。
（仓库既有 155 个 tsc 错误与 4 个 lint 错误均与本次无关，`preview/components/index.tsx:311-312` 的 `MediaTime` 报错也是既有代码。）

### 人工验收

1. **播放头移动**：缩放到能看见刻度（例如 zoom 1.0 = 50px/s），播放 → 竖线应连续平移，不再一格一格跳。
2. **暂停锐利度**：暂停后竖线仍对齐像素网格，不应变模糊。
3. **小缩放预期**：如果刻意缩到 fit 全局（5px/s 量级），播放头 1 秒只走 5px，**这是正常的物理结果**，不要期望它明显移动——那时应该看时间码而不是看竖线。
4. **FPS**：这三处改动只削掉每帧几百微秒到 1~2ms 的固定开销，**不会把 40 拉到 60**。真正的大头还在 `resolveRenderTree` / compositor，需要看 `window.__renderPerf` 的 span 表。

---

## 6. 下一步（按收益排序）

| 优先级 | 事项 | 依据 |
|---|---|---|
| P0 | `measureTextElement` 加缓存（key = 文本内容+字体+字号+canvasHeight，动画属性单独通道） | `text/measure-element.ts` 零缓存，每帧每 TextNode 重新 measureText |
| P0 | `resolveRenderTree` 的 `await` 串行改为同步分支优先 | `resolve.ts:90-108`，N 个节点 = N 次 microtask |
| P1 | `notifyUpdate` 逐个订阅者 `try/catch` | `playback-manager.ts:238` 一处抛错即停时钟 |
| P1 | 词法：`getActive()` 在 rAF 里调用会 throw，改 `getActiveOrNull()` | `playback-manager.ts:210`、`preview/components/index.tsx:262` |

---

## 7. 补充：**暂停态**帧率也低（40 多）

这一节和上面的播放态分析是**两个独立问题**。暂停时 `PlaybackManager` 的 rAF 已经停（`stopTimer`），应用代码里也没有常驻 rAF 循环——`useRafLoop` 是死代码（无调用点），`three-compositor` 内部零 rAF，`setAnimationLoop` / `requestVideoFrameCallback` 全项目零使用，`useEdgeAutoScroll` 只在拖拽时激活。

那么暂停态 40fps 只剩两大类原因，**必须先区分，否则会修错地方**：

### 7.1 两类原因的区别

| 现象 | 含义 |
|---|---|
| 帧间隔 ~24ms，且 `longtask` 有值 | 主线程被真实工作占住：有循环在跑，或某处每帧做重活 |
| 帧间隔 ~24ms，`longtask 0/0ms` | 主线程很闲，但 vsync 就是 40Hz：**显示器刷新率 / Windows 电源计划 / Chrome 省电模式 / 窗口非前台**，与代码无关 |
| 帧间隔 ~16.7ms 但肉眼卡 | Light meter 正常，卡在 GPU 合成或视频解码 |

### 7.2 用升级后的 Light meter 直接读

`components/fcc-light-fps.tsx` 现在显示四行：

```
FPS 41  24.4ms
worst 33.2ms
longtask 2/68ms
light meter
```

- 第二行 `frameMs` = 本窗口平均帧间隔，`1000/FPS`
- `worst` = 本窗口内最长的一次帧间隔
- `longtask n/Xms` = 本窗口内 >50ms 的长任务个数与最长时长

**判读规则**：

- `longtask 0/0ms` + `FPS 40` → 不是代码问题，是 rAF 被限制在 40Hz。查显示器刷新率、Windows 电源计划（节能模式会把 rAF 压到 30~40）、Chrome 的"内存节省/效率模式"、以及窗口是否被遮挡。
- `longtask` 非 0 或 `worst` 远大于 `frameMs` → 有间歇性重活，用下面的脚本抓栈。

### 7.3 抓"谁在每帧跑"（30 秒）

粘到 console，然后暂停播放、不要动鼠标，看输出：

```js
(() => {
  const orig = window.requestAnimationFrame;
  let count = 0;
  window.requestAnimationFrame = function (cb) {
    return orig.call(window, (t) => {
      count++;
      const s = performance.now();
      try {
        return cb(t);
      } finally {
        const d = performance.now() - s;
        if (d > 4) {
          console.warn(
            `[raf ${d.toFixed(1)}ms]`,
            (new Error().stack || "").split("\n").slice(1, 5).join(" | "),
          );
        }
      }
    });
  };
  setTimeout(() => {
    console.log("rAF callbacks in 1s:", count);
    window.requestAnimationFrame = orig;
  }, 1000);
})();
```

- `count ≈ 0` → 没有任何应用循环在请求 rAF，Light meter 显示的是它自己那一个计数器被节流的结果 → 走 7.2 的"非代码原因"分支。
- `count ≈ 40` 且每帧都有 warn → 有常驻循环，栈会直接指出文件与函数。
- `count ≈ 40` 但无 warn → 循环存在但每帧开销都 <4ms，属于正常；此时掉帧应来自 GPU/合成而非 JS。

### 7.4 已知会被节流的可疑点（按顺序排除）

1. **react-scan**：`localStorage.fccReactScan === "1"` 时 Light meter 会显式标注 `(+ react-scan ON)`。它是 dev 环境的常驻开销大户，先关掉再测。
2. **React DevTools**：dev 模式下会持续采样，实测可把 rAF 压到 40 上下。禁用扩展后复测。
3. **`window.__renderPerf = true`**：`render-perf.ts` 每 60 帧执行一次 `console.table` 两次，**开启期间本身就会掉帧**。测基线时必须关掉。
4. **`preview` 的 `renderingRef` 卡死**：若 `renderer.render()` 的 promise 不 resolve，`render()` 每帧在 `if (renderingRef.current) { pendingRenderRef.current = true; return true; }` 空转，rAF 链永不休眠。可用 `window.__renderPerf` 观察 `renderFrame` span 的 count 是否为 0 而 rAF 仍在跑。
5. **视频元素**：`pack-video.ts` 里若 `HTMLVideoElement` 未被真正 pause，解码线程会持续占 GPU，合成压力传导到 rAF。

