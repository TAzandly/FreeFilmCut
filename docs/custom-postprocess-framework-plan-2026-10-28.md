# 配置式自定义后处理框架（方案）

> 日期：2026-10-28
> 目标：不写任何新的后处理脚本，只在编辑器 UI 里"配"出一个后处理效果（如超级大光斑），并一键导出给剪辑端使用。

---

## 1. 核心思路

现状：每加一个效果 = 手写一个 Pass 类（编辑器 JS）+ 一个 TS 镜像（剪辑端）+ registry 注册 + Sidebar UI 注册。四份代码。

目标：**效果 = 一份 JSON 定义（CustomEffectDefinition）**。运行时只有一个通用执行器，双端各写一次：

- 编辑器端：`CustomEffectRuntime.js`（校验定义 → 生成 pass 链）
- 剪辑端：`custom-pass.ts`（同一份定义在 vfxpack 里重建 pass 链）

写新效果 = 填 JSON（在 UI 上完成），零代码改动。

---

## 2. 效果定义数据模型（CustomEffectDefinition）

```jsonc
{
  "id": "bokeh-glow-custom",          // 全局唯一，registry key = "custom:" + id
  "name": "超级大光斑",
  "version": 1,

  // ---- 全局参数（所有 pass 可引用同名 uniform）----
  "params": [
    { "key": "size",     "type": "float", "default": 1.0,  "min": 0, "max": 1, "label": "大小", "expose": true },
    { "key": "number",   "type": "float", "default": 0.1,  "min": 0, "max": 1, "label": "光斑数", "expose": true },
    { "key": "intensity","type": "float", "default": 0.6,  "min": 0, "max": 1, "label": "强度", "expose": true },
    { "key": "tint",     "type": "color", "default": "#ffffff", "label": "染色" },
    { "key": "offset",   "type": "vec2",  "default": [0, 0], "label": "偏移" }
  ],

  // ---- 贴图资源 ----
  "textures": [
    { "name": "filter", "source": "image", "path": "bokeh-glow/filter.png", "colorSpace": "srgb" },
    { "name": "noise",  "source": "image", "path": "bokeh-glow/noise.png",  "colorSpace": "none" }
    // { "name": "xxx", "source": "rt", "ref": "<外部RT名>" }  ← 编辑器内可选引用场景 RT
  ],

  // ---- pass 链：按数组顺序执行，后项只能引用先项的输出（天然无环）----
  "passes": [
    {
      "name": "horzBlur",
      "downsample": 1,                       // 输出 RT = 链分辨率 / N，允许 1/2/4/8
      "colorSpace": "linear",                // linear(默认，直通不转换) | gamma(移植兼容模式，见下"色彩空间策略")
      "inputs": { "uInput": "uInput" },      // 输入映射，见 §3；值为保留字/引用语法，省略时按约定自动绑定
      "fragmentShader": "…GLSL…",            // 片元着色器（可编辑）
      "vertexShader": "default",             // 同样可编辑："default" = 内置全屏 VS；也可写内联 GLSL
                                             // 省略该字段 = 等价于 "default"；
                                             // UI 中顶点编辑器预填内置默认源码作为起点，可随意修改；
                                             // 用于 UV 扰动 / 镜像 / 极坐标 / 网格变形等非全屏直通场景
      "output": { "rt": "blurH" }            // 写入命名 RT；最后一个 pass 可省略 = 效果输出
    },
    {
      "name": "vertBlur",
      "downsample": 1,
      "colorSpace": "gamma",
      "inputs": { "uInput": "$rt:blurH", "uFilter": "$tex:filter", "uNoise": "$tex:noise" },
      "vertexShader": "default",
      "fragmentShader": "…GLSL…",
      "output": { "rt": "blurV" }
    },
    {
      "name": "bokeh0",
      "downsample": 2,                       // 大光斑原版就是 55% RT → downsample 2 近似
      "inputs": { "uInput": "$rt:blurV" },
      "vertexShader": "default",
      "fragmentShader": "…GLSL…",
      "output": { "rt": "bokeh0" }
    },
    {
      "name": "bokeh1",
      "downsample": 2,
      "inputs": { "uInput": "$rt:bokeh0" },
      "vertexShader": "default",
      "fragmentShader": "…GLSL…",
      "output": { "rt": "bokeh1" }
    },
    {
      "name": "composite",                    // 最后一个 pass：无 output.rt → 写回主链
      "inputs": { "uInput": "$rt:bokeh1" },
      "vertexShader": "default",
      "fragmentShader": "…GLSL…"
    }
  ]
}
```

