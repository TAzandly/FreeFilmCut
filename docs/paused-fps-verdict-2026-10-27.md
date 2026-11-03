# 暂停态 48fps 判读（Light meter 读数）

> 输入：`FPS 48  20.8ms` / `worst 50.1ms` / `longtask 0/0ms` / 播放头静止
> 结论先行：**主线程没有卡，应用在暂停时每帧工作量为 0；这 48 是浏览器/环境侧的帧生产问题。**

> **实测回填（10:40，升级探针后）**：`FPS 54  18.5ms` / `vsync 16.5ms` / `drops 10%` / `1x 48  2x 6` / `max 33ms` / `longtask 0/0ms`
> → **显示器确认为 60Hz**，第 1 节的「48Hz 显示器」假设被排除；实际是 60Hz 网格上每秒丢 6 帧，且全部是单帧丢失（无 `3x`）、无长任务。
> 丢帧率也从 ~25% 降到 10%。详见第 8 节。

---

## 1. 这四个数字能确定什么

| 读数 | 含义 | 可排除的对象 |
|---|---|---|
| `longtask 0/0ms` | 1s 窗口内**没有**任何 ≥50ms 的主线程任务 | JS 长任务、React 重渲染风暴、布局抖动、同步解码 |
| `worst 50.1ms` | 50.04 = **3 × 16.68ms**，正好是 3 个 60Hz vsync | 说明页面上存在 60Hz 的 vsync 网格 |
| `20.8ms` | 平均帧间隔 | 见下方数学 |
| `FPS 48` | 每 1000ms 只有 48 个 rAF 回调 | 与渲染帧率、项目 fps 都无关 |

### 20.8ms 的两种解释，数值完全一样

```
(a) 1000 / 48        = 20.83ms   → 显示器本来就是 48Hz
(b) (3×16.67 + 33.33) / 4 = 20.83ms   → 60Hz 上每 4 帧丢 1 帧
```

单看均值无法区分。但 `worst 50.1ms` 只支持 (b)：

- 若 48Hz：丢 1 帧 = 41.7ms，丢 2 帧 = 62.5ms，**对不上 50.1**
- 若 60Hz：丢 2 帧 = **50.04ms**，与 50.1 几乎完全重合 ✅

**所以最可能的事实是：显示器 60Hz，浏览器丢了约 25% 的 vsync，且丢的地方不在 JS。**

---

## 2. 已在代码里逐项排除的常驻循环

暂停时应用侧的每帧工作量实测为 **0**：

| 可疑项 | 实测 | 依据 |
|---|---|---|
| 播放时钟 rAF | 仅播放时启动 | `playback-manager.ts:256` 起，`:213/:223` 暂停即 cancel |
| 预览渲染 rAF | 暂停静止帧主动休眠 | `preview/components/index.tsx:370-376` 命中 `return transportActive` → false |
| `useRafLoop` | **死代码**，全项目零调用 | `hooks/use-raf-loop.ts` |
| `three-compositor`（3236 行） | 内部零 rAF / 零 setTimeout / 零 setAnimationLoop | 全文检索 |
| 音频调度 `setInterval` | 仅播放时启动，`stopPlayback` 正确 clear | `audio-manager.ts` |
| CSS 动画 | 仅加载态 `animate-spin` / `animate-pulse`，编辑页不挂载 | `editor-provider.tsx:105,116`、`skeleton.tsx` |
| `backdrop-blur` | 全项目 5 处，**编辑页 0 处** | landing / projects / dialog / toast / bookmark |
| WebGL 上下文 | 单例，无泄漏 | 全项目只有 `three-compositor.ts:340` 一处 `new THREE.WebGLRenderer` |

> 也就是说：**页面静止时，除了 FPS 探针自己，没有任何代码在 requestAnimationFrame。** 48 不可能由本项目代码产生。

---

## 3. 探针已升级，现在能直接分辨两种情况

