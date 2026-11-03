# 自定义后处理框架 — 开发进度交接（2026-10-29）

> 给 Cursor / 任何后续开发者的完整状态快照。
> 关联文档：`docs/custom-postprocess-framework-plan-2026-10-28.md`（方案 + 6 条补充，含全部设计决策）

## 一、项目位置与两端架构

| 端 | 路径 | 说明 |
|---|---|---|
| three.js 资源编辑器 | `D:\GrokbotWork\FreeFilmCut\three.js\editor` | dev server **http://localhost:5174/editor/**，纯 ES module，无构建 |
| 剪辑端（freefilmcut） | `D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src` | TS，vfxpack 体系在 `src/vfxpack/` |

**目标**：在编辑器 UI 上配置 pass（shader 可编辑、参数、贴图、多输入、降采样、命名 RT）即可创建后处理效果，导出 vfxpack 给剪辑端播放，不再手写 Pass 类。

## 二、已完成（P1 + P2 + RT 存储迁移，全部为编辑器端）

### 核心文件

| 文件 | 职责 |
|---|---|
| `editor/js/postprocessing/CustomEffectRuntime.js` | **核心运行时**：定义校验、ConfigurablePass、注册/注销、迁移、autoCreate、资产解析注入、两个内置 demo（`custom:demo-tint`、`custom:demo-blur`） |
| `editor/js/Sidebar.Object.PostProcess.CustomEditor.js` | 定义编辑面板：pass 链（增删/排序/输入映射/shader 编辑/降采样/色彩空间/输出 RT 名）、参数区、贴图区、应用/存库/导出 |
| `editor/js/Sidebar.Object.PostProcess.js` | 相机 PostProcess 栈 UI：新建自定义效果、导入 JSON、效果库扫描、编辑入口 |
| `editor/js/postprocessing/PostProcessStack.js` | composer 构建：BeautyCapturePass（$camera）、自定义效果注册时机、definition 指纹进 structureSignature（改 shader 自动重建）、**两处**构建循环（相机链 ~L395 / 文本链 ~L624） |
| `editor/js/postprocessing/PostProcessRegistry.js` | 全局 effect registry（`registerEffect/unregisterEffect/listEffectDescriptors/getEffectDescriptor`） |
| `editor/js/media/FccVideo.js` | MediaPlay/RT 体系（被自定义效果复用，见 §四） |

### 已实现能力

1. **定义模型** `CustomEffectDefinition`：`{ id, name/label/title, version, params[], textures[], passes[] }`
   - params：float / int / boolean / color / vec2/3/4，带 default/min/max/label；**参数 key 就是 shader uniform 名**；expose → 条目侧 k 帧勾选（ExposedParams 体系）
   - passes：有序数组即执行链
2. **输入源**（uniform 名 → 来源映射，inputs 省略时按声明名自动绑定保留字）：
   - 保留字：`uInput`（链输入）、`uTransitionFrom`/`uTransitionTo`（编辑器预览绑 1×1 占位）、别名 uFrom/uTo/belowInput/iChannel0
   - `$camera`（相机原始画面，BeautyCapturePass 固定拷贝，与链位置无关；文本链中=输入贴图）
   - `$prev` / `$prev2`（前 N 个 pass 输出）、`$rt:<名字>`（本效果内命名 RT，只能引用更早 pass → 结构无环）、`$tex:<名字>`（效果贴图）
   - 每帧 `_resolveInput` 解析 → 贴图/RT 异步就绪后自动接上
3. **自动 uniform**：`uTexel`、`uResolution`、`uTime`、`uFrame`；参数 key 禁止与这些/保留字撞名（校验拦截）
4. **贴图**：
   - `source:'image'`：**工程相对路径**（`custom-effects/<id>/assets/x.png`），"选择文件"经 `ProjectFolder.saveBlob` 写入；dataUrl 仅旧定义兼容；异步加载走注入式 resolver（`registerCustomEffectAssetResolver`，Sidebar 构造时注册：readBinaryFile → Blob URL → TextureLoader），加载期黑图门控
   - `source:'rt'`：MediaPlay RT，**uuid 不在 definition**，见 §四