要点：

- **参数即 uniform**：`params[].key` 直接是 shader 里的 uniform 名，类型 float/vec2/vec3/vec4/color/bool/int 自动映射 GLSL 类型与 UI 控件。
- **expose: true** 的参数进入现有 exposed params / k 帧体系（编辑器和剪辑端零新增动画代码）。
- **贴图 colorSpace** 沿用大光斑教训：`srgb`（filter LUT）与 `none`（noise 漏光）分开声明，import 常量 `NoColorSpace`，禁止字面量。
- **colorSpace（默认 "linear"）**：链路契约与 Unity / Godot / Unreal 等现代引擎一致——全程线性计算，OutputPass 统一编码。"gamma" 只是移植兼容模式，详见下节。

### 色彩空间策略（默认线性，gamma 仅作移植兼容层）

主链与所有 pass 的默认契约：

- RenderPass 输出**线性 HalfFloat，所有 pass 默认在线性空间计算**（`colorSpace: "linear"`，框架不做任何转换）；
- 色调映射 + sRGB 编码只在链尾 OutputPass 发生一次；
- 贴图按声明 colorSpace 采样：`srgb` 贴图由硬件解码到线性，`none` 原样字节。

`colorSpace: "gamma"` **不是默认推荐路径，而是移植兼容模式**，服务"把 gamma 空间管线里编写的特效原样搬进来"这一种场景：

- 剪映 GLES2 特效包全程运行在 8-bit gamma 空间，其数学（pow(c,9) 权重、LUT 查表、逐通道非线性系数）按 sRGB 编码值标定；
- 这类 shader 直接喂 linear 数据会塌缩：实测 sRGB 0.5 = linear 0.214，pow(0.214,9)×539 ≈ 0.06%，而 gamma 空间同式 ≈ 72%——不是算法错，是输入值编码不同；
- gamma 模式 = 框架在该 pass 输入端逐采样 `linearToSRGB`、输出端 `sRGBToLinear`（注入 GLSL 前缀），等价于"给这个 pass 造一个局部 gamma 空间"，旧特效不改算法即可搬进现代线性管线。

判断规则：**新写的 shader 一律 linear；从剪映/旧引擎移植、且含 pow / 查表 / 逐通道权重的，该 pass 单独开 gamma。**

---

## 3. 输入引用语法（inputs 映射）

三个**管线保留字**（两端现有约定，framework 直接复用，不另造语法）：

| 保留字 | 含义 | 现有约定出处 |
|---|---|---|
| `uInput` | 主链输入当前画面（相机 PP 链 = 上游 composer 画面；剪辑端 = 当前剪辑/下方轨道合成帧） | `below-input.ts`（别名 belowInput / iChannel0），NLE 自动绑定 |
| `uTransitionFrom` | 转场出画 A（切口前一帧合成） | `transition-input.ts`（别名 uFrom / transitionFrom），NLE 转场渲染时绑定 |
| `uTransitionTo` | 转场入画 B（切口后一帧合成） | `transition-input.ts`（别名 uTo / transitionTo），NLE 转场渲染时绑定 |

每 pass 的 inputs 是"uniform 名 → 来源"映射，来源可用：

| 来源写法 | 含义 |
|---|---|
| `"uInput"` / `"uTransitionFrom"` / `"uTransitionTo"` | 绑定对应管线保留字画面 |
| `"$prev"` / `"$prevN"` | 本效果内上一个 / 前 N 个 pass 的输出 |
| `"$rt:<name>"` | 本效果内某 pass 的命名输出 RT |
| `"$tex:<name>"` | 效果定义的贴图资源 |

