# 性能探针使用说明（新手版）

> 两个探针是**浏览器控制台里敲的开关**，不改代码、不改工程文件，刷新页面就失效。
> 一个看「React 为什么重渲染」（`__editorFanout`），一个看「合成器每帧花在哪」（`__renderPerf`）。

---

## 0. 先记住这一条

**开探针 → 只做一次操作 → 立刻 dump → 关探针。**

不要一边开着探针一边看 FPS。探针本身有开销（扇出探针会让每个 selector 多跑一遍），
开着它读出来的帧率一定是偏低的。**测量和观察要分开做。**

---

## 1. 打开控制台

| 系统 | 快捷键 |
|---|---|
| Windows / Linux | `F12` 或 `Ctrl + Shift + I` |
| macOS | `Cmd + Option + I` |

也可以在页面上**右键 → 检查**，然后点顶部的 **Console / 控制台** 标签。

### ⚠️ 第一次粘代码会被拦住

Chrome 会显示一段红字：

```
Warning: Don't paste code into the DevTools Console that you don't understand...
Please type 'allow pasting' below and press Enter
```

这不是报错，是保护机制。在那一行**手动敲** `allow pasting`（英文，注意空格），回车，之后就能粘贴了。

### 确认你在正确的页面上下文

控制台左上角有个下拉框（默认 `top`）。如果不是 `top`，改成 `top` —— 否则 `window` 上找不到这些函数。

---

## 2. 探针 A：`__renderPerf`（看合成器）—— 有 UI 开关，不用敲命令

这是最省事的一个，**有图形开关**：

> **素材面板 → 设置（Settings）→ Developer 标签 → `Compose profiler` 打开**

（开关存在浏览器 localStorage 里，刷新不丢，下次打开还是开的。）

打开后，**每 60 帧自动往控制台打一次报告**，长这样：

```
▸ [render-perf] summary over 60 frames        ← 默认是折叠的，点一下展开
```

展开后是两张表：

**表一：各阶段耗时（按平均耗时降序）**

| span | count | meanMs | p50Ms | p95Ms | maxMs |
|---|---|---|---|---|---|
| renderFrame | 60 | 3.21 | 3.0 | 4.1 | 5.7 |
| resolve | 60 | 0.82 | 0.7 | 1.2 | 2.0 |
| buildFrame | 60 | 0.44 | 0.4 | 0.6 | 1.1 |
| syncTextures | 60 | 0.03 | 0.02 | 0.05 | 0.2 |

**表二：计数器（按每帧次数降序）**

| counter | perFrame | total | frames |
|---|---|---|---|
| texture:upload | 0.02 | 1 | 60 |

**怎么读：** 这张表回答"这一帧的 33ms 里，合成器占了多少"。如果所有 span 的 `meanMs` 加起来只有 4~5ms，
那瓶颈就**不在渲染**，而在 React（去看探针 B）。这也正是当前项目的情况。

> 命令行等价写法（临时看一眼，不写进 localStorage）：
> ```js
> window.__renderPerf = true
> ```
> 关闭：`window.__renderPerf = false`

---

## 3. 探针 B：`__editorFanout`（看 React 重渲染）—— 只能敲命令

这个没有 UI 开关，必须用控制台。**三步，顺序不能错。**

### 第 1 步：开启

```js
window.__editorFanout = true
```

敲完回车，控制台只会回一个 `true`，**没有别的提示** —— 这是正常的，它已经在记数了。

### 第 2 步：去做那一次操作

现在用鼠标做**一件**事，比如：

- 点一下某个 clip
- 拖一下某个参数滑块
- 在画布上拖一下素材

**一次只做一件事。** 连着做三件事，数字就混在一起，没法归因了。

### 第 3 步：打印

```js
window.__editorFanoutDump()
```

输出先是**一行摘要**，然后一张表（按 `selector ms` 降序）：

