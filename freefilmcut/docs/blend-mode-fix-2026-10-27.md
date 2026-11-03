# 混合模式（Blend Mode）修复 — 2026-10-27

## 现象

图片/视频 clip 属性面板的 Blending tab 里 `blendMode` 有 17 个选项
（normal / multiply / screen / overlay / soft-light / difference / hue / …），
但除 normal 外**全部无效**——切到任何模式画面与 normal 完全一致。

## 根因

`blendMode` 一路传到了渲染链的 `FrameItemDescriptor.blendMode`
（`frame-descriptor.ts:347/411` 已读取 `node.params.blendMode`），
但合成器 **从未消费它**：`three-compositor.ts` 里 `blendMode` 只出现在内部
blit 的 `alpha` / `NoBlending` 二选一（第 1112 行，服务于 vfx pack 的
`blitTextureToTarget`），图层网格的材质从未读取过这个字段。
所以任何非 normal 值都以默认 `NormalBlending` 绘制 → 看起来"只有 normal 生效"。

## 方案取舍：为什么不用 three 内置 blending

three 内置 `MultiplyBlending` / `AdditiveBlending` / `CustomBlending` 只能表达
固定管线公式 `dst·f(src,dst)`，覆盖 multiply / screen / plus-lighter /
min / max 这一小组；而 **overlay、soft-light、color-dodge/burn、difference、
exclusion 和四个 HSL 模式（hue/saturation/color/luminosity）必须逐像素读取
底色**，固定管线原理上做不到。即便可表达的那几个，固定 factor 也无视底色的
alpha，半透明边缘会算错。

所以采用 **shader 混合 + backdrop 快照** 路线，17 种模式全覆盖：

```
compositeOneLayer(layer)                    // 合成器本来就是逐层绘制
  ├─ blendMode !== "normal"
  │    └─ snapshotBelowSource()             // accumRT → belowSourceRT（HalfFloat）
  │        此时 accum 里正好是"本层以下所有内容"
  ├─ addLayerMesh(item, z, backdrop)
  │    └─ applyBlendModeToMaterial(...)     // uniforms + material.blending = NoBlending
  └─ renderer.render(scene, camera)         // 片元着色器算完整 Porter–Duff + 混合
```

关键点：

1. **逐层合成结构是现成的**。`compositeOneLayer` 一层一层画进 accumRT，
   画每层之前 accum 就是 CSS 语义里的 backdrop，`snapshotBelowSource()`
   （为 vfx pack 的 uInput 而建）直接复用，每帧每个混合层多一次全屏 blit。
2. **注入点**：`#include <opaque_fragment>` 之后——`gl_FragColor` 此时已携带
   map × tint × opacity × mask(alphaMap) × chroma-key alpha，正是混合应该
   看到的"本层颜色"。uniform 声明挂 `#include <common>`（无 `map` 依赖，
   文字/纯色层也能编译）。
3. **色彩空间**：accumRT 存的是 sRGB 编码值（HalfFloat、无硬件解码），
   `map` 采样得到线性值。着色器把本层转回 sRGB、在 sRGB 空间做混合
   （CSS 规范与剪映参考实现的空间）、转回线性交给 three 的
   `colorspace_fragment` 统一编码。在 linear 空间混合会得到肉眼可辨的
   不同（multiply 偏暗、screen 偏灰），所以这一步不能省。
4. **NoBlending 是必须的**：着色器自己算完整合成（含 Porter–Duff），
   若再叠加 GL 混合等于应用两次。透明像素会把 backdrop 原样写回，无损。
5. **plus-lighter 特例**：CSS 定义它是**预乘**相加（canvas2d 语义），
   `Co = min(Cs·αs + Cb·αb, 1)`，再除回 αo 转成管线使用的 straight 存储。
   无头实测：半透明图层压在透明底上 = 全绿 + α0.5，与 canvas2d 一致。
6. **材质池兼容**：`installBlendModePatch` 链式包裹 chroma patch 的
   `onBeforeCompile` 与 `customProgramCacheKey`（不覆盖）；每层每帧用
   uniform 写模式与 backdrop，pool 复用时会显式复位（防止上一层的
   backdrop 纹理泄漏）。

## 17 种模式的 GLSL 分发

`BLEND_MODE_SHADER_INDEX`（`blend-mode-material.ts`）把 `BlendMode` 映射到
`uBlendMode` 整型，着色器 if-chain 分发。可分离模式用 W3C 公式
（color-burn/dodge 带 `1e-4` 除零保护）；HSL 四件套用标准
`Lum/Sat/SetLum/SetSat/ClipColor`（`SetSat` 用 step/mix 向量化实现，
并列最值时仍符合 W3C 排序）；overlay 与 hard-light 共用一个
`blendHardLight(a,b)`（CSS：`overlay(Cb,Cs) = hardlight(Cs,Cb)`）。

## 无头 WebGL2 像素级验证（agent-scratch/blend-verify/）

真实 `ShaderLib.basic.fragmentShader` 注入后编进 SwiftShader，绿层(0,255,0)
压红底(255,0,0)，四探针 × 17 模式，与**手算 CSS 期望值**比对（容差 4/255）：

| 探针 | 语义 | 结果 |
| --- | --- | --- |
| opaque(48) | `B(Cs,Cb)` | 17/17 通过（如 multiply→黑、screen→黄、hue→(0,130,0)、luminosity→(255,106,106)） |
| semi(128) | αs=0.5、底不透明：`0.5B+0.5Cb` | 17/17 通过 |
| untouched(176) | αs=0 必须原样写回 backdrop | 17/17 通过 |
| semi@ab0(208) | 半覆盖压透明底：`0.5·Cs` | 16/17 + plus-lighter 按预乘语义通过 |

无着色器编译错误（`logs: []`）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `services/renderer/compositor/blend-mode-material.ts`（新） | 注入/安装/逐帧 uniform 写入 + 17 种混合公式 GLSL |
| `services/renderer/compositor/three-compositor.ts` | `acquireMesh` 安装 patch；`compositeOneLayer` 为非 normal 层抓 backdrop；`addLayerMesh` 接收 backdrop 并应用 |
| `services/renderer/__tests__/blend-mode-shader.test.ts`（新） | 锚点守卫（含真实 three shader）、17 模式分发齐全且索引唯一、plus-lighter 预乘特例、无 `map` 依赖 |

## 校验

- `bun test src/services/renderer/__tests__ src/chroma-key src/params` → **48 pass / 0 fail**
- eslint 两个新文件 → **0**
- `tsc --noEmit` → **154**（与基线一致，0 新增；`three-compositor.ts` 既有
  报错行均未触碰）
- 无头 WebGL2 → 17 模式 × 4 探针全过

## 边界与后续

- 仅 three 合成器路径（`NEXT_PUBLIC_USE_THREE=0` 的 wasm 回退不受影响）。
- 文本层（flowerText）与 vfx pack 场景项的 `blendMode` 未接——它们走
  textLayerRT/blit 路径，如需要可复用同一 blend 材质接到对应 blit 上。
- 每个混合层每帧多一次全屏 RT blit + 一次 `initTexture` 同步；混合层多时
  （>4）可改为 ping-pong 合并快照，当前典型 MV 剪辑（1–2 个混合层）无感。
