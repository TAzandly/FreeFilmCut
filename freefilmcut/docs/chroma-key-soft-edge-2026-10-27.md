# 抠像「边缘太硬、参数调不动」— 度量重写 + 空间柔化

**日期**：2026-10-27
**范围**：`apps/web/src/chroma-key/*`、`services/renderer/compositor/chroma-key-material.ts`、`params/registry.ts`

---

## 一句话结论

三个问题叠在一起，不是"参数没生效"，是**参数本身被映射到了一个几乎不可用的区间**：

1. **开开关不生效、必须吸色** —— 旧度量按"最亮通道归一化"算色相距离，稍微偏色的绿幕距离就到 0.372，而旧默认强度 20 只给 0.148 的半径。差 2.5 倍，怎么都不抠。吸色后距离变 0 才生效。
2. **边缘硬** —— 羽化映射到 0.002–0.25 的**色彩**斜坡。色彩斜坡只能羽化"颜色介于两者之间"的像素，干净的绿幕边上只有 1–2 个这样的像素，所以物理上就是一刀切。
3. **调不动** —— 边缘清除按 alpha 边缘（`1 - |2a-1|`）加权，硬切边缘根本没有半透明像素，这个滑杆在任何位置上输出都一样。

改法：换成参考实现（similarity / smoothness / spill）的 BT.601 色度平面度量，重设三档映射，并新增**边缘柔化**——在纹素空间对 matte 做 3×3 加权模糊，这是真正能把边缘"变宽"的旋钮。

---

## 1. 面板参数（现在是 6 项，5 个可动）

| 面板 | param key | 范围 | 默认 | shader uniform | 物理含义 |
|---|---|---|---|---|---|
| 取色器 | `chromaKey.color` | `#RRGGBB` | `#00FF00` | `uChromaKeyColor`（sRGB 0..1） | 键色，不可动画 |
| 强度 | `chromaKey.intensity` | 0–100 | **45** | `uChromaSimilarity` 0–0.9 | CbCr 平面上的"背景半径" |
| 阴影 | `chromaKey.shadow` | 0–100 | 0 | `uChromaShadow` | luma < 0.35 的像素恢复不透明 |
| 边缘羽化 | `chromaKey.feather` | 0–100 | **25** | `uChromaSmoothness` 0.004–0.3 | **色彩**空间斜坡宽度 |
| **边缘柔化** | `chromaKey.soften` | 0–100 | **30** | `uChromaSoften` 0–10 texel | **空间** matte 模糊半径（新增） |
| 边缘清除 | `chromaKey.edgeCleanup` | 0–100 | **20** | `uChromaSpill` | 阈值附近去溢色，范围 0.7×强度 |

滑杆仍是 0–100 的作者单位存在 `element.params`，物理映射集中在 `resolveChromaKeyUniformValues()`（`chroma-key-material.ts`）一处，并被单测锁定。

---

## 2. 算法：旧 vs 新

| 环节 | 旧 | 新 |
|---|---|---|
| 距离 | `c / max(r,g,b)` 后取欧氏距离 | BT.601 色度平面 `(U,V)` 欧氏距离（参考实现） |
| 半径 | `mix(0.02, 0.65, 强度)` | `mix(0, 0.9, 强度)` |
| 斜坡 | `smoothstep(半径, 半径+羽化, d)`，羽化最小 **0.002** | `pow(clamp((d-半径)/羽化, 0, 1), 1.5)`，羽化最小 **0.004**、默认 0.074 |
| 边缘软化 | 无 | 3×3 加权（4/2/1，合计 16）对 **matte** 采样，半径单位是纹素 |
| 去溢色 | 按 alpha 边缘加权 | 按 `d - 半径` 的距离带加权 |

两个实现细节值得留档：

- **为什么用 CbCr 而不是峰值归一化**：参考实现的 `RGBtoUV` 让亮度几乎不进距离，所以亮绿幕和它背光面落在同一点上，一个强度值能同时覆盖两者。峰值归一化把色相压成归一化方向，稍微偏冷/偏暖的绿幕直接飘到 0.3+，这正是"必须吸色"的根源。
- **为什么去溢色不能看 alpha**：硬切边缘没有半透明像素，`1-|2a-1|` 恒为 0，滑杆形同虚设。改成看"离阈值多远"后，紧贴阈值的溢色像素才会被去饱和。

---

## 3. 无头实测（Chrome + SwiftShader，WebGL2，真注入后的 three shader）

测试纹理 256×64，四段：偏色绿幕(+硬边)→纯绿(+硬边)→暗绿(0,64,0)→溢色肤色(153,140,102)。逐像素 `readPixels` 读 alpha。