规则：

- **约定优先，显式可选**：shader 里只声明 `uniform sampler2D uInput;` 而 inputs 省略时，运行时按约定自动绑定（对齐 scene-builder 的自动建槽行为）；inputs 映射用于显式选择——比如把转场画面喂给自定义 uniform 名（`"uMask": "uTransitionFrom"`），或实现"上N个pass"的多输入。
- **配套 Size uniform 自动跟随**：绑 `uTransitionFrom/To` 时同步写 `uTransitionFromSize/uTransitionToSize`（vec2 像素尺寸），沿用 transition-input.ts 行为。
- **上下文缺失兜底**：转场画面只在剪辑端转场切口渲染时存在。编辑器相机 PP 预览无此上下文 → 绑 1×1 黑 placeholder + 面板黄标提示（对齐现有 1×1 placeholder 约定）；效果编辑面板可给 From/To 指定**预览代理贴图**（仅编辑器预览用，不导出），便于在编辑器里调转场效果。
- `$rt:` 只能引用**数组中更早**的 pass 输出 → 结构上不可能成环，无需运行时环检测。
- 校验：引用不存在的 rt/tex → 定义校验失败，UI 报错；运行时该 uniform 绑黑色 1×1 fallback 贴图。

---

## 4. 通用运行时（ConfigurablePass）

### 编辑器端 `three.js/editor/js/postprocessing/CustomEffectRuntime.js`

```
validateDefinition(def) → { ok, errors[] }
buildCustomEffectDescriptor(def) → registry descriptor
   // 内部为每个 pass new ConfigurablePass(def, passDef, ctx)
registerCustomEffect(def) → registerEffect('custom:' + def.id, descriptor)
unregisterCustomEffect(id)
```

`ConfigurablePass extends Pass`（仿 BokehGlowPass 的骨架）：

- 构造：按 passDef 建 `ShaderMaterial`（预置 uniform：`uTexel`、`uResolution`、`uTime`、`uFrame` + params 全集 + inputs 全集）、`FullScreenQuad`、按 downsample 建输出 RT（HalfFloat / RGBA）。
- `render()`：绑定 inputs 引用的贴图 → fsQuad 渲到输出 RT 或主链 buffer。
- `applyParams(params)`：数值型直接写 uniform.value（k 帧每帧更新，无需重建）。
- `setSize()`：按 downsample 比例重建 RT（PostProcessStack 已有尺寸变更重建链路，复用即可）。
- **编译护栏**：材质编译异常（`renderer.debug.checkShaderErrors` + onBeforeCompile 捕获）→ 自动切换为内置 CopyShader 直通，console.error 输出 GLSL 报错原文，Sidebar 显示红色状态标记。**坏 shader 永远不黑屏**。
- **贴图门控**：image 类贴图异步加载未 resolve 期间整 pass 直通输出（沿用大光斑 `_texturesPending` 方案，含失败也放行）。

接入 `PostProcessRegistry`：每个自定义效果注册为独立 type（`custom:<id>`），复用现有 `createPasses / applyParams / paramSchema` 描述符协议、`structureSignature` 重建判断（定义内容变更 → 把 def 内容 hash 拼进 entry.type 或 params 触发重建）。

### 剪辑端 `vfxpack/postprocess/custom-pass.ts`

- TS 镜像同一套逻辑（LDR clamp、HalfFloat、NoColorSpace 常量 import）。
- registry.ts 增加 `loadCustomDefinitions(defs)`：pack 加载时批量注册 `custom:<id>`。
- exported params（expose:true）自动进入现有 `mergeLiveParams → applyParams` k 帧链路，零新增动画代码。
- 贴图从 pack 资产路径加载，同样走就绪门控。

---

## 5. 编辑器 UI（Sidebar.Object.PostProcess 扩展）

新增"自定义效果"入口：

