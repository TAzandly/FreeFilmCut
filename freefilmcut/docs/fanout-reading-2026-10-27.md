# 扇出报告读数：这一组数字说明了什么

> 输入（用户粘贴，未二次加工）：
>
> | manager | wakes | changed | changed% | selector ms | max sel ms | ms/notify |
> |---|---|---|---|---|---|---|
> | timeline | 6864 | 430 | 6.3% | 4.7 | 0.1 | 0.001 |
> | renderer | 6708 | 86 | 1.3% | 3.1 | 0.1 | 0 |
> | project | 312 | 32 | 10.3% | 0.2 | 0.1 | 0.001 |
> | scenes | 156 | 10 | 6.4% | 0 | 0 | 0 |

---

## 一、能确定的（与订阅点数量无关，硬结论）

**1. selector 完全不是瓶颈。**

| 项 | 值 |
|---|---|
| 四行 `selector ms` 相加 | **8.0ms**（4.7 + 3.1 + 0.2 + 0） |
| 最慢的单个 selector | **0.1ms** |
| 平均每次唤醒 | **1µs**（`ms/notify` = 0.001） |

这 8ms 是**整个采样窗口**的总和，不是每帧。对比 `compose` 的 4ms/帧、整帧预算 33ms ——
selector 这条线已经可以彻底划掉了。之前那轮把订阅收窄成"按元素布尔 / 轨道字符串 key"，
效果就体现在这里：**1µs 一个 selector，说明比较成本几乎为零**（布尔和字符串的 `Object.is`）。

**2. 但仍有 558 次组件重渲染。**

`changed` 是**绝对次数**（每发生一次快照变化 = 一个组件要重画），与订阅点数无关：

```
timeline 430 + renderer 86 + project 32 + scenes 10 = 558 次
```

**这是这张表里唯一还有分量的数字。** 它说明"扇出计算"虽已便宜，"被唤醒后真的重画"仍在发生。

**3. 拦截率是对的。**

`changed%` 只有 6.3% / 1.3% —— 94% 的唤醒被 selector 挡在门外，没有触发重渲染。
说明上一轮"订阅原始值"的方向正确，不需要回退。

**4. `timeline` 与 `renderer` 是 1:1 的。**

| | wakes | 比值 |
|---|---|---|
| timeline | 6864 | 1.02 |
| renderer | 6708 | 1.00 |

每一个 timeline 通知后面几乎都紧跟一次 renderer 通知 —— 这就是
`previewElements → applyPreviewOverlay → notify(timeline) → buildScene → setRenderTree → notify(renderer)`
那条链路在跑。**预览树在重建**，而重建的耗时**不在这张表里**。

---

## 二、不能确定的（必须补一列才能判断）

**通知次数无法反推。**

`wakes` 是"订阅者数量 × 通知次数"，所以：

```
6864 : 6708 : 312 : 156 = 44 : 43 : 2 : 1   （若订阅数 = 156）
                        = 88 : 86 : 4 : 2   （若订阅数 = 78）
                        = 132 : 129 : 6 : 3 （若订阅数 = 52）
```

四个数的 gcd 是 156，但 **78、52、39 也都是合法解**。这直接决定了结论相反：

| 若订阅数 = | timeline 通知次数 | 意味着 |
|---|---|---|
| 156 | 44 次 | 若窗口约 2 秒 → ~22/s ≈ 帧率 → **一帧一次，合并生效** |
| 52 | 132 次 | 若窗口约 2 秒 → ~66/s → **每帧 2~3 次，合并没完全生效** |

**（同样的数字，两种相反的结论。）** 所以不能猜 —— 已给探针加了
`mounted subscription(s)` 计数和 `notifies` / `per s` 两列，下次 dump 直接读。

---

## 三、一条重要的"缺失信息"

**表里没有 `selection` 行。**

这**不是探针故障**，而是说明：**这次采样窗口里，选择状态根本没变过。**

两种可能：

1. 你点的是**已经选中**的 clip —— `setSelectedElements` 检测到选择完全一样会 early-return
   （`selection-manager.ts:137`），不 notify。
2. 你这次做的是**拖拽**（拖 clip / 拖滑块），没有点选。

不管是哪种，结论一样：**"选中 clip 掉帧"那条路径，这一轮没被验证到。**
同时 `playback` 行也缺席，说明也不是播放中的采样。

所以这组数据支持的说法是"**拖拽时的扇出状况**"，不能用来宣布"选中已经不卡了"。

---

## 四、账单去哪了

```
每帧 33ms 预算
├─ compose（合成器）        4ms     ← 已知，不是瓶颈
├─ selector 计算            0.18ms  ← 本次实测，可忽略
├─ buildScene + 重渲染       ?
└─ React commit（画 558 个） ?
```

现在**唯一没有量化的是最后两行**。而它们恰好都有现成探针：

| 想量什么 | 用什么 | 状态 |
|---|---|---|
| `buildScene` 本身耗时 | `preview:buildScene` span | ✅ 已埋点，**只是没开**（需 `__renderPerf`） |
| 发布给渲染器的耗时 | `preview:publishTree` span | ✅ 同上 |
| 每帧重建几次 | `preview:treePublish` counter | ✅ 同上 |
| 558 次重渲染是谁 | 探针第二张表（按 selector 源码分组） | ✅ 本轮新加 |

---

## 五、下一步（两步，都不改业务代码）

**第 1 步：重跑一次，拿到通知次数**

```js
window.__editorFanout = true;
window.__editorFanoutReset?.();
// 拖一下 clip（就是上次那个操作），然后
window.__editorFanoutDump();
```

先看摘要行 `N mounted subscription(s) sampled X.XXs`，再看 `timeline` 行的 `per s`：

- `per s` ≈ 20~60 → 一帧一次，合并生效，可以往下走
- `per s` > 100 → 合并有漏，先补这条

再看第二张表的 `selector` 列，它会直接点名"哪一处还在每帧产出新对象"。

**第 2 步：补上 React 那一半**

```
设置 → Developer → 打开 Compose profiler
```

同样的操作再拖一遍，展开 `[render-perf] summary over 60 frames`，找这三行：
`preview:buildScene` / `preview:publishTree` / `resolve`。

如果 `preview:buildScene` 的 `meanMs` 在 5ms 以上，那答案就明确了 ——
要做的不是我原来列的"给 TimelineElement 加 memo"，而是**让 buildScene 支持增量 patch**
（拖拽期间只改被拖的那个节点，不重建整棵树）。

---

*本报告基于单次采样的静态读数与代码路径推导，结论以"待验证"标注的条目尚未实测。*