| 用例（强度/羽化/柔化） | 绿幕 alpha | 主体 alpha | 过渡带 | 暗绿 alpha | 溢色像素 sRGB |
|---|---|---|---|---|---|
| 旧默认滑杆值 20/0/0 | **255**（没抠掉） | 255 | 0 px | 255 | [153,140,102] |
| 硬切 45/0/0 | 0 | 255 | **0 px** | 0 | [152,140,105] |
| **新默认 45/25/30** | 0 | 255 | **6 px** | 0 | [152,140,105] |
| 羽化拉满 45/100/0 | 0 | **106** | 10 px | 0 | — |
| 柔化拉满 45/0/100 | 0 | **255** | **20 px** | 0 | [152,140,105] |
| 两者拉满 45/100/100 | 0 | 106 | 20 px | 0 | — |
| 阴影 100 | 0 | 255 | 0 px | **157** | [152,140,105] |
| 边缘清除 0 | 0 | 255 | 0 px | 0 | [153,140,102] |
| 边缘清除 50 | 0 | 255 | 6 px | 0 | [143,139,130] |
| 边缘清除 100 | 0 | 255 | 6 px | 0 | [140,139,137] |

> 第一行的 255 是用**新度量 + 旧滑杆默认值**实测的；旧度量下该绿幕的距离是 0.372、半径 0.148，同样是 255，两条路结论一致。

读法：

- **第一行复现了你的现象**：同一台绿幕，旧默认值的 alpha 是 255（完全没抠），所以"开启后不生效"不是开关坏了。距离 0.372 vs 半径 0.148，量出来的。
- **新默认一行**：什么都不动，绿幕抠掉、主体 255、边缘已经有 6px 渐变。
- **羽化 100 会把主体压到 106**，所以羽化的上限只给到 0.3（不给到 1.0）。它天生是"色彩斜坡"，拉宽了必然咬到主体。
- **柔化 100 拉出 20px 过渡而主体仍是 255**，因为它只模糊 matte，主体内部邻居全是主体。这就是"边缘硬"该用的旋钮。
- 去溢色三行单调：`[153,140,102] → [143,139,130] → [140,139,137]`，即向 luma 灰收敛。

---

## 4. 过程中踩到的坑（值得记）

第一版把采样函数 `chromaSampleSrgb()` 写在 `#include <common>` 之后，而 `map` 是 `#include <map_pars_fragment>` 声明的——**在 `common` 后面**。结果：

```
ERROR: 0:175: 'map' : undeclared identifier
```

program 编译失败 → 该图层**一次都不绘制**。这不是"抠像没生效"，是 clip 直接从画面上消失。无头探针第一次跑出全 0 才暴露出来（三次里只有 diagnostics 里的 `console.error` 能看出来）。

修复：采样函数注入到 `void main()` 之前（函数不能定义在 main 里面，所以也不能挂在 `alphamap_fragment` 锚点上）。单测现在断言 `map_pars_fragment < chromaSampleSrgb < void main`。

---

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `chroma-key/settings.ts` | 类型改为 0–100 作者单位；新增 `soften`；新默认值（45/25/30/0/20）；导出 `clampPercent` |
| `chroma-key/index.ts` | 导出新增常量 |
| `params/registry.ts` | 新增 `chromaKey.soften`（边缘柔化，0–100，默认 30），调整其余三项默认值 |
| `chroma-key/components/chroma-key-tab.tsx` | 字段列表加入 `soften` |
| `services/renderer/compositor/chroma-key-material.ts` | 度量重写、`SAMPLER_HELPERS` 拆出并注入到 `main()` 前、3×3 加权柔化、去溢色改按距离带、`resolveChromaKeyUniformValues()` 映射、`applyChromaKeyToMaterial` 接收 `texelSize` |
| `services/renderer/compositor/three-compositor.ts` | 传 `1/entry.width, 1/entry.height` 作为纹素尺寸 |
| `services/renderer/__tests__/chroma-key-shader.test.ts` | 新增采样函数注入位置、USE_MAP 守卫、映射范围与"每个滑杆只动自己的 uniform" |
| `agent-scratch/chroma-verify/*` | 无头像素验证（`build.ts` 生成注入后的 shader + 用例，`page.html` 渲染并读回） |

---

## 6. 校验

- `bun test src/chroma-key src/services/renderer/__tests__/chroma-key-shader.test.ts` → **19 pass**
- `tsc --noEmit` → **154**，与改动前一致（无新增）
- `eslint` 四个改动文件 → **0**
- 无头 WebGL2：shader 编译零日志，10 组用例像素级断言如上

---

## 7. 边界与代价

- **性能**：`边缘柔化 > 0` 且图层启用抠像时，每像素多 8 次纹理采样；`柔化 = 0` 走 uniform 分支，完全不采样（未抠像图层同样为零成本）。多轨同时抠像又都开柔化时，把柔化调回 0 是最省的做法。
- **羽化的语义变了**：老工程存的 `intensity` / `feather` 数值仍能读，但映射区间换了，同一数字的效果与之前不同（旧 50 ≈ 新 37）。需要按画面重调，不会崩。
- **只作用于 three 合成器路径**（`NEXT_PUBLIC_USE_THREE=0` 回退到 wasm 时不生效）。
- 键色仍不可动画；「智能抠像」「自定义抠像」未做。

---

## 8. 后续修正：Keying 面板只剩下开关（参数全不可见）

**现象**：选中 clip 打开 Keying tab，整个面板只有一个「色度抠图」开关，吸色器和四个滑杆一个都没有。

**根因**：六个参数全部声明了

