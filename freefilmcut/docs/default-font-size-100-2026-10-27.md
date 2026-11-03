# 剪辑端默认字号 15 → 100

日期：2026-10-27
范围：`apps/web`（文本 / 遮罩 / 参数注册表 / 花字回退）
结论：**只改默认值，不改已存在元素**。新建文本、未写 fontSize 的元素、面板默认值统一为 100。

---

## 1. 为什么之前是 15

`params.fontSize` 现在是 **1:1 世界单位**（Troika / canvas 直出），但默认值 15 来自更早的
`fontSize * (canvasH / 90)` 公式：15 × (1080/90) = 180 才是在 1080p 画面上能看的字号。
公式改成 1:1 之后默认值没跟着改，于是新建文本只有 15px，几乎不可见。

这也解释了为什么花字是 100：`FLOWER_EFFECT_DEFAULT_FONT_SIZE = 100` 早就按 1:1 校准过。

## 2. 改动清单

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/text/typography.ts` | 新增 | `DEFAULT_FONT_SIZE = 100`、`FONT_SIZE_RATIO_REFERENCE = 15` |
| `src/timeline/defaults.ts` | `defaultTextElement.params.fontSize` | 15 → `DEFAULT_FONT_SIZE` |
| `src/params/registry.ts` | `fontSize` 参数定义 `default` | 15 → `DEFAULT_FONT_SIZE` |
| `src/text/primitives.ts` | `resolveTextLayout` 回退 + ratio 基准 | 15 → `DEFAULT_FONT_SIZE` / `FONT_SIZE_RATIO_REFERENCE` |
| `src/text/measure-element.ts` | `buildTextLayoutParamsFromElement` 回退 | 15 → `DEFAULT_FONT_SIZE` |
| `src/masks/builtin/definitions/text.ts` | 文字遮罩参数默认 + `buildDefault()` | 15 → `DEFAULT_FONT_SIZE` |
| `src/vfxpack/timeline-flower-text.ts` | `DEFAULT_PARAM_FONT_SIZE` | 15 → `DEFAULT_FONT_SIZE`（pack 缺 fontSize 时的回退） |
| `src/subtitles/build-subtitle-text-element.ts` | `fontSizeRatio` 分母 | `15` → `FONT_SIZE_RATIO_REFERENCE`（纯命名，行为不变） |

所有新建入口都走 `DEFAULTS.text.element.params`，因此自动继承 100：

- 资源面板「默认文本」拖入 / 点击添加（`text/components/assets-view.tsx`）
- 时间线拖放（`timeline/controllers/drag-drop-controller.ts`）
- 字幕导入（`subtitles/build-subtitle-text-element.ts`）——字号另有来源，不受影响

## 3. 刻意没有改的 15

`FONT_SIZE_RATIO_REFERENCE = 15` 是**背景框内边距的基准**，不是默认字号：

```
paddingX_实际 = 30 × (fontSize / 15)
```

`DEFAULTS.text.background.paddingX/Y = 30/42` 是按「参考字号 15」写死的。若把这个分母
也改成 100，**所有已有文本的背景框会瞬间缩到 1/6.7**，是回归而不是优化。所以分母保留 15，
字号变 100 后背景内边距按同一比例放大（仍是「padding ≈ 2× 字号」的原设计比例）。

> 副作用（预期行为，非 bug）：新文本开背景框时 padding 为 200/280px，视觉上偏大。
> 这是「按比例缩放」的既有设计；若想要更贴字的框，应改 `DEFAULTS.text.background`
> 的基准值，那会影响所有元素，需单独评估。

## 4. 影响面

- **新建元素**：fontSize = 100。之前是 15（几乎不可见）。
- **已有工程**：每个元素都存了自己的 `params.fontSize`，值不变、画面不变。
  只有参数**缺失**的元素会从 15 变 100（这类元素本来就在按 15 渲染，属于修复）。
- **文字遮罩**：新建遮罩的「Size」默认 100，同样不影响已有遮罩。
- **花字 / 模板包**：`applyFlowerPresetToTextElement` 不覆盖用户字号，模板包按 pack 自带
  的 UIText 走；只有 pack 完全没写 fontSize 时才落到 100（此前 15）。

## 5. 遗留（未动，供决策）

`src/subtitles/build-subtitle-text-element.ts` 的 `SUBTITLE_FONT_SIZE = 5` 是**同一类历史残留**：
它写于 `fontSize * (H/90)` 时代（5 × 12 = 60px @1080），在 1:1 公式下只有 5px。
只有在字幕既没有 `fontSizeRatioOfPlayHeight` 也没有 `fontSize` 时才会命中，实际多见于
手写 SRT 且未套样式。要不要一并改成 100，取决于你们对「无样式字幕」的期望，我没擅自改。

## 6. 验证

1. 新建文本 → 属性面板 Font Size 显示 **100**，画面字形约为画布高度的 1/10
2. 打开旧工程 → 原有文本字号与画面**完全不变**
3. 新建文字遮罩 → Size 默认 **100**
4. 拖动缩放 / 旋转 / 背景框开关 → 无异常（背景框按比例，见 §3）
5. 拖入花字 / 文本模板 → 外观与改动前一致（pack 自带字号优先）

校验：`tsc --noEmit` 154 errors，与改动前一致（`timeline-flower-text.ts` 的 2 条为既有的
type-assertion / duplicate-key）；`eslint` 改动文件 0 error（`build-subtitle-text-element.ts`
仅 1 条既有的未使用参数 warning）。

> 本报告基于当前工作区代码的静态分析，仅供参考；实际观感请以真机运行结果为准。