1. **效果列表**：已保存的自定义效果（新建 / 导入 JSON / 导出 JSON）。
2. **效果编辑面板**（新增 `Sidebar.Object.PostProcess.Custom.js`）：
   - Pass 列表：增 / 删 / 上下移；每项显示名称、downsample、输出 RT 名。
   - Pass 明细：
     - 输入表：uniform 名 → 下拉选 `uInput` / `uTransitionFrom` / `uTransitionTo` / `$prev` / `$prevN` / `$rt:*` / `$tex:*`；转场源可另指定编辑器预览代理贴图
     - 片元 / 顶点着色器编辑器（等宽 textarea，monospace；后续可升级 CodeMirror）——**两个都可编辑**：顶点编辑器预填内置全屏 VS 源码作为起点，可直接修改（UV 扰动 / 镜像 / 极坐标等），提供"恢复默认"按钮把内容还原为内置 VS
     - 编译状态行（绿：编译通过 / 红：报错原文）
     - 降采样下拉：1× / 2× / 4× / 8×
     - 色彩空间开关：linear / gamma
   - 参数表：key、类型下拉（float/vec2/vec3/vec4/color/bool/int）、default、min、max、标签、"暴露到 k 帧"勾选。
   - 贴图表：名字、来源（本地图片上传 / RT 引用）、colorSpace。
3. **持久化**：定义存在相机所在工程 JSON（`userData.postProcessStack` 的 entry 增加 `definition` 字段）+ 全局自定义效果库（编辑器 localStorage / 工程文件），支持导出/导入 JSON 文件。
4. **预览**：挂在 `camera.userData.postProcessStack`，走现有 rebuild 机制，编辑即所见。

---

## 6. 生命周期：新建 → 保存 → 复用 → 分发

### 怎么新建一个自定义后处理

编辑器右侧相机属性面板 → PostProcess 区块 → "自定义效果"分类 → 新建：

1. 命名 → 生成空白定义（初始 1 个 pass：`uInput` → copy 直通输出）；
2. 逐 pass 编辑：片元/顶点 shader、输入来源（下拉：`uInput` / `uTransitionFrom` / `uTransitionTo` / `$prev` / `$rt:*` / `$tex:*`）、降采样、输出 RT 名；
3. 参数表加 float / vec2-4 / color 等参数，勾"暴露到 k 帧"；
4. 贴图表上传本地图片（存入编辑器贴图目录，路径写回定义）；
5. 面板把效果挂到当前相机 `postProcessStack`，视口实时预览，随调随看。

### 文件保存在哪（三层）

| 层 | 位置 | 说明 |
|---|---|---|
| 工程内引用 | 当前工程 JSON（`camera.userData.postProcessStack` 的 entry 挂 `definition`） | 保存工程即保存，随工程走；entry.params 只存参数值，shader 不重复 |
| 编辑器效果库 | `<编辑器工程目录>/custom-effects/<id>.json` | 面板上"保存到效果库"落盘；编辑器启动时扫描该目录自动注册 → 任何工程都能在列表里看到并一键添加 |
| 分发包 | `<name>.vfxpack`（zip：definition JSON + 贴图文件 + exposed 参数 k 帧轨道） | 复用现有 VfxPackExporter，type=Effect |

### 做好的效果怎么被编辑器使用

- **当前工程**：定义已挂在相机栈上，保存工程即完成；下次打开自动还原。
- **其他工程**：把 `<id>.json` 放到该工程的 `custom-effects/` 目录（或用面板"导入 JSON"按钮）→ 编辑器扫描注册后出现在效果列表 → 一键添加到任意相机。
- 编辑中的定义修改后，"保存到效果库"会同步更新库文件（同 id 覆盖 + version 递增）。

### 怎么被剪辑端使用

1. 项目面板 → VFX PACK → type=Effect → 导出 `<name>.vfxpack`（definition + 贴图 + k 帧轨道打进 zip）；
2. 两种方式进剪辑端：
   - **内置库**：复制到 `freefilmcut/apps/web/public/vfxpacks/effects/`，并把文件名登记进同目录 `effects/index.json` → 剪辑端启动自动加载注册（沿用 load-builtin-packs 机制）；
   - **手动导入**：剪辑端特效库 UI 手动导入 .vfxpack 文件；
