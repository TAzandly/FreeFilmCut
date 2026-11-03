# Compose span 表拆解：28ms 的双峰来自 pack 场景每帧销毁重建

日期：2026-10-27
范围：`apps/web/src/services/renderer/compositor/three-compositor.ts`
数据来源：`window.__renderPerf = true` 的 span 表（60 帧窗口）

---

## 一、原始读数

| span | count | meanMs | p50Ms | p95Ms | maxMs |
|---|---|---|---|---|---|
| `renderFrame` | 60 | 25.57 | 39 | 43.8 | 48.9 |
| `three:forcedOverlays` | 60 | 14.42 | **27.3** | 32.2 | 34.7 |
| `three:composite` | 60 | 9.84 | 9.4 | 12.8 | 16.2 |
| `resolve` | 60 | 0.30 | 0.3 | 0.6 | 0.9 |
| `buildFrame` | 60 | 0.21 | 0.2 | 0.3 | 0.5 |
| `three:present` | 60 | 0.08 | 0.1 | 0.2 | 0.4 |
| `syncTextures` | 60 | 0.02 | 0 | 0.1 | 0.1 |

## 二、第一处异常：`mean` 小于 `p50`，这在数学上不可能

`mean 14.42` 却 `p50 27.3`。中位数意味着**至少 30 个样本 ≥ 27.3**，那么均值下界就是 `0.5 × 27.3 ≈ 13.65`，而 60 个样本里若真有 30 个在 27 以上，均值必然 ≥ 19 以上才能容纳其余样本。

唯一自洽的解释是**双峰**：

- 约 29 帧 ≈ 0ms
- 约 31 帧 ≈ 27~34ms
- 均值 = `31 × 29 / 60 ≈ 15` ✓

`renderFrame` 同理：高帧 `1.2 + 9.4 + 27.3 + 0.1 ≈ 38`，低帧 `1.2 + 9.4 + 0 + 0.1 ≈ 10.7`，
`0.55 × 38 + 0.45 × 10.7 ≈ 25.7` ✓ 与 `mean 25.57`、`p50 39` 完全吻合。

**结论：不是整体慢，是一半的帧多花约 28ms。**

## 三、第二处异常：`three:forcedOverlays` 名不副实

原打点代码覆盖的区间是：

```ts
this.lastFramePackIds = framePackIds;
this.syncPackScenes();          // ← 在 span 里
this.pruneFlowerTextScenes();   // ← 在 span 里
await this.renderForcedOverlays({ ... });  // ← 在 span 里
recordSpan({ name: "three:forcedOverlays" });
```

而 `renderForcedOverlays` 的入口是：

```ts
const toDraw = activeOverlayIds.filter((id) => !skipIds.has(id));
if (toDraw.length === 0) return;
```

`activeOverlayIds` 由 `setOverlayActive` 写入，而**全仓没有任何一处调用 `setOverlayActive`**
（`apps/web/src` 内唯一命中是它自己的定义）。也就是说这个"Effects 面板强制预览"通道是**死代码**，
`renderForcedOverlays` 每帧都在 `toDraw.length === 0` 处直接返回。

所以那 14.42ms / 27.3ms 全部来自两个场景维护函数，与 pack 渲染无关。

## 四、根因：`syncPackScenes` 自己拆自己建

```ts
private syncPackScenes() {
	const { packs, activeOverlayIds } = getPackRegistrySnapshot();
	const keep = new Set([...activeOverlayIds, ...this.lastFramePackIds]);  // ①

	for (const [packId, built] of this.packScenes) {
		if (!keep.has(packId)) disposeBuiltPackScene({ built });           // ② 不在①里就销毁
	}

	for (const packId of keep) this.ensurePackBuilt(packId);

	// Also prebuild any registered pack that has a scene (first timeline drop is snappy).
	for (const pack of packs) {
		if (pack.scene) this.ensurePackBuilt(pack.id);                     // ③ 注册过就重建
	}
}
```

`keep` 只包含**本帧用到的** pack（①②），但 ③ 又对所有**已注册**的 pack 无条件预构建。

于是任何一个"已注册、但本帧不在画面上"的 pack 每帧经历：

| 步骤 | 动作 | 代价 |
|---|---|---|
| 帧 N 的 ② | `disposeBuiltPackScene` | 释放 pack 内 video 元素、纹理、材质、RT，驱动在删除时同步 |
| 帧 N 的 ③ | `ensurePackBuilt` | 立刻重新异步构建同一个 pack |
| 帧 N+1 | 构建完成，回到 packScenes | —— |
| 帧 N+1 的 ② | 再销毁一次 | 循环 |

