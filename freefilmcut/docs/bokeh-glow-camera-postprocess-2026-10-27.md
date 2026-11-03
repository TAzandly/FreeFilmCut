# 超级大光斑 → 相机后处理 + vfxpack 导出（2026-10-27 晚）

> 前一版把效果加在了剪辑端 NLE 的 sceneEffect 通道（`effects/definitions/bokeh-glow.ts` + `scene-effect-passes.ts`），方向错误。
> 本版按正确链路实现：**three.js 资源编辑器给相机挂后处理 → 导出 vfxpack → 剪辑端 pack 播放**。

## 链路总览

```
[three.js editor] 相机 PostProcess 面板（下拉新增 超级大光斑/Bokeh Glow）
   camera.userData.postProcessStack.effects[] += { id, type:'bokehGlow', params, exposed }
        │  Viewport buildComposerForCamera → BokehGlowPass（预览即所得）
        │  VfxPackExporter.js 快照整栈进包（含 exposed 勾选）
        ▼
[vfxpack 资源] camera JSON: postProcess { enabled, effects:[{ type:'bokehGlow', params, exposed }] }
        ▼
[剪辑端 freefilmcut] scene-builder 读栈 → three-compositor buildPackComposer
   vfxpack/postprocess/registry.ts 新增 'bokehGlow' 描述符 → BokehGlowPass
   exposed params → mergeLiveParams → applyParams 每帧原地更新（k 帧直接生效）
```

## 改动清单

### 编辑器（D:/GrokbotWork/FreeFilmCut/three.js/editor）
- **新增 `js/postprocessing/BokehGlowPass.js`**：剪映 bokeh.frag 移植。
  - 25×25 网格（i,j∈[-9,9] 步长 .75，r²<50 圆形裁剪）+ 72 圆环采样（r=7、每 5°）≈700 tap；
  - 逐样本权重 `pow(c,9)*40+0.4`（高光主导），最亮样本按 `intensity` 混回；
  - 核跑在 **55% 分辨率 HalfFloat RT**（原包同款省填充率技巧），再双线性放大；
  - 材质 `toneMapped:false` + `NoBlending`，结果**不做 rgb clamp**（保持线性 HDR，交给 OutputPass 调色）；
  - intensity/radius ≤0.001 时直通原图（跳过半分辨率往返）。
- **`js/postprocessing/BuiltinEffects.js`**：注册 `bokehGlow` 描述符
  - `intensity`（强度）0–1.25 默认 0.8；`radius`（光斑半径）0–13 默认 5；
  - `inputs:['camera','texture']`（相机栈与 Text Fx 通用）。
  - UI 自动出现：相机 PostProcess 面板下拉 + paramSchema 滑条 + per-key expose 勾选。

### 剪辑端（freefilmcut/apps/web）
- **新增 `src/vfxpack/postprocess/bokeh-glow-pass.ts`**：编辑器 Pass 的 TS 镜像
  （差异：LDR 契约下结果 clamp 到 [0,1]，与原 GLES2 同空间）。
- **`src/vfxpack/postprocess/registry.ts`**：注册 `bokehGlow`
  （createDefaultParams / createPasses / applyParams，k 帧参数原地更新不重建 composer）。
- **新增 `src/vfxpack/__tests__/bokeh-glow-registry.test.ts`**：4 用例
  （注册与默认值、createPasses 产出、负值 clamp、setSize/dispose 无 GL 依赖）。

## 使用方式

1. 启动资源编辑器（`启动资源编辑器.bat`），选中相机 → PostProcess 面板 → 下拉选 **超级大光斑** → Add。
2. 调 Intensity / Radius 滑条；需要进剪辑端 k 帧的参数勾 expose。
3. File → 导出 vfxpack；剪辑端导入后 pack 相机栈自动带 BokehGlow，
   exposed 参数在剪辑端滑条/关键帧中可直接驱动（`postProcess.<effectId>.<key>` 轨道，导出器已有通路）。

## 校验

- 编辑器：`node --check`（BokehGlowPass.js / BuiltinEffects.js）语法通过；注册时机与 `?v=fcc-ui-112` 同实例，无 registry 分裂风险。
- 剪辑端：bun test 4/4 新增通过；全仓 313 测试，失败项均为既有 masks/snap 基线（不相关）；tsc 154 = 基线不变；eslint 新文件仅剩 Pass 子类固有 3 条 positional-param（与 deep-glow-pass.ts 同款基线）。