3. 剪辑端 pack 加载器读到 `customEffects` → `loadCustomDefinitions()` → `custom:<id>` 注册进 postprocess registry → 特效库里出现该效果 → 拖到片段，exposed 参数直接 k 帧。

### 一次完整流程示例（超级大光斑配置版）

编辑器新建"超级大光斑" → 填 5 个 pass（HorzBlur/VertBlur/Bokeh0/Bokeh1/Composite）→ 上传 filter.png + noise.png → 4 个滑条勾"暴露" → 挂相机调到满意 → 保存到效果库（`custom-effects/bokeh-glow-custom.json`）→ VfxPack 导出 → 放进 `public/vfxpacks/effects/` + 登记 index.json → 剪辑端重启后特效库可见，拖到片段即可用，全程未写一行代码。



## 7. vfxpack 导出（打包分发实现）

VfxPackExporter 扩展：

- `customEffects: [definition…]` 写入 pack JSON（shader 内联）。
- 贴图文件复制进 pack 资产目录（如 `effects/custom/<id>/filter.png`），definition 里 path 指向 pack 内相对路径。
- 剪辑端 pack 加载器读到 `customEffects` → `loadCustomDefinitions()` → stack 里 `custom:<id>` 正常命中。

---

## 8. 验收标准（用超级大光斑反向验证表达力）

把现有 BokehGlowPass 的 5-pass 完整改写成一份 CustomEffectDefinition（HorzBlur → VertBlur(+filter+noise) → Bokeh0 → Bokeh1 → Composite，其中含 pow/LUT 数学的 pass 声明 gamma 兼容模式、两张贴图、4 个 expose 参数）：

- 编辑器中配置版与手写版渲染结果一致（同参数逐像素误差 ≤ 1/255 或 SSIM ≥ 0.999）。
- 剪辑端加载 pack 配置版，k 帧四滑条行为与手写版一致。
- 写坏一个 shader（语法错误 / 引用不存在的 RT）→ 直通输出 + 明确报错，不崩溃不黑屏。

达到这三条即证明框架表达力足够，之后所有新效果只配不写。

---

## 9. 分期实施

| 阶段 | 内容 | 涉及文件 | 验收 |
|---|---|---|---|
| P1 | 数据模型 + 定义校验 + ConfigurablePass（单输入、float/color 参数、RT 输出、downsample、编译护栏）✅ **已完成 2026-10-28**：`CustomEffectRuntime.js`（校验/ConfigurablePass/注册/指纹重建联动/两个示例效果 demo-tint、demo-blur）、PostProcessStack 注册联动 + definition 指纹入 signature、Sidebar 下拉动态刷新；控制台 API `__fccCustomPostEffects`；node --check 全过 | `CustomEffectRuntime.js`（新）、`PostProcessRegistry.js`（+unregisterEffect）、`PostProcessStack.js`（微调）、`Sidebar.Object.PostProcess.js`（下拉刷新） | 编辑器选中相机 → 添加"自定义·染色示例/两通道模糊示例"实时预览 |
| P2 | 多输入（$prev/$rt:/$tex:）、gamma 色彩空间注入、贴图上传与门控、完整编辑面板 UI ✅ **已完成 2026-10-28**：`Sidebar.Object.PostProcess.CustomEditor.js`（pass 增删排序/输入映射下拉含 $rt:/$tex: 动态项/FS+VS textarea+恢复默认/downsample+colorSpace+输出RT/参数表全类型/贴图 dataUrl 上传/应用·存库·导出）；Sidebar 增加"新建自定义效果/导入JSON"；效果库 `custom-effects/*.json` 扫描与保存（`scanCustomEffectsLibrary`/`saveCustomEffectToLibrary`）；贴图以 dataUrl 存入定义 JSON（自包含，P3 导出时解码为 pack 文件） | `Sidebar.Object.PostProcess.CustomEditor.js`（新）、`Sidebar.Object.PostProcess.js`、`CustomEffectRuntime.js`（+createBlank/dataUrl/库扫描） | 选中相机 → 新建自定义效果 → 编辑定义 → 应用即预览；存库后重启自动恢复 |
| P3 | 剪辑端 TS 镜像 + vfxpack 导出/加载 + k 帧参数打通 | `custom-pass.ts`（新）、`registry.ts`、VfxPackExporter、`__tests__/custom-pass.test.ts`（新） | 配置版效果在剪辑端 k 帧驱动 |
| P4 | 验收：超级大光斑配置化重写 + 预设库（把常用效果沉淀为一键 JSON） | `presets/*.json` | §8 三条验收全过 |

