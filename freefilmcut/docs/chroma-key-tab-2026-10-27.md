# 抠像 tab —— 色度抠图（shader 实现）

> 需求：选中图片 / 视频 clip 的属性面板增加「抠像」tab，先做色度抠图，用 shader 实现。
> 参考图：强度 / 阴影 / 边缘羽化 / 边缘清除 + 取色器，滑杆带关键帧菱形。

---

## 1. 结论先说

| 项 | 结果 |
|---|---|
| 入口 | 图片 / 视频 clip 的属性面板新增 **Keying** tab（`ColorPickerIcon`） |
| 控件 | 开关 + 取色器（系统吸管）+ 强度 / 阴影 / 边缘羽化 / 边缘清除 四个滑杆，均带关键帧菱形 |
| 实现方式 | **在图层材质里注入片元着色器**，零额外 pass、零纹理上传 |
| 数据存放 | `element.params` 的 `chromaKey.*` 六个键 —— 不走独立字段，也不写进工程格式之外的任何地方 |
| 验证 | GLSL 在真实 WebGL2（Chrome + SwiftShader）编译通过；14 组像素级行为实测见第 6 节 |

---

## 2. 为什么是「材质注入」，不是「加一个 pass」

项目里已有两套可用的像素处理通道，都不适合直接拿来放抠像：

| 备选 | 为什么不选 |
|---|---|
| `gpuRenderer.applyEffect` → `opencut-wasm` | shader 是 **按名字注册在 Rust 侧** 的（`rust/crates/effects/src/pipeline.rs` 只注册了 `gaussian-blur`，且 `pack_effect_uniforms` 硬编码只接受 `u_sigma/u_step/u_direction`）。加一个 shader 要改 Rust 并重新构建/发布 `opencut-wasm`（当前用的是 npm 上的 0.2.10，本地 `rust/wasm/pkg` 不存在，机器上也没有 `wasm-pack`） |
| 单独一遍 WebGL 把结果画进 canvas 再当纹理上传 | 每帧多一次全分辨率填充 + 一次纹理上传（1280×720 RGBA ≈ 3.7MB），而这正是之前几轮刚优化掉的成本 |

所以选择第三条：**patch `MeshBasicMaterial` 的片元着色器**。图层本来就每帧在画，抠像只是在这块像素上多几个 ALU 指令；而且它天然和 `opacity`、蒙版 `alphaMap` 结合 —— 注入点选在 `#include <alphamap_fragment>` 之后，此时 `diffuseColor` 已经是 `map × color`、alpha 已经是 `opacity × alphaMap`，相乘即得最终 alpha。

---

## 3. 数据流

```
element.params["chromaKey.*"]
   │  readChromaKeyFromParams()            ← chroma-key/settings.ts（解析 / 归一化 / 容错）
   ▼
ImageNode.params.chromaKey / VideoNode.params.chromaKey   ← scene-builder.ts
   │  resolveChromaKeyAtTime({ base, animations, localTime })
   ▼
resolved.chromaKey（四个滑杆按关键帧采样）  ← resolve.ts
   │
   ▼
FrameItemDescriptor{ type:"layer", chromaKey }            ← frame-descriptor.ts
   │
   ▼
material.uniforms（每帧 O(1) 写入）      ← three-compositor.ts / chroma-key-material.ts
   │
   ▼
片元着色器里的 keyer
```

关掉开关时整条链路是零成本的：`readChromaKeyFromParams().enabled === false` → 不往节点参数里塞字段 → `resolved.chromaKey = null` → 帧描述里没有这个键 → 只写一次 `uChromaEnabled = 0`。

---

## 4. 着色器算法

### 4.1 色度度量：按最亮通道归一化

这是这轮唯一一个**实测推翻初版**的决定。

初版用的是 CbCr 距离（多数 keyer 的起点）。实测 `(0, 0.25, 0)`（暗绿幕）与 `(0, 1, 0)` 的距离是 **0.62** —— 无论强度怎么调都抠不掉。原因是 CbCr 的色度幅度随亮度收缩，暗部绿幕自然"不够绿"。

改成**按最亮通道归一化**后：

```glsl
vec3 chromaNormalize(vec3 c) {
	float peak = max(max(c.r, c.g), max(c.b, 0.0001));
	return c / peak;
}
```

亮部绿幕和暗部绿幕落到同一点（距离 0），而红、蓝到绿的距离仍然是 1.41 —— 判别力没有丢。

### 4.2 色彩空间

两种空间的取舍很关键，因为这决定"吸管取到的颜色"和"着色器里的数字"是否对得上：

- 图层纹理都标了 `SRGBColorSpace`（`three-compositor.ts:3264/3323`），GPU 采样时自动解码 → `diffuseColor.rgb` 是**线性**值；
- 吸管取的是**预览画面**，也就是 sRGB 值。

所以着色器里先把像素转回 sRGB 再比对（`chromaToSrgb`），`uChromaKeyColor` 直接传 sRGB 0..1（用 `Vector3` 上传，绕开 three 的自动色彩管理）。若在线性空间里比对，暗部斜坡会被压缩，同一个强度值在亮/暗素材上表现不一致。

### 4.3 四个参数

| 参数 | 语义 | 实现 |
|---|---|---|
| 强度 0..100 | 判定为纯背景的半径 | `tolerance = mix(0.02, 0.65, i)`，`smoothstep` 的下沿 |
| 阴影 0..100 | 保住主体投在幕布上的暗部 | 暗部像素（`luma` 低）把 alpha 拉回 1：`mix(alpha, 1, darkness * shadow)` |
| 边缘羽化 0..100 | 软化抠像边界 | `softness = mix(0.002, 0.25, f)`，`smoothstep` 斜坡宽度（**不给 0**：smoothstep 两沿相等是未定义行为） |
| 边缘清除 0..100 | 去掉边缘残留的幕布色（绿边） | 只作用于半透明边缘（`rim = 1-|2a-1|`），朝亮度去饱和 |

