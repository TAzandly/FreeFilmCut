# 按空格起播瞬间降帧 —— 110ms 长任务定位

日期：2026-10-27
读数来源：light meter 截图（`FPS 48 / 20.8ms`，`vsync 16.5ms / drops 20%`，`1x 41 2x 5 3x 1 6x 1 max 100ms`，`longtask 2/110ms`）

## 一、先把读数拆开：这不是"整体慢"

| 项 | 值 | 说明 |
|---|---|---|
| 窗口内渲染帧 | 48 | 41+5+1+1 |
| 1x（16.5ms，正常） | 41 | 占 85%，**合成平均是够快的** |
| 2x（≈33ms） | 5 | 各丢 1 帧 |
| 3x（≈50ms） | 1 | 丢 2 帧 |
| 6x（≈100ms） | 1 | 丢 **5 帧** |
| 丢失帧位合计 | 12 | 5×1 + 1×2 + 1×5 |
| 丢失率 | 12/60 = **20%** | 与 `drops 20%` 完全对应 |

时间自检：41×16.5 + 5×33 + 1×50 + 1×100 ≈ 991ms，正好 1 秒窗口。

**结论：20% 里的 42% 来自那一次 100ms，加上那次 50ms 就是 58%。** 剩下 5 次 33ms 是次要项。

如果只干掉那一次 100ms，FPS 会从 48 回到 ~53；全部干掉才是 60。

`longtask 2/110ms` 进一步锁定：**整个窗口只有 2 个长任务，最长 110ms**。这与"起播瞬间一次性开销"完全吻合，而不是逐帧渲染太重（那种情况会表现为大量 33~50ms 的 gap，longtask 数量会远多于 2）。

## 二、110ms 落在哪个环节：五个候选，按可能性排序

按空格到出现画面，主线程要经过这些同步段。代码里已核实的事实：

### 候选 1：首次 shader 编译（可能性最高）

`three-compositor.ts` **全文没有一处 `renderer.compile()` 预热**（已 grep 确认）。three.js 是在**第一次真正 draw 某个材质签名**时才编 GLSL 并 link program，这一步在主线程同步完成，典型 50~150ms。

- 触发时机完全对得上：播放头从 2s 走进 3s，pack clip 第一次进入可见范围并被真正绘制
- 一次性，不是每帧
- 之前暂停时该 clip 没被 draw（预览是 frame-gated 跳过的），所以"第一次"就发生在起播后进区间那一刻

### 候选 2：`texImage2D` 首次上传大视频帧

`pack-video.ts` 的 blit 把 `<video>` 当纹理源上传到 RT。首次上传一帧 4K = 3840×2160×4 ≈ **33MB**，从视频元素到 GPU 纹理的拷贝在主线程同步执行，几十 ms 很正常。

判别方法：`__fccPackVideo()` 里看 `res`（源分辨率）与 `rtRes`（RT 尺寸）。RT 远大于画布 = 纯填充率浪费。

### 候选 3：`playback.play()` 的监听器扇出 + React 提交

`playback-manager.ts:54-56` → `notify()` 同步遍历所有 listener，会唤醒 preview、audio、以及 9 个 store 的订阅。若时间线**没有虚拟化**（此前评审的 P0 之一），一次 commit 就可能几十毫秒。

### 候选 4：音频起播

`audio-manager.ts:234` 首次 `audioContext.resume()` 会启动音频线程；紧接着 `collectAudioClips` 遍历所有轨道。二者都在 `startPlayback` 的同步头部。

### 候选 5：RT / MSAA 重建

`ensureMsaaTarget` 在尺寸或采样数变化时重建渲染目标。如果起播那一刻预览尺寸刚被 `ensureInitialized` 重设，会有一次 VRAM 分配。

## 三、怎么一次测准：`__fccPlayTrace()`

已加的打点（全部 dev-only，生产零开销）：

| 阶段 | 埋点位置 | 含义 |
|---|---|---|
| `play:call` | `playback-manager.ts` `play()` 的 notify 前后 | 监听器扇出 + React 提交 |
| `audio:resume` | `audio-manager.ts` resume + collectAudioClips | 音频起播 |
| `compose:sync` | `preview/components/index.tsx` 调 `render()` 到返回 promise | **合成的同步头部**（shader 编译 / 纹理上传 / RT 分配都在这） |
| `compose` | 同上到 `.then()` | 整个合成，含异步尾部 |

用法：

```js
await __fccPlayTrace({ ms: 6000 })   // 执行后立刻按空格
```

输出会把每个长任务归属到具体阶段，并给出结论，例如：

```
task  startMs  durMs  phase
1     1820     110.2  compose:sync
2     2410     52.0   outside-js
```

判读表：

| `phase` | 含义 | 对应修法 |
|---|---|---|
| `compose:sync` | shader 首次编译 / 纹理上传 / RT 分配 | 起播前预热：`renderer.compile(scene, camera)` 或离屏渲一帧 |
| `compose` | 异步尾部，逐节点 `await` 串行 | `resolveRenderTree` 去串行化 |
| `audio:resume` | 音频线程启动 / 收集 clip | 提前 resume、clip 结果缓存 |
| `play:call` | 监听器扇出 / React commit | 时间线虚拟化、`notify` 分批 |
| `outside-js` | layout / paint / GC | 减少 DOM 写入、避免每帧新建材质 |

悬浮层也加了实时读数（每秒刷新）：

```
compose sync 108ms  total 121ms
```

`sync` 高 = 候选 1/2；`sync` 低但 `total` 高 = 候选 3 的异步尾部。

## 四、如果确认是候选 1（shader 预热）

最小改动是在预览首帧之前预编译：

```ts
// 预览初始化完成、第一次真实播放前
renderer.compile(scene, camera);   // 同步编译，但发生在空闲期
```

更好的做法是把 pack 的材质在 `preparePackVideos` 阶段就构好并编译一次，让起播那一下只是换纹理。

## 五、附带发现

- `three-compositor.ts:344` `preserveDrawingBuffer: true`：每帧多一次 ≈8MB 的读回，属于稳态开销（进 20.8ms 的平均值），不是这次尖峰的元凶。
- `three-compositor.ts:2981` 每层每帧 `new THREE.MeshBasicMaterial`：program 有缓存不会重复编译，但材质对象每帧新建会制造 GC 压力，长播时可能表现为零星的 33ms gap（正好对上 `2x 5`）。

---

> 本文的读数拆解基于截图数值推算，环节归属为静态代码分析 + 待实测验证。最终结论以 `__fccPlayTrace()` 输出为准。