```
[fanout] 156 mounted subscription(s) · sampled 2.10s · 每次 notify 会唤醒 156 次

┌─────────┬────────────┬───────┬────────┬────────┬─────────┬──────────┬─────────────┬────────────┬───────────┐
│ (index) │ manager    │ wakes │notifies│ per s  │ changed │changed% │ selector ms │ max sel ms │ ms/notify │
├─────────┼────────────┼───────┼────────┼────────┼─────────┼──────────┼─────────────┼────────────┼───────────┤
│ 0       │ 'timeline' │ 6864  │ 44     │ 21.0   │ 430     │ '6.3%'   │ 4.7         │ 0.10       │ 0.001     │
│ 1       │ 'renderer' │ 6708  │ 43     │ 20.5   │ 86      │ '1.3%'   │ 3.1         │ 0.10       │ 0       │
└─────────┴────────────┴───────┴────────┴────────┴─────────┴──────────┴─────────────┴────────────┴───────────┘
```

### 每一列是什么意思

| 列 | 含义 | 一句话理解 |
|---|---|---|
| `manager` | 哪个管理器触发了通知 | `selection` = 选中变化；`timeline` = 时间线数据变化；`playback` = 播放时钟 |
| `wakes` | 有多少个 selector 被叫醒跑了一遍 | "全 App 有多少个订阅者被吵醒" × 通知次数 |
| **`notifies`** | **这个管理器真正通知了几次** | `wakes ÷ 挂载订阅数`。**判断"是否一帧一次"就看它** |
| **`per s`** | 每秒通知几次 | 接近帧率（20~60）= 正常；几百 = 每个鼠标事件都在通知 |
| `changed` | 其中有多少**真的变了**（会导致重渲染） | **最关键的一列**：约等于这次要重画的组件数 |
| `selector ms` | 跑这些 selector 一共花了多少毫秒 | 只是 JS 计算，不含真正画的时间 |
| `max sel ms` | 最慢的那一个 selector | 出现 5ms 以上说明有单个组件在 selector 里干重活 |
| `ms/notify` | 平均每次唤醒的 selector 成本 | 乘上 `wakes` 总数 ≈ 这段时间 selector 总开销 |

> 第一行摘要里的 "mounted subscription(s)" 是**除法的分母**。没有它，`wakes` 无法还原成通知次数
> —— 同一组数字有好几个合法公约数，猜不得。

### 判据（拿当前的修复结果对照）

| 场景 | 看哪一列 | 健康值 | 说明 |
|---|---|---|---|
| 拖一下滑块 / 拖一下 clip | `timeline` 的 **`per s`** | **≈ 帧率**（20~60） | 修复前是"每个 pointermove 一次"，高回报率鼠标能到几百 |
| 同上 | `timeline` 的 `changed` | ≈ `notifies` × 个位数 | 每帧重渲染的组件数 × 帧数；数字太大说明每帧重画的组件多 |
| 点一下 clip | `selection` 行**出现** | `notifies` 个位数、`changed` 个位数 | 如果**没有 `selection` 行**，说明你没改变选择（见下） |
| 点一下 clip | `timeline` 行 | `changed` 应很小 | 纯粹选中不该改时间线数据 |
| 任何操作 | `selector ms` 总和 | **远小于 5ms** | 这是纯 JS 计算成本；它小就说明瓶颈不在这里 |
| 任何操作 | `wakes` 很大但 `changed%` < 10% | **正常，不用管** | 订阅点多但拦得住，说明 selector 返回原始值是有效的 |

**两条最容易误读的：**

1. `wakes` 大不可怕 —— 它只是"订阅者数量 × 通知次数"。真正的账单看 `selector ms`（花了多少时间）
   和 `changed`（要重画几个组件）。
2. **没有 `selection` 行 ≠ 探针坏了。** 点击**已经选中**的 clip 时，`setSelectedElements` 会因为
   "选择没变"直接 early-return，根本不 notify。想测选中路径，先点空白处取消选中，再点那个 clip。

### 第二张表：谁在重渲染（新加）

`__editorFanoutDump()` 现在会打印**两张表**。第二张叫
`top selector call sites that produced a NEW snapshot`，按 `changed` 倒序取前 15：

| manager | changed | wakes | changed% | selector |
|---|---|---|---|---|
| timeline | 210 | 660 | 32% | `(e) => e.timeline.getPreviewTracks()` |
| timeline | 96 | 660 | 15% | `(e) => e.scenes.getActiveSceneOrNull()?.tracks` |

