# 后处理栈（Post Process Stack）

Unity 风格后处理栈，在 **FreeFilmCut Three.js Editor** 与 OpenCut 共享同一 HDR 约定。

## 架构

```
Scene --RenderPass--> Effect A --> Effect B --> ... --> OutputPass --> (FXAA) --> screen
```

- 数据存在 `userData.postProcessStack`
- 运行时：EffectComposer + three/addons/postprocessing/*
- Bloom：**stock `UnrealBloomPass`**（Editor 与 OpenCut 相同；仅 strength / radius / threshold）

### Bloom 与 tone mapping（重要）

**Text-anim / pack contract**: Exporter writes live Config toneMapping. Pack `none` stays NoToneMapping on clip (no Neutral remap). When OutputPass is none, both editor PostProcessStack and OpenCut composer insert **LdrPreBloomClampPass** before bloom/deepGlow (LDR bloom). Neutral/ACES keep HDR bloom. Text-anim Bloom RT = authored project resolution (not preview undersample).


UnrealBloomPass 需要**线性 HDR**。故整个 `composer.render()` 期间将 `renderer.toneMapping` 设为 `NoToneMapping`；仅 OutputPass（PostProcessStack / OpenCut composer 里包装过）应用项目/包的 tone mapping（若为 NoToneMapping 则保持 NoToneMapping（仍做 sRGB encode；若为 none，则在 bloom 前做 LDR clamp，OutputPass 仅 sRGB；不做 none→Neutral 静默回退））

旧默认 `threshold: 0.85` 适合官方 emissive 演示；对普通场景经常几乎看不见效果；加载时仅把 `threshold === 0.85` 迁移为 `0.0`。`blurIterations` 已移除（加载/导出时丢弃）。

### Bloom 参数

| 参数 | 默认 | 范围 | 说明 |
|------|------|------|------|
| threshold | 0.0 | 0-1 | 亮度阈值；普通场景建议保持较低 |
| strength | 2.0 | 0-5 | 泛光强度 |
| radius | 0.5 | 0-1 | 泛光半径 |


### Safe frame / letterbox（Editor）

EffectComposer 与 Bloom RT 尺寸为 **项目安全框分辨率**（`project/resolution/width x height`），不是全画布或屏幕 CSS letterbox 像素。Beauty + PP 在该 RT 上完成后，再 blit 到视口安全框内区；黑边（letterbox bars）不参与 Bloom 采样。这样 Editor 与 OpenCut/导出的相机画面一致。


### Deep Glow（剪映 Deep_Glow 算法自研版）

与 stock Bloom（UnrealBloomPass）不同：按剪映 `Deep_Glow` 管线重写——能量图（luma/alpha）→ 多半径打包高斯（RGBA 各半径，SAMPLE1/2 两趟）分离 H/V（gamma 2.4）→ Screen 叠 8 层 → `pow(intensity*0.5, 1/2.4)` → 与原图 Screen 后再自 Screen → 加回原图。

| 参数 | 默认 | 范围 | 说明 |
|------|------|------|------|
| intensity | 1.2 | 0-5 | 对应 u_GlowIntensity |
| threshold | 0.0 | 0-1 | 能量阈值 |
| radius | 1.0 | 0.1-3 | 模糊步长（DownSample 倍率） |

Registry type: `deepGlow`（camera + texture）。不引入剪映 noise 贴图。

### 颜色反转 Invert

`1.0 - rgb`，再与原图按混合强度混合（`mix(input, inverted, intensity)`）；alpha 通道不变。

| 参数 | 默认 | 范围 | 说明 |
|------|------|------|------|
| intensity | 1.0 | 0-1 | 0=原图面，1=完全反转 |

## 怎么用

1. 打开 Editor，选中 PerspectiveCamera
2. 右侧「后处理」栈里 Add → 选择效果（Bloom / **Deep Glow** / 胶片颗粒 / 颜色反转 / FXAA）
3. 视口实时预览；调整混合强度可看到原图与反转混合
4. 效果栈随 camera.userData 持久化，导出 vfxpack 含 `postProcess` 字段

## 关键文件

| 文件 | 作用 |
|------|------|
| postprocessing/PostProcessRegistry.js | 注册表 |
| postprocessing/BuiltinEffects.js | Bloom / Deep Glow / Film / Invert / FXAA |
| postprocessing/DeepGlowPass.js | Deep Glow Pass（JY 算法）
| postprocessing/InvertColorPass.js | 颜色反转 Pass |
| postprocessing/PostProcessStack.js | Composer 构建（HDR/LDR + Output tone map；none 时 LdrPreBloomClampPass） |
| Viewport.js | letterbox 视口 + NoToneMapping 下 composer.render |
| Sidebar.Object.PostProcess.js | 编辑 UI |
| OpenCut `vfxpack/postprocess/composer.ts` | 同样 OutputPass wrap |
| OpenCut `three-compositor.ts` | composer.render 前强制 NoToneMapping |

## OpenCut exposed params

See [exposed-params-keyframes.md](./exposed-params-keyframes.md).

## Text Fx（与相机共用 Registry）

- 效果定义：同一 `PostProcessRegistry` / OpenCut `vfxpack/postprocess/registry`
- 相机：`camera.userData.postProcessStack` → `buildComposerForCamera`（RenderPass）
- 文字：`fccUI.textFxStack` → Text RT 之后 `buildTextureFxComposer`（TexturePass）
- **不要**把单条文字 Fx 写进相机栈
- 文字 RT 多为 sRGB8；Bloom 参数与相机共用，但非 HDR 精度；Invert 最适合验证


## Default 背景 + Alpha

- `backgroundType === 'Default'`：beauty clear 为 `(0,0,0,0)`，canvas `alpha: true`
- Color / Texture / Equirect：仍不透明 clear（a=1）
- Letterbox 黑边仍是不透明 UI chrome；安全框内空像素可透视棋盘格
- Bloom：模糊不再写死 `a=1`；Deep Glow：`alpha = max(ori.a, glow.a)`
