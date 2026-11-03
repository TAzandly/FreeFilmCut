# 稳态 32fps 诊断：compose 24ms 超预算 & vsync 估算自欺

日期：2026-10-27
读数：`FPS 32 / 30.8ms`、`vsync 33.5ms / drops 0%`、`1x 33 max 50ms`、`longtask 0/0ms`、`compose sync 0ms total 24ms`

## 一、`drops 0%` 是假的

`vsync 33.5ms` 与之前的 `16.5ms` 是同一块屏、同一台机器。显示器没有变，变的是**页面的节奏**。

原估算器取**gap 的众数**当刷新周期。当每一帧都错过 vsync 时，gap 翻倍变成 33ms，众数随之变成 33ms —— 于是它得出"显示器是 30Hz"并报告 `drops 0%`。

这个读数读起来像"显示器 30Hz，一切正常"，实际含义恰恰相反：**每一帧都超出预算 45%，所以只能落在下一个 vsync 上**。

自检：`frameMs 30.8`、`FPS 32`、直方图全是 `1x`、`longtask 0/0ms` —— 帧间隔**完全均匀**，没有抖动、没有长任务。这不是"随机卡顿"，是**持续超预算导致的降频锁定**。

### 已修：vsync 估算加了一个粘性下限

`fcc-light-fps.tsx` 的 `estimateVsync` 现在取 `min(众数, 最小稳定 bin)`，且下限**只降不升**：

- 真实 60Hz 屏：只要出现过一窗 16.5ms，下限就锁在 16.5，之后即使全程 33ms 也仍然按 16.5 算丢帧 → 会如实显示 `drops 50%`
- 真实 30Hz 屏：从不产生 16.5ms 间隔，下限锁在 33 → 仍显示 `drops 0%`
- 单个调度抖动不会拉低下限（要求该 bin 在一个窗口内至少出现 5 次）

## 二、真正的瓶颈：`compose total 24ms`

| 指标 | 值 | 判断 |
|---|---|---|
| vsync 预算 | 16.5ms | 要跑 60fps，一帧所有工作必须塞进这个窗口 |
| compose 实测 | **24ms** | **超预算 45%** |
| compose sync | 0ms | 同步头部几乎不耗时 |

因为 24ms > 16.5ms，这一帧永远赶不上最近的那个 vsync，只能等下一个 → 稳定 33ms 一帧 → 32fps。

**这是数学上的必然，不是偶发。** 要把帧率拉回 60，必须把 compose 从 24ms 压到 16.5ms 以下，需要减掉约 8ms（31%）。

## 三、`sync 0ms` 排除了什么

`compose:sync` 覆盖 `renderer.render()` 从调用到返回 promise 的那段同步代码。实测 < 0.5ms（四舍五入成 0），这排除了：

- shader 首次编译（在真正 draw 时才发生，但那属于后面 await 内的 `renderFrame`）
- 纹理上传
- RT / MSAA 重建

**24ms 全部在 await 链里。**

## 四、下一步：用仓库里已有的分阶段计时器

`src/diagnostics/render-perf.ts` 早就写好了分阶段计时，只是一直没对预览路径生效 —— `onRenderPerfFrameComplete()` 原本只挂在 `renderToCanvas`（导出/截图路径），所以 `window.__renderPerf = true` 在预览时不输出任何东西，还会让 span map 无上限增长。

**已修**：把调用移到 `canvas-renderer.ts` 的 `render()` 末尾，预览路径现在也会每 60 帧汇总一次。

### 用法

```js
window.__renderPerf = true     // 播放中执行
```

约 1 秒后控制台出现 `[render-perf] summary over 60 frames`，其中 span 表按 `meanMs` 降序，会直接告诉你是谁吃掉这 24ms：

| span | 覆盖范围 | 若它最大，说明 |
|---|---|---|
| `resolve` | `resolveRenderTree` 逐节点遍历 | 节点解析串行 await、`measureTextElement` 无缓存 |
| `buildFrame` | `buildFrameDescriptor` | 帧描述符构造 |
| `syncTextures` | `compositor.syncTextures` | 纹理绑定/重建 |
| `renderFrame` | `compositor.render()` | pack 后处理链、多层 blit、`preserveDrawingBuffer` 每帧读回 |

配套的 counter 表还能看到每帧的纹理上传次数、canvas 分配次数。

关闭：`window.__renderPerf = false`。

## 五、两个独立问题，别混在一起

| | 现象 | 性质 | 状态 |
|---|---|---|---|
| **A. 起播尖峰** | 上一张图：一次性 110ms，`longtask 2/110ms` | 一次性开销 | 本窗口 `longtask 0/0`，本次未复现 |
| **B. 稳态超预算** | 本图：每帧 24ms，稳定 32fps | 持续性成本 | **当前主因** |

A 影响"按下空格那一下"的顿挫，B 影响"全程只能跑 32fps"。**B 更需要先解决**，因为它决定了天花板。

## 六、已知的三个稳态成本（待 `__renderPerf` 确认权重）

1. `three-compositor.ts:344` `preserveDrawingBuffer: true` —— 每帧强制保留绘制缓冲（约 8MB 读回），只为截图/导出服务，预览不需要
2. `three-compositor.ts:2981` 每层每帧 `new THREE.MeshBasicMaterial` —— program 有缓存不重复编译，但每帧新建材质对象制造 GC 压力
3. `resolve.ts` 的 `resolveRenderTree` 逐节点 `await` 串行 + `measureTextElement` 零缓存

按经验，三者的修复收益排序通常是 3 > 1 > 2，但**以 `__renderPerf` 的 meanMs 排行为准**。

---

> 读数修正基于截图数值与代码逻辑推导，环节权重需以 `window.__renderPerf` 实测输出为准。