5. **色彩空间**：pass 级 `colorSpace: linear(默认) | gamma(移植兼容)`；gamma = 输入端逐采样 linearToSRGB、输出端 sRGBToLinear（GLSL 前后缀注入）；主链契约 = 线性 + 链尾 OutputPass（对齐 Unity/Godot）
6. **降采样**：中间 pass 输出可指定 RT 名 + 1×/2×/4×/8×
7. **编译护栏**：shader 编译失败 → 直通拷贝 + console 报错，不黑屏
8. **实时预览**：面板所有改动防抖 500ms 自动校验+注册+重建（失败静默保旧定义）；"应用"= 全量校验 + 错误红字 + 刷新条目参数行
9. **效果库**：`saveCustomEffectToLibrary` → `<工程目录>/custom-effects/<id>.json`；`scanCustomEffectsLibrary` 幂等扫描注册；导入 JSON 即校验注册挂相机
10. **控制台 API**：`__fccCustomPostEffects.register/validate/list`

## 三、数据模型要点（剪辑端必须镜像）

```js
// definition（可复用资产，跨工程）— 贴图槽不存任何场景 uuid
{
  id, name, title, version,
  params: [ { key, type, default, min, max, step, label, labelZh, expose? } ],
  textures: [
    { name, source: 'image', path: 'custom-effects/<id>/assets/x.png', colorSpace: 'none'|'srgb', flipY: false },
    { name, source: 'rt', autoCreate: true, media: { kind: 'video'|'gif'|'imageSequence',
        fileName, projectPath,            // video/gif
        sequenceDir, sequenceFps, sequenceStart, sequenceEnd } },  // imageSequence
  ],
  passes: [
    { name, inputs: { uInput: 'uInput', uMask: '$tex:mask', ... },
      fragmentShader, vertexShader /* 'default' = 内置全屏 VS，可编辑 */,
      downsample: 1|2|4|8, colorSpace: 'linear'|'gamma',
      output: { rt: '名字' } /* 仅中间 pass；末 pass 无 output → 写链 */ },
  ],
}

// entry（工程场景实例数据，存在相机 postProcessStack.effects[]）
{
  id, type: 'custom:<id>', enabled, params: { key: value },
  definition: { ...上面 },
  textureBindings: { <贴图名>: { rtUuid } },   // RT 对象节点 uuid，随工程保存
}
```

## 四、MediaPlay RT 绑定体系（刚完成）

- **分层**：definition 只声明槽位；绑定（uuid）在 `entry.textureBindings`；解析顺序 = entry 绑定（手动/自动创建）→ fallback 黑图
- **迁移**：`migrateEntryTextureBindings(entry)` 把旧 `texture.rtUuid` 搬进 bindings（幂等），PostProcessStack 两处构建循环前调用；`ctx.__fccTextureBindings` 注入 createPasses，**闭包每帧读同一对象——改绑定必须原地 mutate，不能整体替换对象**
- **autoCreate**（`ensureCustomEffectMediaBindings(editor, entry)`，async 幂等）：
  - 绑定存活 → 跳过；否则按稳定键（`projectPath` / `sequenceDir`）扫场景复用 MediaPlay（复用其 `targetUuid` 的 RT，无效则新建并改指）
  - 无匹配 → `createRenderTextureObject` + `createMediaPlayerObject`（源字段从 media 描述还原、muted、targetUuid 指新 RT）→ `AddObjectCommand` 入场景（可撤销）→ 节点打 `userData.fccAutoOwnedBy = 'custom:<id>:<槽名>'` → `restoreFccVideosFromProject(editor)` 补媒体 buffer（跳过已加载）
  - 触发点：Sidebar refresh（选中相机）+ 面板选完媒体后
- **FccVideo 关键点**：RT 对象节点 `userData.fccRenderTexture` + `__fccRT`(WebGLRenderTarget)；Player 节点 `userData.fccVideoPlayer`（kind/filedName/projectPath/sequenceDir/.../targetUuid 指 RT 对象）；常量 `RT_KEY='fccRenderTexture'`、`VP_KEY='fccVideoPlayer'`；导出齐全（createRenderTextureObject/createMediaPlayerObject/ensureRenderTarget/isFccVideoPlayer/isFccRenderTexture/listRenderTextureOptions/restoreFccVideosFromProject 等）
- **效果库落盘位置**：`<工程目录>/custom-effects/<id>.json` + `custom-effects/<id>/assets/`（图片贴图）+ 工程 `assets/videos|textures|sequences/`（RT 媒体）

## 五、⚠️ 版本 tag 约定（编辑器端强缓存规避）