## 注意

- 编辑器是 ES module 直载：**BuiltinEffects.js 内容变了但 URL 还是 `?v=fcc-ui-112`**，浏览器请 Ctrl+F5 强刷（或按惯例 bump 版本号）。
- 性能：~700 tap/像素 @55% RT，单效果全屏一次；若多层叠加卡顿，后续可在 Pass 内再加一级降采样。
- 前一版错误位置的 NLE sceneEffect 通道代码已按确认移除（`effects/definitions/bokeh-glow.ts`、`services/renderer/compositor/scene-effect-passes.ts`、three-compositor 接入、animation-targets generic 分支均已还原/删除）；回归后 tsc 154 = 基线、bun test 失败项仍为既有 masks/snap 基线。

---

# 完整移植（2026-10-28 追加）：全部 5 个 pass + 两张贴图

按用户要求从剪映《超级大光斑》包完整移植，不再只搬 bokeh 核心层。

## 链路（编辑器 Pass 内部，与包场景图 1:1）

```
1) 横向 9-tap 高斯（.2/.19/.17/.15/.13/.11/.08/.05/.02，中心权重×mix(10,1,n)，
   unit 按 max(w,h)/1280 归一）                      → rtH 全分辨率
2) 纵向高斯 + clamp01 + filter.png 8×8 LUT（filterIns）
   + noise.png 漏光（R 通道 × luma，noiseIns）        → rtV 全分辨率
3) bokeh 核（~700 tap，amount = 40 + 0.9987×500 = 539.35）→ rtB0 55%
4) bokeh 核第二遍（包里跑两次）                        → rtB1 55%
5) PassOutput 直通双线性拷贝                           → writeBuffer
```

## 滑条映射（ImageBusinessSlider.lua 逐条还原，参数均为 0-1）

| 编辑器参数 | 默认 | 派生 uniform |
|---|---|---|
| size 作用范围 | 1.0 | blurIntensity = size×13；numIntensity = size |
| number 数量 | 0.1 | noiseIns = blurIns = 0.55×(1−number)；horzR = 2−1.5×number |
| intensity 强度 | 0.6 | lightIns = intensity×1.25 |
| filter 滤镜 | 0.2 | filterIns = filter（LUT 混合度） |

- timeIntensity 固定 1（原包 (1-t)⁴ 包络由关键帧替代）；size<0.01 时 bokeh RT 回 100%（同包 pecent=1 分支，避免直通被放大变糊）。
- 修正早前移植偏差：bokeh amount 实为 539.35（此前误用 40）。

## 贴图