`selector` 那一列是**那个组件的 selector 源码**（内联箭头函数转字符串，空白折叠、截断 120 字）。
因为内联箭头的 `toString()` 每次渲染都一样，所以同一列 = 同一个调用点；两个不同地方写了
一模一样的 selector 会合并成一行 —— 这本身也有用，它等于在说"有 N 个组件共用这个 selector"。

**这张表回答的是"430 次变化里，哪几类组件贡献最多"**，比第一张表更接近病灶：
第一张表说"timeline 变化了 430 次"，这张说"其中 210 次来自还在订整棵轨道树的那一处"。

> 只有 `changed > 0` 的行会出现在第二张表里 —— 跑了一遍但没变化的 selector 不值得占用你的注意力。

> 如果看到 `per-site breakdown unavailable`：说明这个页面是旧代码加载的（刚改完没刷新），
> 刷新一次即可。

### 清空重新测

数字是**累积**的，不清空会越测越大：

```js
window.__editorFanoutReset()
```

### 关掉

```js
window.__editorFanout = false
```

刷新页面也会自动关。

---

## 4. 一键脚本（懒人版，推荐）

省得来回敲。复制整段粘进去，回车，然后**在 10 秒内做那一次操作**，到点自动出表：

```js
window.__editorFanout = true;
window.__editorFanoutReset?.();
console.log("%c▶ 已开始计时，10 秒内请只做一次操作…", "color:#4ade80;font-size:14px;font-weight:bold");
setTimeout(() => {
  window.__editorFanoutDump();
  console.log("%c■ 时间到，上表为这 10 秒的统计。测完记得 window.__editorFanout = false", "color:#f87171;font-weight:bold");
}, 10000);
```

控制台显示倒计时期间，你**可以正常操作画面**（控制台是独立面板，不影响鼠标点画布）。

---

## 5. 五个新手容易踩的坑

| 坑 | 现象 | 解法 |
|---|---|---|
| **开着探针读帧率** | 修完之后帧率还是很低 | 探针本身有开销。测帧率前先 `__editorFanout = false` |
| **刷新页面后忘了重开** | dump 出来是空表，提示 `no samples yet` | 刷新会清掉 `window` 上的开关，要重新执行第 1 步 |
| **一次做了很多操作** | 数字大得离谱，不知道是谁 | 一次一件事，每次中间 `reset` |
| **找不到报告** | 控制台看起来没输出 | 报告是**折叠**的（前面有小三角 ▸），点开才有表格；另外检查左上角日志级别没被设成 Errors only |
| **`__editorFanoutDump is not a function`** | 类型错误 | 编辑器还没加载完，或上下文不是 `top`。等页面加载完，或刷新 |

---

## 6. 建议的实测顺序（对照实验）

想证明"拖拽掉帧跟 clip 数量无关"，做这个对比：

| 轮次 | 工程内容 | 操作 | 记录 |
|---|---|---|---|
| 1 | 只有 **1 个** clip | 点这个 clip | `selection` 的 `changed` |
| 2 | **20 个** clip | 点其中一个 | `selection` 的 `changed` |

两轮的 `changed` 应该**基本持平**（都是个位数）。如果第 2 轮明显更大，说明还有按 clip 数量
线性增长的扇出没摘干净。

同理，拖滑块时看 `timeline` 行的 `wakes`：
- 修复前：一次拖动 = 几百次 notify（每个 pointermove 一次完整同步 commit）
- 修复后：应掉到**接近帧数**的量级

---

## 7. 把结果发给我

只需要这三样：

1. 你做了什么操作（"点了第 3 个 clip" / "拖了不透明度滑块"）
2. `__editorFanoutDump()` 的表格截图
3. 如果同时开了 `__renderPerf`，最后那一组 `[render-perf]` 展开截图

有这三样就能定位到具体是哪条链路还在烧时间。

---

*本文档描述的是本地开发用诊断开关，不涉及任何工程文件格式，也不会影响成片导出。*