---

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `src/chroma-key/settings.ts`（新） | 类型、默认值、`readChromaKeyFromParams`、`resolveChromaKeyAtTime`、`parseHexColorToSrgb` |
| `src/chroma-key/index.ts`（新） | 导出 |
| `src/chroma-key/components/chroma-key-tab.tsx`（新） | tab UI：section header 里放裸开关，下面是取色器 + 四滑杆 |
| `src/chroma-key/__tests__/settings.test.ts`（新） | 8 个用例：hex 解析、默认值、0..100→0..1、越界钳制、动画采样 |
| `src/services/renderer/compositor/chroma-key-material.ts`（新） | GLSL 片段、`injectChromaKeyShader`（纯函数，可测）、材质安装 / 每帧 uniform 写入 |
| `src/services/renderer/__tests__/chroma-key-shader.test.ts`（新） | 5 个用例，其中一个直接针对 **three 真实的 `ShaderLib.basic`**，three 升级挪动锚点会直接测试失败 |
| `src/params/registry.ts` | 新增 `chromaKeyParams`（开关 / 取色器 / 四滑杆，均带 `dependencies: enabled`），只注册给 `image` 与 `video` |
| `src/services/renderer/nodes/visual-node.ts` | 节点参数与解算状态新增 `chromaKey` |
| `src/services/renderer/scene-builder.ts` | 图片 / 视频节点透传；未开启时**不塞字段** |
| `src/services/renderer/resolve.ts` | 按 `localTime` 采样四个滑杆 |
| `src/services/renderer/compositor/types.ts` | 图层描述新增 `chromaKey` |
| `src/services/renderer/compositor/frame-descriptor.ts` | 填充图层描述 |
| `src/services/renderer/compositor/three-compositor.ts` | `acquireMesh` 安装 patch；`addLayerMesh` 每帧写 uniform（含"复用网格必须关掉上一位租客的 keyer"） |
| `src/components/editor/panels/properties/components/element-params-tab.tsx` | 抽出 `ElementParamFields`，让自定义 section 的 tab 复用同一套关键帧/预览接线 |
| `src/components/editor/panels/properties/registry.tsx` | 图片 / 视频配置里插入 `buildChromaKeyTab`（顺序：蒙版之后、特效之前） |

---

## 6. 验证

### 6.1 单元测试

```bash
cd apps/web && bun test src/chroma-key src/services/renderer/__tests__/chroma-key-shader.test.ts
# 13 pass / 0 fail
```

### 6.2 GLSL 真机编译 + 像素级行为

把注入后的片段着色器抽成独立 shader，在 Chrome（WebGL2 / SwiftShader）里编译并读回像素：

| 用例 | 输入（sRGB） | alpha | 期望 | |
|---|---|---|---|---|
| 关闭 | 纯绿 | 255 | 不动 | ✅ |
| 开启 | 纯绿 | **0** | 抠掉 | ✅ |
| 开启 | 近绿 (0.05,0.85,0.05) | **0** | 抠掉 | ✅ |
| 开启 | 暗绿 (0,0.25,0) | **0** | 抠掉 | ✅（初版此处失败，改用归一化距离后通过）|
| 阴影 50 | 暗绿 | 79 | 部分保住 | ✅ |
| 阴影 100 | 暗绿 | 158 | 保住更多 | ✅ |
| 开启 | 红 / 蓝 / 灰 / 黑 | 255 | 全部保留 | ✅ |
| 开启 | 灰绿墙面 (0.3,0.45,0.3) | 255 | 保留 | ✅ |
| 开启 55 | 同上 | 255 | 仍保留 | ✅ |
| 羽化 100 | 临界绿 (0.25,0.9,0.25) | **211** | 半透明 | ✅（羽化 0 时是 255）|
| 边缘清除 100 | 同上 | 211，rgb 13,201,13 → **31,157,31** | 边缘去饱和 | ✅ |

### 6.3 校验基线

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 197 条（基线 195；新增 2 条均为 `Cannot find module 'bun:test'`，仓库里 20+ 个既有测试文件都有同一条，属既有环境缺类型，不是本次引入的类型错误） |
| `eslint`（新增文件） | 0 |
| `bun test` | 13 pass |

---

## 7. 已知边界

1. **只作用于 three 合成器路径**（默认路径）。`NEXT_PUBLIC_USE_THREE=0` 回退到 wasm 合成器时抠像不生效 —— 那条路的 `effectPassGroups` 在 Rust 里消化，本次没有改 Rust。
2. **只服务图片 / 视频 clip**。文本、图形、贴纸没有"素材"可抠，tab 不出现。cut-transition 的双帧路径沿用同一份 `resolved.chromaKey`，行为一致。
3. **键色不可动画**（`keyframable: false`）。四个滑杆可打关键帧；键色若动，等于每帧重定义"什么算背景"，语义上说不通，也容易让动画图看起来像闪烁。
4. **未做参照图里的「智能抠像」「自定义抠像」** —— 按需求"先制作色度抠图"，这两个是占位，后续可分别走人像分割模型和蒙版路径。
5. 取色器走 `ColorPicker` 内置的浏览器原生 `EyeDropper`（Chrome 支持，可跨屏幕取色）。**不支持的浏览器**（Firefox/Safari）只剩色板取色，不会报错。

---

*本报告基于本地实现与实测读数，色度阈值手感建议拿实际绿幕素材微调「强度」的映射区间。*