P1+P2 是框架主体；P3 量小（镜像逻辑已经在 BokehGlowPass 双端做过一次，模式熟）；P4 是最有成就感的一步。

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 用户 shader 编译失败 | 编译护栏直通 + 报错原文回显（绝不黑屏） |
| GLSL ES 2.0 兼容（texture() vs texture2D()） | shader 预处理注入：编辑器/剪辑端统一 GLSL1 风格，文档约定 texture2D |
| RT 数量与显存 | downsample 下限 8；命名 RT 复用（同名同尺寸复用 buffer）；pass 删除即释放 |
| 定义版本演进 | def 带 version 字段 + 校验器做向后兼容迁移（类似 migrateBloomParamsOnce 的思路） |
| 双端行为漂移 | 校验测试锚点：`BokehGlowShaderSources` 同款做法，custom-pass 导出 uniform 绑定函数供测试比对 |

---

*本方案基于现有 PostProcessRegistry / PostProcessStack / vfxpack registry 架构静态分析得出，实施时按实际联调微调。*

## 2026-10-28 补充：P2 用户反馈修复（$camera / 参数类型 / 贴图绑定）

1. **新增 `$camera` 输入源**：相机原始画面。PostProcessStack 检测到启用的自定义效果引用 `$camera` 时，在 RenderPass 后插入 BeautyCapturePass（needsSwap=false，拷贝 beauty 到专用 HalfFloat RT），`ctx.__fccBeautyTexture` 传入 createPasses。与 `uInput` 的区别：uInput = 链输入（effect 排在其它效果后面时是上一效果输出），$camera 永远是相机原始渲染。文本链（buildTextureFxComposer）中 $camera = 输入贴图。
2. **参数类型补全**：buildParamSchema 增加 vec2/3/4（size 字段）；条目侧参数行渲染 vec 为多个 UINumber；编辑器面板 vec 默认值从 JSON 文本改为数字组；类型切到 vec 时自动归一化 default 为定长数组（防 createDefaultParams 崩溃）；setParamUniform 对短数组 pad 到 4 位防 NaN；应用后 rebuildList() 刷新条目参数行。
3. **贴图绑定修复**：①按名字自动绑定——shader 里 `uniform sampler2D tex1;` 与贴图 tex1 同名即自动绑（无需 inputs 映射）；②校验新增 warnings：声明了 sampler 但无任何映射 → 黄色提示（未绑定 sampler 会采到 unit 0 垃圾数据，这是"贴图无效"的最常见根因）；③sampler uniform 初始值绑 1×1 fallback 而非 null；④贴图槽支持 source:'rt' 实时引用 pass 输出 RT；⑤编辑面板贴图行加缩略图预览 + 图片/RT 源切换。
4. 版本 tag 统一升级：CustomEffectRuntime/CustomEditor/Sidebar.Object.PostProcess → fcc-ui-114，PostProcessStack → fcc-ui-164（含 Viewport/TextLayerRT/PreviewCapture 三个引用点同步）。

## 2026-10-28 补充 2：实时预览 + 贴图 RT 语义修正