```ts
dependencies: [{ param: "chromaKey.enabled", equals: true }]
```

而属性面板的 `ElementParamFields` 是用 **`isVisible()` 过滤后渲染**的（`element-params-tab.tsx:82`）——门控不满足时整行不渲染，不是置灰。开关默认 `false`，于是默认状态下六个控件被全部丢掉，面板看起来就是"空的/坏的"。

**三步验证**（排除法，避免猜）：

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 注册表有没有这些 key | 运行时脚本 `getElementParams({element: video})` | ✅ 7 个 key 全在（含 `enabled`） |
| 依赖能不能读到 | `readElementParamValue` off/on | ✅ `false` / `true`，读取正常 |
| 渲染层是否丢字段 | 看 `Section` / `SectionContent` / `PropertyParamField` | ✅ 全部无条件渲染 |

三条都正常 → 唯一的裁剪点就是 `dependencies` 过滤。

**改法**（不动面板通用组件）：

1. `params/registry.ts`：六个参数**去掉 `dependencies`**，改为常驻渲染。
2. 新增 `writeChromaKeyParam()` 写入钩子：写任意一项时**同时把 `chromaKey.enabled` 置 true**，于是"触碰即开启"，原来的开关退化成一个状态镜像，不需要靠它解锁 UI。
3. `chroma-key/settings.ts` 导出 `CHROMA_KEY_PANEL_KEYS`（面板键名单一来源），tab 用它构建 `Set` 过滤；关闭时在正文顶部加一行提示「调节下方任意参数会自动开启色度抠图」。
4. 新增 `params/__tests__/chroma-key-params.test.ts` 回归测试：断言**六个键没有一个带 `dependencies`**、六个键写入后 `enabled` 必为 true、Tab 键名与注册表一致。

> 经验：`dependencies` 在这个面板里是**隐藏**语义而不是禁用语义。给可选功能加 UX 开关时，要么常驻 + 触碰即启用，要么显式 disabled；不要靠隐藏来表达，否则"功能没开"和"功能坏了"在界面上长得一样。

---

## 9. 后续修正：Keying UI 英文化 + 输入改滑条

**需求**：这个面板的 UI 改成英文；数值输入全部改成滑条。

### 标签对照

| key | 旧（中文） | 新（英文） | 控件 |
|---|---|---|---|
| `chromaKey.enabled` | 色度抠图 | **Chroma Key** | Switch（在 section header，不是独立行） |
| `chromaKey.color` | 取色器 | **Key Color** | ColorPicker（含系统吸管） |
| `chromaKey.intensity` | 强度 | **Intensity** | Slider 0–100，默认 45 |
| `chromaKey.shadow` | 阴影 | **Shadow** | Slider 0–100，默认 0 |
| `chromaKey.feather` | 边缘羽化 | **Feather** | Slider 0–100，默认 25 |
| `chromaKey.soften` | 边缘柔化 | **Soften** | Slider 0–100，默认 30 |
| `chromaKey.edgeCleanup` | 边缘清除 | **Spill Removal** | Slider 0–100，默认 20 |

> `边缘清除` → `Spill Removal` 是有意的：这个参数实际做的是把靠近键色的像素去饱和（即去溢色）。
> 英文里叫 edge cleanup 容易和 alpha 边缘的腐蚀/膨胀混淆，故与参考 shader 的 `spill` 对齐。

面板正文旧提示「调节下方任意参数会自动开启色度抠图」→ `Adjusting any control below switches chroma key on.`

### 滑条做成了通用能力，不是抠像专用

`NumberParamDefinition` 新增可选字段 `control?: "slider"`（`params/index.ts`）。
`PropertyParamField` 在 `type === "number"` 分支里分流：

- `control: "slider"` → 新的 `SliderParamField`（radix `Slider` + 右侧只读数值 readout）
- 其余 → 原有的 `NumberField`（拖拽 scrub，适合需要精确键入的参数）

**任何其它面板想换滑条，只需在参数定义里加一行 `control: "slider"`**，不用改组件。

### 交互链路没有变

Slider 仍然走 `onPreview` / `onCommit` 两个回调：

| 事件 | 行为 |
|---|---|
| `onValueChange`（pointermove） | `snapToStep` + clamp → `onPreview`；**与当前值相同则跳过**，避免无意义写 |
| `onValueCommit`（pointerup） | `onCommit` → 落 undo 栈 |

下游 `useKeyframedParamProperty` 里的 `useCoalescedPreview` 依旧把一帧内的多次预览写合并成一次，
所以拖滑条的成本与之前拖 NumberField 完全一致。关键帧菱形、`dependencies` 可见性、自动启用钩子全部不受影响。

### 校验

- `bun test src/params src/chroma-key` → **20 pass**（含第 8 节的可见性回归用例）
- `eslint` 改动文件 → **0**
- `tsc --noEmit` → **154**（与基线一致，0 新增）

---

> 本报告基于静态分析与无头 WebGL2 合成纹理实测，像素数据来自 SwiftShader 软件光栅化，与真机 GPU 的插值细节可能有 ±1/255 的差异；实际观感请以预览为准，仅供参考。