- `editor/images/bokeh-glow/{filter,noise}.png`（import.meta.url 相对加载）
- `apps/web/public/effects/bokeh-glow/{filter,noise}.png`（/effects/bokeh-glow/*.png）
- 采样语义与 GLES2 一致：flipY=false、不 sRGB 解码（NoColorSpace）、线性过滤；贴图未加载前对应混合系数置 0（1×1 白 fallback），不阻塞渲染。

## 校验

- 编辑器 node --check 通过；5174 实测 /editor/images/bokeh-glow/filter.png 与 BokehGlowPass.js 均 200。
- 剪辑端：新单测 4/4；tsc 154=基线；eslint 仅剩 3 条 Pass 子类固有 positional-param（与 deep-glow-pass 同款）；3000 端口实测贴图 200。
- 参数集变更：旧版 intensity(0-1.25)/radius(0-13) → 新版 size/number/intensity/filter（0-1）。旧导出包如带 radius 参数会被忽略，请重新导出。

---

# 修复（2026-10-28）：色彩空间导致的光斑"精度不够"

## 症状与排查结论

用户反馈：模糊不如剪映平滑、光斑发"颗粒"。逐行比对原包 shader 后确认：**所有采样数学（高斯权重、unit=0.5×min边/720、pow(c,9)×539.35、圆形裁剪、pass 链传递）均与原包一致**，pass 间传递也是通的（horz→rtH→vert→rtV→bokeh0→rtB0→bokeh1→rtB1→输出）。

**根因是色彩空间**：
- 剪映 GLES2 管线全程 gamma（sRGB 编码）空间运算；
- 我们的 composer（编辑器 PostProcessStack 与剪辑端 pack composer 均是）RenderPass/TexturePass 输出 **linear HalfFloat**，sRGB 转换只在最后 OutputPass 做；
- bokeh 权重 `pow(c,9)` 在线性空间塌缩：中间调 sRGB 0.5 = 线性 0.214，`pow(0.214,9)×539≈0.0006`（占比 0.15%），而剪映里 `pow(0.5,9)×539≈1.05`（占比 72%）→ 中间调几乎不参与模糊，光斑只剩近白高光，观感稀疏发颗粒；LUT 查表与 vert 的 clamp01 同样在错误空间工作。

## 修复

两端 pass 同步（editor/js/postprocessing/BokehGlowPass.js + vfxpack/postprocess/bokeh-glow-pass.ts）：
- 阶段 1（横向高斯）逐采样 `linearToSRGB()` 编码 → 之后所有阶段（纵向高斯+LUT+漏光、bokeh×2）都在 gamma 空间原样运行；
- 最终输出阶段 `sRGBToLinear()` 解码回线性，下游（Bloom/OutputPass 色调映射、pack 合成）的色彩契约不变；
- 新增测试锚点锁定两端转换（防回退），`BokehGlowShaderSources` 导出供测试。

## 校验

编辑器 node --check 通过；剪辑端 5/5 单测、tsc 154=基线、eslint 3 条=deep-glow 同款基线。刷新编辑器（Ctrl+F5）后用剪映同参数（大小100/数量10/强度60/滤镜42）对比。

---

# 修复（2026-10-28 续）：贴图 colorSpace 字面量导致上传崩溃

报错 `Cannot read properties of undefined (reading 'primaries') at getPrimaries/uploadTexture`。原因：`tex.colorSpace = 'NoColorSpace'` 用了字面量——three.js 里 `NoColorSpace` 常量的实际值是空字符串 `''`，`'NoColorSpace'` 不是注册过的色彩空间名，`getColorSpace()` 查表返回 undefined，纹理首次上传即崩。两端 pass（编辑器 BokehGlowPass.js + 剪辑端 bokeh-glow-pass.ts）各 2 处（filter.png / noise.png）均改为 `import { NoColorSpace } from 'three'` 后赋常量。校验：编辑器 node --check；剪辑端 tsc 154=基线、5/5 单测、lint 3 条=基线。

---

# 修复（2026-10-28 续 2）：刚加效果时光晕异常大，点一下参数后变小

## 排查结论：不是参数没传，是贴图异步加载的空窗期

栈侧链路核实为正确：`createDefaultEffectEntry` 创建时就带 `createDefaultParams()`；`buildComposerForCamera` 在 `createPasses` 后立即 `applyParams(passes, {...defaults, ...entry.params})`；param 编辑走 `syncComposerParams`（applyParams 原地，不重建）。pass 内部默认值与 createDefaultParams 完全一致。

**真正原因**：filter.png / noise.png 由 `TextureLoader` 异步加载。加载完成前 `filterIns=0`、`noiseGate=0`——没有 LUT 调色、没有漏光压暗。实测 **noise.png 平均亮度仅 0.103**（1024²，极暗絮状图），`数量=0.1` 时 `noiseIns=0.495`：贴图到位后亮部被 `mix(rgb, rgb×0.103, 0.495)` 直接砍半 → 光晕骤然变小。用户点参数的时间恰好撞上贴图加载完成，误以为是参数生效。

剪映原包无此问题：贴图随包加载完成才出第一帧。

## 修复（两端同步）

- 新增 `_filterResolved/_noiseResolved/_texturesPending` 状态；任一贴图 resolve（成功或失败）后解除。
- 贴图未就绪期间整个 pass **直通输出**（CopyShader 原样拷贝 readBuffer→writeBuffer，不做 sRGB 解码），不再显示"无漏光"中间态；失败路径与旧 fallback 语义一致（白图 + 混合系数 0）。
- 编辑器 `BokehGlowPass.js` 新增 `_copyMaterial`；剪辑端 `bokeh-glow-pass.ts` 新增 `COPY_SHADER_FRAGMENT` + `_copyMaterial`，dispose 同步释放。

## 校验

编辑器 node --check 通过；剪辑端 tsc 154=基线、5/5 单测、lint 3 条=基线。刷新后行为：加效果瞬间无效果 → 数百毫秒后完整效果一次性出现（与剪映一致）。