1. **实时预览（免应用）**：编辑面板所有改动（shader/参数默认值/贴图/输入映射/pass 配置）防抖 500ms 自动校验+注册+重建 composer。校验失败静默跳过（保持上一份可用定义，不黑屏）；GLSL 编译错误仍会在 console 报，改对即恢复。手动"应用"保留（全量校验+错误红字+刷新条目参数行）。新增参数的条目行滑杆仍需点一次"应用"出现（live apply 特意不重建面板，避免打字丢焦点）。
2. **贴图 RT = MediaPlay RenderTexture**：texture source:'rt' 语义从"pass 输出 RT"改为"场景 MediaPlay RT 对象"——下拉用 FccVideo.listRenderTextureOptions(scene)，存 rtUuid；运行时每帧经 ctx.scene.getObjectByProperty('uuid') 取 object.__fccRT.texture 实时绑定，视频播放内容直接跟随。（引用 pass 输出本来就有 $rt: 输入映射，贴图层不重复提供。）
3. 版本：CustomEffectRuntime / CustomEditor → fcc-ui-115。

## 2026-10-28 补充 3：MediaPlay RT 贴图的保存与跨场景复用（设计定稿）

问题：贴图选 RT 后与场景 MediaPlay 节点绑定（uuid），效果库跨场景复用时 uuid 失效，如何保存/自动创建？

**分层原则：效果定义与场景绑定分离。**

1. 效果定义（custom-effects/<id>.json）：贴图只声明槽位 —— name + source('image'|'media-rt') + 缺省回退（image 槽 dataUrl 自包含；media-rt 槽 1x1 黑 fallback）+ 可选媒体描述（projectPath/fileName，供 autoCreate 用）。**uuid 不进 definition**（现状是把 rtUuid 写进 definition，需迁移到 entry 层）。
2. 槽位绑定（场景实例数据）：entry.textureBindings = { <贴图名>: { kind:'media-rt', playerUuid } }，存工程相机 postProcessStack entry，随工程保存。custom-pass 构建时从 bindings 解析，运行时每帧经 scene.getObjectByProperty('uuid') → object.__fccRT.texture 取画面（沿用现有解析路径）。
3. 跨场景策略（按槽位）：
   - manual（默认）：uuid 不存在 → fallback + 面板黄标"未绑定"，手动重绑写回 entry。
   - autoCreate（opt-in，definition 槽位勾选）：按稳定键 projectPath#fileName 扫场景（非 uuid），命中复用、未命中创建 VideoPlayer 节点（源描述还原，userData.fccVideoPlayer）+ RT 随节点生成；节点打 userData.fccAutoOwnedBy='custom:<id>:<槽>' 保证幂等、可识别、可清理。

依据：FccVideo createVideoPlayerObject 的视频源（projectPath/fileName/sequenceDir 等）全部序列化在 userData.fccVideoPlayer 中，随工程 JSON 保存 —— 自动创建技术上可行；RT 是 player 附属（fccRenderTextureUuid 回指），建 player 即得 RT。

实施：并入 P3（剪辑端镜像时一并做 definition 结构迁移 uuid→bindings，编辑器端顺手改绑定写入位置；autoCreate 在 P3 之后按需做）。

## 2026-10-28 补充 4：MediaPlay RT 贴图方案定稿（autoCreate 为主）

用户定性：MediaPlay RT 用于加载视频/序列帧/GIF 作为效果的素材输入（如噪点视频、漏光序列、GIF 遮罩）——素材属于效果配方 → **默认 autoCreate**；消费场景内容时用 manual 重绑兜底。

判定标准：素材跟着效果走 → autoCreate；素材跟着场景走 → manual。