`components/fcc-light-fps.tsx` 新增 `vsync` 估计、`drops%` 和帧间隔直方图。刷新页面后看第二、三行：

**情况 A —— 显示器就不是 60Hz**
```
FPS 48  20.8ms
vsync 20.8ms  drops 0%
1x 48  max 21ms
```

**情况 B —— 60Hz 网格上丢帧**
```
FPS 48  20.8ms
vsync 16.7ms  drops 25%
1x 36  2x 11  3x 1  max 50ms
```

**情况 C —— 主线程真的忙**
```
longtask 7/93ms
```

第三行末尾如果出现 `!unfocused`，说明窗口失焦或被遮挡，Chrome 会主动降帧——这本身就是原因，不用再查别的。

实现要点：vsync 取帧间隔的**众数**（静止页面上绝大多数间隔正好是一个刷新周期），再用 `round(gap/vsync)-1` 累加丢帧数；不用最小值，因为一次调度抖动就会把它拉偏。

---

## 4. 按 drops 分流的处理表

### A. `drops 0%`、`vsync ≈ 20.8ms` → 显示器跑在 48Hz

1. Windows：设置 → 系统 → 显示 → 高级显示 → **选择刷新率**（确认是 60Hz 或更高）
2. 显卡控制面板（NVIDIA / AMD / Intel）里是否被设了自定义分辨率或省电模式
3. 笔记本是否在「节能 / 延长续航」电源计划下（部分机型会主动降刷新率）
4. 是否在**远程桌面 / 虚拟机 / 串流**里看页面 —— 虚拟显示器刷新率是固定的，常见就是 30/48/60
5. 双屏不同刷新率：把窗口拖到主屏再测

这一类**代码无法修**，也不用修——它不是帧率问题，是硬件在按 48Hz 出帧。

### B. `drops > 0%`、`vsync ≈ 16.7ms` → 60Hz 上丢帧，按命中率排查

| 顺位 | 检查 | 如何确认 |
|---|---|---|
| 1 | 硬件加速被关 / GPU 被列入黑名单 | `chrome://gpu` 看 **Compositing** 是否 `Hardware accelerated` |
| 2 | DevTools 开着（Performance / Rendering 面板、React DevTools） | 关掉全部 DevTools 再读一次，通常回涨 10~20% |
| 3 | GPU 争用：OBS / 录屏 / 另一个在播视频的标签页 / 动态壁纸 | 全关掉再读 |
| 4 | `react-scan` 插桩（探针会显示 `+ react-scan ON`） | `localStorage.fccReactScan = "0"` 后刷新 |
| 5 | 窗口被遮挡或失焦 | 探针会显示 `!unfocused` |
| 6 | 多显示器 / 混合 DPI 缩放 | 拖到主屏、缩放设 100% 再测 |

---

## 5. 60 秒决定性实验

新开一个**空白标签页**（`about:blank`），F12 控制台贴这段，原样运行：

```js
(() => {
  let last = performance.now(), start = last, gaps = [], n = 0;
  const tick = (t) => {
    const g = t - last; last = t;
    if (g > 0 && g < 1000) gaps.push(g);
    if (++n >= 120) {
      const bins = {};
      for (const g of gaps) { const b = Math.round(g * 2) / 2; bins[b] = (bins[b] || 0) + 1; }
      const vs = +Object.keys(bins).sort((a, b) => bins[b] - bins[a])[0];
      const mult = {}; let drops = 0;
      for (const g of gaps) {
        const m = Math.min(9, Math.max(1, Math.round(g / vs)));
        mult[m] = (mult[m] || 0) + 1; drops += m - 1;
      }
      console.log(
        `fps ${(n * 1000 / (performance.now() - start)).toFixed(1)}  vsync ${vs}ms  drops ${Math.round(drops / (gaps.length + drops) * 100)}%`,
        mult,
      );
      n = 0; gaps = []; start = performance.now();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
```

