# Bokeh Glow（超级大光斑）场景特效 — three 路径落地

日期：2026-10-27
参照物：剪映特效包 `D:\GrokbotWork\FreeCapCutEffect\特效\超级大光斑`（AmazingFeature，bokeh.frag 已完整逆向，见工作日志）

## 需求

- 在编辑器中实现剪映"超级大光斑"后处理（高光加权大核散景）。
- 动画不走包内置的 (1-t)^4 时间包络，而是**由关键帧 k 值驱动**（用户在时间线打关键帧控制 intensity/radius）。

## 架构判断（为什么走这条路）

1. 泛型 effects（`effects/definitions`）的 passes 原本只有两条出路：wasm `applyEffectPasses`（Rust 侧只注册了 gaussian-blur，加新 shader 走不通）和 **three 合成器 —— 而后者对 sceneEffect 是 no-op**（`three-compositor.ts` 原注释 "Built-in scene effects (blur etc.): still no-op in Three MVP"）。
2. 结论：**在 three 合成器里把 sceneEffect 的 passes 真正执行起来**，bokeh-glow 作为第一个内建 shader。泛型 EffectLayerNode 的关键帧采样（`resolveEffectLayerNode` 已逐参数 `resolveAnimationPathValueAtTime`）是现成的，打通执行层后关键帧自然生效。
3. vfxpack postprocess 栈（bloom/deepGlow）只作用于 pack 场景内部，不适用于任意素材上的独立特效轨道，不采用。

## 改动清单

| 文件 | 内容 |
|---|---|
| `effects/definitions/bokeh-glow.ts`（新） | 定义：`intensity` 0–1.25（默认 0.8，滑条）、`radius` 0–13（默认 5，滑条）；`buildPasses` 输出 `{shader:"fcc-bokeh-glow", uniforms:{u_intensity,u_radius,u_texel}}`；intensity/radius ≤0.001 时输出空 pass（零成本直通）。texel 数学与剪映一致：`rescale=min(w,h)/720`，`u_texel=0.5*rescale/[w,h]` |
| `effects/definitions/index.ts` | 注册进 `defaultEffects`（资产面板 `effectsRegistry.getAll()` 自动出现，点击即插入 effect 轨道） |
| `services/renderer/compositor/scene-effect-passes.ts`（新） | `SceneEffectPassRunner`：全屏 quad + 按 shader 名缓存的 ShaderMaterial + 两块 ping-pong HalfFloat RT；**最后一个 pass 直接渲染进 accumRT**（单 pass 特效=恰好一次全屏 draw）；uniform 数字→float、数组→Vector2/3/4；未知 shader 名一次性 warn 后跳过。GLSL 注释保持无反引号（blend-mode 的老坑） |
| `services/renderer/compositor/three-compositor.ts` | sceneEffect 非 pack 分支从 no-op 改为调用 runner（source=accumRT.texture，target=accumRT）；`effectPassGroups.flat()`；新增字段 `sceneEffectRunner`（懒初始化；合成器无全局 teardown，无需挂 dispose） |
| `timeline/animation-targets.ts` | `buildVfxPackStandaloneParamDescriptor` 增加 generic 分支：非 vfxpack 的 EffectElement 用 `effectsRegistry` 定义参数作为关键帧目标（此前只支持 vfxpack exposed params） |
| `effects/definitions/__tests__/bokeh-glow.test.ts`（新） | 8 用例：注册、pass uniforms/texel 数学、零参直通、默认值回退、shader 源锚点（pow9/网格/圆环/mix maxColor）、关键帧 descriptor 读写、未知参数返回 null |

## Shader 移植要点（bokeh.frag → fcc-bokeh-glow）

- 25×25 网格采样（-9..9 步长 0.75，`dot<50` 圆形裁剪）+ 72 个圆环采样（半径 7、每 5°）≈ 700 tap，保持原核大小。
- 权重 `pow(c,9)*40 + 0.4`（逐通道）→ 亮部主导；`maxColor` 按 `u_intensity` 混回 → 光斑核心透亮。数学与剪映逐行对应。
- **色彩空间**：合成器 RT 是 HalfFloat 且存的是 sRGB 编码值；自定义 ShaderMaterial 不含 three 的 colorspace chunks → 采样得原始存储值、写回不做转换 → pow9 与剪映 GLES2 同空间。Round-trip 中性（直通帧像素不变）。
- 原版的 timeIntensity 包络、LUT（filter.png）、噪声遮罩（noise.png）**不做**——包络被关键帧取代；LUT/噪声是风格化附加项，后续可作为第三个参数加。

## 关键帧使用方式

1. 资产面板 → Effects → **Bokeh Glow** → 点击添加（插入 effect 轨道，起点=播放头）。
2. 选中特效 clip → Effect 面板：Intensity / Radius 滑条，带关键帧菱形。
3. 打 k 帧后每帧由 `resolveEffectLayerNode` 采样 → uniforms 每帧更新（例如 intensity 从 1.25 k 到 0 即复刻剪映的淡出包络，节奏自控）。

## 校验

- `bun test src/effects/definitions/__tests__/bokeh-glow.test.ts` 8 pass；全仓 304 pass / 5 fail（fail 全在 masks/snap、keybindings、placement，不 import 改动文件，属既有基线）。
- tsc 全仓 **154 条 = 基线不变**，改动文件 0 新增。
- eslint 改动文件 0 error（修了 1 处 prefer-object-params、2 处 unsafe-assertion）。
- dev server `http://localhost:5174/editor` 200。
- 未做：浏览器 E2E（agent-browser 未安装）；wasm 回退路径（NEXT_PUBLIC_USE_THREE=0）不认识 fcc-bokeh-glow，会 warn 跳过（预览小图 tile 同理，显示原图）。

## 已知边界

- ~700 tap 全屏在 1080p 属重 shader（剪映原版靠 55% RT 省填充率）。若实测贵，下一步：runner 支持 pass 级降采样（bokeh 本身是模糊，半分辨率无损观感），或半径大时自动降 internal res。
- 效果作用于"其下所有层"（accumRT 全帧），与剪映特效轨语义一致；不能作用于单图层（那是 `element.effects[]` 的 effectPassGroups，three 路径仍未接，另行处理）。