媒体文件自包含策略（按大小分流）：
1. GIF/小序列帧（<5MB）→ dataUrl 内嵌 definition（与图片贴图同路）。
2. 大视频 → 效果包目录：custom-effects/<id>/（<id>.json + assets/*.mp4），definition 存相对路径 assets/xxx，运行时按 工程目录+效果id 解析；导入=拷整个目录；vfxpack 导出时 assets 打包进包。效果库形态升级为"效果包目录"，单 JSON 为无媒体特例，扫描兼容两种。

绑定优先级：entry.textureBindings（手动显式）> definition autoCreate（稳定键 projectPath#fileName 或内嵌源）> fallback。手动重绑永不被 autoCreate 覆盖。

实施归入 P3：definition 迁移（rtUuid → textureBindings + media 槽声明）→ 效果包目录存库/扫描 → 剪辑端镜像。

## 2026-10-28 补充 5：贴图从 dataUrl 改为工程相对路径

用户确认：图片贴图不再内嵌 dataUrl，改为加载路径文件。落地（fcc-ui-117）：

1. **定义模型**：texture = { name, source:'image', path:'custom-effects/<id>/assets/x.png', colorSpace, flipY }。path 为工程相对路径；dataUrl 仅保留为旧定义兼容加载分支（优先 path）。新增贴图默认 path:''。
2. **写入**：编辑面板"选择文件" → ProjectFolder.saveBlob('custom-effects/<id>/assets', 文件名, File) → tex.path = 相对路径。未绑定工程目录时 alert 提示先打开工程文件夹。
3. **读取**：运行时新增 registerCustomEffectAssetResolver（依赖注入，Sidebar 构造时注册：readBinaryFile(path) → Blob → createObjectURL → TextureLoader）。loadEffectTextures 对 path 贴图走异步解析，贴图门控保持（resolve 完成前 fallback 黑，resolveInput 每帧调用故加载完成自动接上）。dataUrl 旧分支同步加载不变。
4. **UI**：状态列显示文件名（悬停显全路径）+ 异步缩略图（经 resolveCustomEffectAssetUrl）；旧 dataUrl 显示"内嵌 dataUrl（旧）"。
5. 效果包目录模型与补充 4 一致：custom-effects/<id>/ = <id>.json + assets/；拷目录即迁移；vfxpack 导出时 assets 目录整体打包（P3）。

## 2026-10-28 补充 6：RT 绑定迁移 + autoCreate 实现完成（fcc-ui-118/165）

编辑器端落地（补充 3/4 设计）：

1. **数据模型**：definition rt 槽 = { name, source:'rt', autoCreate?, media? }，**不再存 uuid**；绑定在 entry.textureBindings = { <贴图名>: { rtUuid } }（RT 对象节点 uuid）。
2. **migrateEntryTextureBindings(entry)**：旧定义 texture.rtUuid → entry.textureBindings，幂等，PostProcessStack 两个构建循环（相机链 + 文本链）构建前调用；ctx.__fccTextureBindings 注入 createPasses，每帧闭包解析（bindings 对象原地修改保持引用有效）。
3. **ensureCustomEffectMediaBindings(editor, entry)**（运行时导出，async）：对 autoCreate 槽——绑定存活即跳过；否则按稳定键（projectPath / sequenceDir）扫场景复用 MediaPlay（复用其 targetUuid 的 RT；RT 无效则新建并改指）；无匹配 → createRenderTextureObject + createMediaPlayerObject（kind/源字段从 media 描述还原，muted，targetUuid 指向新 RT）经 AddObjectCommand 入场景，节点打 userData.fccAutoOwnedBy = custom:<id>:<槽名>；随后 restoreFccVideosFromProject 补媒体 buffer（幂等跳过已加载）。refresh（选中相机）与面板选完媒体后各触发一次。
4. **面板 RT 行重构**：第二行 = autoCreate 勾选 + 绑定状态（绿：RT 名/黄：未绑定或待自动创建）；第三行 = autoCreate 模式显示媒体状态 + 「选媒体文件」（mp4/webm/mov→assets/videos，gif→assets/textures）+「选序列帧目录」（webkitdirectory → assets/sequences/<名>/，png/jpg/webp/bmp）+ 清除；手动模式显示场景 RT 下拉（写 entry 绑定）。
5. media 描述存 definition（跨场景跟随效果），媒体文件在工程 assets/ 下随工程走——拷效果包 = definition JSON + 提示目标工程放入同路径媒体（vfxpack 打包 assets 归 P3）。