**销毁和重建首尾相接，永不收敛。** 这正好产出一个周期性的 25~35ms 尖峰，
与观测到的双峰分布一致。

### 为什么"播放头在 clip 上时才正常"

包在 `lastFramePackIds` 里 → 进 `keep` → ② 不销毁 → 场景稳定 → 视频正常播放。
离开 clip → 掉出 `keep` → 立刻进入销毁/重建循环 → 画面消失、声音异常。
这与之前记录的"只有播放箭头在 vfxpack clip 上时视频才能正常播放"是同一个机制。

### 为什么另一条路径也会掉帧

`frame-descriptor.ts` 里：

```ts
if (node instanceof EffectLayerNode) {
	if (!node.resolved || node.resolved.passes.length === 0) return;  // 整项被丢弃
```

只要 `resolved` 在某帧为 null，pack 就不进 `framePackIds`，同样触发上面的销毁链条。
这解释了"播放中也偶发"。

## 五、修复

### 1. 让清理与预构建采用同一套策略（根因）

```ts
const registered = new Set<string>();
for (const pack of packs) {
	if (pack.scene) registered.add(pack.id);
}
const keep = new Set<string>([...activeOverlayIds, ...this.lastFramePackIds, ...registered]);
```

语义变成：**pack 只在离开注册表时才销毁**（`removePack` → `subscribePackRegistry` → `syncPackScenes`）。
这与 ③ 的原本意图（"首次拖到时间线要快"）一致——既然要预构建，就不能在下一帧把它删掉。

内存口径不变：③ 本来就把所有带 scene 的注册 pack 全部建好了，修复只是不再每帧把它们清掉。

### 2. 拆开被合并的 span

| 新 span | 含义 |
|---|---|
| `three:setup` | `ensureInitialized` + 相机/视口 + 目标 clear + mesh 拆除 |
| `three:syncPackScenes` | pack 场景维护（原 `forcedOverlays` 的绝大部分） |
| `three:pruneTextScenes` | 文字场景清理 |
| `three:forcedOverlays` | **真正的**强制覆盖绘制，应恒为 0 |

### 3. 补 5 个计数器，让循环可见

| counter | 期望值 | 非期望值的含义 |
|---|---|---|
| `packSceneDispose` | 0 | >0 = 仍在销毁重建 |
| `packSceneBuild`（隐含） | 只在首次 | —— |
| `framePackIds` | 稳定不变 | 抖动 = 描述符在丢 pack |
| `forceOverlayPacks` | 0 | >0 = 死通道被激活了 |
| `composeTargetRebuild` | 0 | >0 = 合成尺寸在振荡 |
| `flowerTextDispose` | 0 | >0 = 文字层每帧重建 |

## 六、验证方法

```js
window.__renderPerf = true      // 设置 → Developer → Compose profiler 也可以
```

播放 1 秒后看两张表。

**span 表期望**

```
renderFrame               ≈ 11ms      （原 25.57 / p50 39）
three:composite           ≈ 9.4ms     （不变，这是剩余主项）
three:syncPackScenes      ≈ 0.1ms     （原 27.3 的 p50）
three:pruneTextScenes     ≈ 0ms
three:forcedOverlays      ≈ 0ms
three:setup               ≈ 1.2ms
```

**counter 表期望**

```
packSceneDispose 0     forceOverlayPacks 0     composeTargetRebuild 0     flowerTextDispose 0
```

若 `packSceneDispose` 仍 > 0 且 `framePackIds` 在 0/1 之间抖动，则剩下的是
`EffectLayerNode.resolved` 为 null 的那一帧丢项问题，需要单独在描述符侧加"保持上一帧 pack"的逻辑。

## 七、剩余成本（未改动）

修复后 `three:composite` 仍是 9.4ms，是新的天花板。每帧只有 3 个绘制项，
9.4ms 说明是**填充率/带宽**而非对象数量：compose 目标为 `HalfFloatType`，
且预览默认按工程画布原始分辨率合成（`DEFAULT_PLAYBACK_QUALITY = "original"`，scale 1）。

下一步的定性实验（不改代码）：切到 Medium Quality 再测 `three:composite`，
降到 ~2.4ms 即确认填充率，可考虑播放期自动降档或把 compose 目标改为 8-bit。

---

> 本文结论基于静态代码分析与对既有读数的数学自洽性推导；根因（销毁/重建循环）在代码逻辑上可直接验证，
> 实际收益以修复后 `__renderPerf` 的实测为准。