编辑器 ES module 用 `?v=fcc-ui-<N>` 控缓存，**改动任何被 import 的文件必须统一升级所有引用点的 tag**，否则模块分裂/旧缓存。当前版本：

- `CustomEffectRuntime.js` / `Sidebar.Object.PostProcess.CustomEditor.js` → **fcc-ui-118**
- `PostProcessStack.js` → **fcc-ui-165**（被 `Viewport.js` / `ui/TextLayerRT.js` / `preview/PreviewCapture.js` 引用，三处都要同步）
- 其他相关：`FccVideo.js?v=fcc-ui-207`、`PostProcessRegistry.js?v=fcc-ui-111`、`BuiltinEffects.js?v=fcc-ui-112`

## 六、校验命令（改完必跑）

```bash
# 编辑器端语法（必须 ESM 解析，node --check 抓不住重复导出/链接期错误！）
cd D:/GrokbotWork/FreeFilmCut/three.js/editor/js
for f in <改动文件>; do node --input-type=module --check < "$f"; done

# import 图完整性
node -e "（见 docs/custom-postprocess-framework-plan-2026-10-28.md 示例：from '...' 逐条 resolve 存在性检查）"

# dev server 可达
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/editor/js/<文件>

# 剪辑端（P3 用）
tsc --noEmit（基线 154 错误）; eslint; bun test
```

**踩坑记录**（防重蹈）：
1. `node --check` 对 .js 按 CJS 解析 → 重复 export 抓不到，必须 `node --input-type=module --check < file`
2. 行内 `export function` 与文件尾 `export { ... }` 块重名 → "Duplicate export" 链接期崩溃（已修复，runtime 尾部 export 块只留两个 const）
3. 贴图异步加载空窗 → 必须门控直通（bokeh-glow 教训；失败也解除 gate）
4. gamma 空间：pow(c,9) 类权重/LUT 数学按 sRGB 编码值标定，喂 linear 会塌缩 → gamma 兼容模式是为此保留的
5. CustomEditor 闭包里没有主 Sidebar 的 `dirty()` → 直接 dispatch `editor.signals`

## 七、待办：P3（下一步，剪辑端打通）

| # | 任务 | 说明 |
|---|---|---|
| 1 | `vfxpack/postprocess/custom-pass.ts` | TS 镜像 ConfigurablePass（参照 `bokeh-glow-pass.ts` 模式）：保留字/别名、$rt:/$tex:/每帧解析、降采样、gamma 注入、门控、直通护栏；注册进 `vfxpack/postprocess/registry.ts`（type `custom:<id>` 动态创建） |
| 2 | VfxPackExporter 扩展 | `customEffects` 写入 pack JSON（shader 内联）；贴图 dataUrl/路径 → assets 解码打包；剪辑端 pack 加载器解析 definition → 动态注册 |
| 3 | k 帧打通 | expose 参数并入现有 `mergeLiveParams → applyParams` 每帧链路（超级大光斑已验证该机制，重点是 paramSchema 类型映射：float/vec/color/bool 写 uniform） |
| 4 | 效果包目录兼容（可选） | 扫描兼容 `custom-effects/<id>/`（JSON 在子目录）与现状平铺两种布局 |
| 5 | P4 验收 | 把超级大光斑（BokehGlowPass 5-pass）改写成纯配置 definition，双端逐像素一致 + k 帧行为一致 |

剪辑端相关现状：`uInput`（below-input.ts）、`uTransitionFrom/To` + Size（transition-input.ts）、composer HalfFloat/NoColorSpace、exposed params 体系均已就绪，定义见 `freefilmcut/apps/web/src/vfxpack/`。

## 八、验证路径（手动冒烟）

1. Ctrl+F5 打开 http://localhost:5174/editor/ → 选中相机 → PostProcess 面板
2. "新建自定义效果" → 改 shader（实时预览）→ 加贴图（选择文件 → 查 `custom-effects/<id>/assets/` 落盘 + 缩略图）
3. RT 贴图：勾"跨场景自动创建" → 选媒体文件/序列帧目录 → 场景应自动出现 RT·…/MediaPlay·… 节点且画面接入
4. "存库" → 重启编辑器/换场景 → 效果库出现；打开别的工程（拷入目录）→ autoCreate 槽自动建播放器
5. 控制台 `__fccCustomPostEffects.list()`