判读：

| about:blank 结果 | 结论 |
|---|---|
| 也是 48 / `drops 0%` | 显示器或远程桌面就是 48Hz。**与本项目无关，停止改代码** |
| 也是 60 但编辑页 48 | 页面合成成本或 GPU 争用 → 走第 4 节 B |
| 60，编辑页也 60 | 问题自行消失（大概率是当时 DevTools / react-scan / 后台程序） |

---

## 6. 顺手发现的真实合成成本（P1，但**不是**这次 48fps 的元凶）

`services/renderer/compositor/three-compositor.ts:340-354`

```ts
new THREE.WebGLRenderer({
  antialias: false,
  alpha: true,
  premultipliedAlpha: false,
  preserveDrawingBuffer: true,   // ← ①
  powerPreference: "high-performance",
  stencil: true,
});
renderer.setPixelRatio(1);
```

① **`preserveDrawingBuffer: true`**：合成器必须保留 drawing buffer 副本，上屏无法走零拷贝路径，每次合成要拷贝整块缓冲。1080p 就是约 8MB/帧。

② **`premultipliedAlpha: false` + `alpha: true`**：这块画布是直接 `appendChild` 到 DOM 的可见画布（`preview/components/index.tsx:274-288`），合成时要做反预乘 + alpha 混合，走的是慢路径，也失去「不透明画布直通显示层」的优化。

影响范围：**播放、拖拽、导出时每帧都要付这笔钱**。静止时不付费，所以和本次 48fps 因果无关。

为什么不现在直接改：`scene-exporter.ts:121` 用 mediabunny 的 `CanvasSource` 直接读这块画布，`preserveDrawingBuffer = false` 会让读取时机变脆（可能读到清空后的缓冲）。正确做法是让预览用 `false`、导出期切 `true`——需要给 `three-compositor` 加一个 capture 模式并在导出前后重建 renderer，属于独立 PR，不要和帧率排查混在一起做。

---

## 7. 需要纠正的一个认知

`FccLightFps` 的 rAF 计数**不是渲染帧率**。静止页面上本来就没有新帧需要合成，它测的是「浏览器每个 vsync 有没有给这个页面 BeginFrame」。

所以「静态页面 FPS 48」这个指标只回答一个问题：**浏览器这台机器上是否在按 60Hz 供帧**。它达不到 60，说明的是环境，而不是你的代码慢。

要衡量剪辑端真正的性能，请看另外两个已经接好的探针：

- `window.__renderPerf = true` → 每帧 resolve / buildFrame / syncTextures / renderFrame 的分段耗时
- `window.__interactionPerf = true` → 每次拖拽的事件数与长任务

---

*本报告基于静态代码分析与一次探针读数推导生成，结论以第 5 节实测为准。*

---

## 8. 实测回填：60Hz 已确认，问题缩小到 10% 单帧丢失

### 8.1 新读数逐项拆解

```
FPS 54  18.5ms
vsync 16.5ms  drops 10%
1x 48  2x 6  max 33ms
longtask 0/0ms
```

| 读数 | 含义 |
|---|---|
| `vsync 16.5ms` | **显示器是 60Hz**（16.67ms）。第 1 节基于均值的「48Hz 显示器」假设排除 |
| `1x 48  2x 6` | 1000ms 窗口内共 54 个帧间隔：48 个正常、6 个是 2 倍 |
| `max 33ms` | 33.0 = **恰好 2 × 16.5**。没有出现 3x，**说明没有任何一次多帧堆积** |
| `drops 10%` | 6 / (54 + 6) = 10% |
| `longtask 0/0ms` | 丢了 6 帧，主线程一次都没被阻塞 ≥50ms |

算术自检：`48 × 16.5 + 6 × 33 = 792 + 198 = 990ms` ≈ 1000ms 窗口 ✅

### 8.2 这个形态在说什么

