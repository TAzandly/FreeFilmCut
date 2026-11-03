# 性能面板开关 + 拖动播放头掉帧排查（2026-10-27）

## 一、设置里加了「Developer」标签页

原来 FPS 面板只有两种控制方式：改 `localStorage.fccFps` 再刷新，或者干脆没法关。现在有 UI 开关了。

路径：**设置面板 → Developer**

| 开关 | 作用 | 默认 |
|---|---|---|
| Performance overlay | 左下角性能条（FPS / vsync / drops / 直方图 / compose / video） | 开发环境 **开**，生产环境 **关** |
| Compose profiler | 每 60 帧往控制台打 `resolve / buildFrame / syncTextures / renderFrame` 分阶段耗时 | 关（仅 dev 可见） |

要点：

- **即时生效，不用刷新**。关掉时 `cancelAnimationFrame` + `observer.disconnect()` + 移除 DOM 节点，采样循环整个停掉，不是只用 CSS 藏起来。
- **只存本机**，不进项目文件。`localStorage["fccDiag"] = {"perfOverlay":true,"renderProfiler":false}`。项目设置是给人共享的，诊断开关不是，所以单独一个 tab。
- **旧键兼容**：首次读取时若没有 `fccDiag` 但存在 `fccFps === "0"`，沿用该选择并写进新键，之后不再读旧键。
- Compose profiler 与 `window.__renderPerf` 是同一个开关，控制台手动赋值仍然有效（只在当前页面生命周期内）。

### 改动文件

| 文件 | 变更 |
|---|---|
| `src/diagnostics/diag-settings.ts` | 新增。本地开关存储 + `useSyncExternalStore` 订阅 + `__renderPerf` 镜像 |
| `src/components/editor/panels/assets/views/settings/developer.tsx` | 新增。两个开关的 UI |
| `src/components/editor/panels/assets/views/settings/index.tsx` | 加 `developer` 视图与 tab |
| `src/components/fcc-light-fps.tsx` | 去掉写死的 dev 判断与 `fccFps` 读取，改为订阅开关；`__fccPlayTrace` 拆成独立 effect（关掉面板后探针仍在） |
| `src/app/layout.tsx` | 更新注释，指向新入口 |

实现细节：`getSnapshot` 直接返回存储对象本身，只有真正改动才换引用，所以 `useSyncExternalStore` 不会每帧触发重渲染；`localStorage` 读写全部 try/catch（隐私模式 / 配额满时开关仍在本页生效）。

---

## 二、拖动播放头为什么"有时候"掉帧特别厉害

### 静态分析找到的一处确定性浪费

`PlayheadController.scrub()` 每个 pointer 帧都在**重建全部吸附点**：

```ts
const snapPoints = buildTimelineSnapPoints({
  sources: [
    () => getElementEdgeSnapPoints({ tracks }),                    // 遍历所有轨道所有元素
    () => getBookmarkSnapPoints({ bookmarks }),
    () => getAnimationKeyframeSnapPointsForTimeline({ tracks }),   // 每个关键帧 new 一个对象
  ],
});
```

`build.ts` 里没有任何缓存，`animation-snap-points.ts` 是 `for track → for element → for keyframe → push({...})`。

于是**每次鼠标移动**（经 rAF 合并后约 60 次/秒）都重新分配一遍与项目内容成正比的临时对象。这解释了两件事：

1. **为什么是"有时候"** —— 成本跟着项目内容走，不跟拖动速度走。关键帧和元素越多越重，空白工程完全无感。
2. **为什么是"突然"** —— 大量短命对象制造 GC 压力，表现是间歇性停顿，而不是稳定的低帧率。

**已修**：吸附点在整个拖拽会话内缓存一次，`deactivate()`（mouseup / destroy）时释放。播放头拖拽不可能改变场景，所以一个手势内这个集合是常量；两次拖拽之间用户可能编辑，因此必须在会话结束时失效，不能跨会话复用。

### 剩下的天花板仍在 compose

上一轮实测 `compose total 24ms`，超出 16.5ms 预算 45%。拖动时每一帧都要重新合成（帧号变了），所以拖动本身的上限就是约 40fps，叠加吸附构建和 React 通知后落到 30fps 上下。**吸附缓存去掉的是其中随内容增长的那部分，不会把 24ms 变没。**

### 怎么确认是哪一块

这次把耗时计量接到了已有的交互探针上（`src/diagnostics/interaction-perf.ts`），新增 `measureInteraction` / `recordInteractionDuration`，输出多了两列：

```js
window.__interactionPerf = true    // 然后拖播放头，每秒打印一次
```

```
pipeline           moves/s  work/s  perMove  meanMs  maxMs  total work
timeline.playhead      120      58    0.483    0.85   12.4         174
```

判读：

| 读数 | 含义 |
|---|---|
| `meanMs` < 1ms | 吸附已不是问题，剩下的是 compose |
| `meanMs` 与 `maxMs` 差距大（如 0.9 vs 12） | 间歇性长帧 → GC 或偶发 seek，看 `__fccPackVideo()` 的 `seeks` 是否也在涨 |
| `meanMs` 稳定 5ms+ | 场景内容真的重，需要进一步拆（关键帧总量 / 元素总数） |

配合已有的两个探针一起看：

```js
window.__renderPerf = true                        // 或用设置里的 Compose profiler 开关
await __fccPackVideoWatch({ ms: 6000 })           // 拖动时执行，看 skipSeekingPerSec
```

### 尚未处理的两项（需要数据再决定）

1. **`seek()` 每帧同步 `notify()`**：`useEditor(selector)` 订阅了 playback，拖动时每个订阅组件每帧重跑一次 selector。数量级小但随元素数增长，改它要动 playhead 的下游同步，风险高于收益，先观测。
2. **`pixelToTime` 每帧 `getBoundingClientRect()`**：上一帧写过 `playhead.style.left`，这一帧再读 rect 会触发强制布局。约 0.1~0.5ms，非主因。

---

## 三、校验

- 全仓 tsc 错误数 **195**（与改动前一致），本次涉及文件 `0` 个新增错误。
- 新增 / 修改文件的 eslint：`diag-settings.ts`、`fcc-light-fps.tsx`、`developer.tsx`、`settings/index.tsx`、`interaction-perf.ts` 全部干净；`playhead-controller.ts` 仅 1 个既有错误（`event.target as Node`，原第 148 行，本次未触碰）。
- 未做运行时验证，UI 效果与拖拽改善幅度以实测为准。