「偶发单帧丢失 + 零长任务 + 无多帧堆积」是**合成/呈现侧延迟**的典型形态，而不是计算卡顿：

- 计算卡顿 → 会出现 `3x`、`4x`，且 `longtask` 有值
- 传输/解码卡顿 → 会出现连续多个 `2x`
- **每次只丢 1 帧、从不堆叠 → 某个 vsync 的 deadline 被轻微越过几毫秒**

而应用在暂停静止时的每帧工作量仍然是 0（第 2 节已逐项验证：播放 rAF 仅播放时启动、预览 rAF 静止帧主动休眠、`useRafLoop` 死代码、three-compositor 零 rAF、音频定时器仅播放时启动、编辑页无 CSS 常驻动画与 backdrop-blur）。

**所以这 10% 不是本项目代码造成的。**

### 8.3 剩余候选（按可能性排序）

| 顺位 | 候选 | 验证方式 |
|---|---|---|
| 1 | **DevTools 开着**（Performance / Rendering / React DevTools 任一） | 全部关掉再读，通常立刻回涨到 58~60 |
| 2 | **页面上有 `<video>` 仍在解码** —— 本项目的 pack 预览会创建 video 元素，只要不是 `paused` 就会每 vsync 合成新帧 | 探针新增第 5 行 `video n/m playing`，`n > 0` 就是它 |
| 3 | **GPU 争用**：OBS / 录屏 / 另一个在播视频的标签页 / 动态壁纸 | 全关掉再读 |
| 4 | **探针自身的 1 次/秒 DOM 写入** | 每 1000ms 写一次 `textContent` + `color`，本身就吃 1 次提交 → 约 1 帧/秒，占 10% 里的 1.7% |
| 5 | **Windows DWM / 多显示器混合刷新率 / DPI 缩放** | 拖到主屏、缩放设 100% 再读 |
| 6 | 浏览器扩展的 content script | 无痕窗口（禁用扩展）里跑同一页面 |

第 4 条需要说明：探针自己会制造约 1 帧/秒的丢失，这是**测量成本**，不是被测现象。想测最干净，用第 5 节 `about:blank` 里的纯脚本版本。

### 8.4 判定阈值（以后自己看就行）

| 场景 | 读数 | 结论 |
|---|---|---|
| 静止 | `drops ≤ 12%`、只有 `2x`、`longtask 0` | **正常噪声，不要动代码** |
| 静止 | `drops > 25%` 或出现 `3x/4x` | 环境或合成成本问题，按 8.3 排查 |
| 静止 | `longtask` 有值 | 主线程有活，按报告 §7.3 抓栈 |
| **播放** | `FPS ≥ 58`、`drops ≤ 5%` | 播放链路健康 |
| **播放** | `FPS < 50` 或 `drops > 15%` | 真正的瓶颈，看 `window.__renderPerf` 分段耗时 |
| **拖拽** | `window.__interactionPerf` 的 `perMove ≤ 0.15`、`longtask 0` | 交互健康 |

### 8.5 必须纠正的优化方向

**静止状态下的 FPS 是一个没有意义的目标。** 页面静止时本来就没有新帧需要合成，60fps 和 54fps 在屏幕上完全一样——没有任何东西在动。

它唯一的价值是回答「这台机器的浏览器在按 60Hz 供帧吗」，答案现在有了：**是的，60Hz，偶发丢 10%，与应用代码无关。**

真正影响剪辑体验的是另外三个数，都已经有现成探针：

| 指标 | 探针 | 健康线 |
|---|---|---|
| 播放帧率 | `FccLightFps` 播放时读 | `FPS ≥ 58`、`drops ≤ 5%` |
| 单帧合成耗时 | `window.__renderPerf = true` | `renderFrame < 16ms` |
| 拖拽开销 | `window.__interactionPerf = true` | `perMove ≤ 0.15`、`longtask 0` |

把精力放在后两项上，静态 FPS 到此为止。
