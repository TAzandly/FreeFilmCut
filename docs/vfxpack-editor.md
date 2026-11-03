# FreeFilmCut 资源编辑器：导出 `.vfxpack`

基于 [Three.js Editor](https://github.com/mrdoob/three.js/tree/dev/editor) 的本地 fork：

`D:\GrokbotWork\FreeFilmCut\three.js\editor`

本阶段 MVP：从当前场景导出 **场景图 + 贴图 + 自定义 ShaderMaterial GLSL**，打成可下载的 `.vfxpack`（zip）。尚未包含完整的后处理可视化编辑 UI。

---

## 1. 启动编辑器

必须从 **three.js 仓库根目录** 起静态服务（`editor/index.html` 通过 `../build/` 引用 Three 本体）。

### 方式 A：Node（推荐）

```bat
cd /d D:\GrokbotWork\FreeFilmCut\three.js
npx --yes serve -p 5174 .
```

浏览器打开：

[http://localhost:5174/editor/](http://localhost:5174/editor/)

### 方式 B：Python

```bat
cd /d D:\GrokbotWork\FreeFilmCut\three.js
python -m http.server 5174
```

同样打开 [http://localhost:5174/editor/](http://localhost:5174/editor/)。

也可双击运行：

`D:\GrokbotWork\FreeFilmCut\scripts\serve-asset-editor.cmd`

> 不要用 `file://` 直接打开 `index.html`：ES modules / importmap / CDN（JSZip）在 `file://` 下通常会失败。

---

## 2. 导出步骤

1. 在编辑器里搭场景：相机、灯光、Mesh、贴图材质等（Add 菜单）。
2. 任选其一：
   - 菜单 **File → Export → VfxPack (.vfxpack)**
   - 或工具栏 **VfxPack** 按钮
3. 只填一次 **VfxPack name**（如 `glow`、`3D cube`）。`id` 自动为 `freecapcut.<slug>`；`type` 取自右侧 **Project → VFX PACK → Pack type**（`sticker` / `transition` / `effect` / `filter` / `art-text`，写入 localStorage）；`scope` 按类型默认（filter/effect=`below`，其余=`stack`）。
4. 浏览器会下载 `*.vfxpack`（实为 zip）。

用解压工具或改后缀为 `.zip` 可查看内部文件。

---

## 3. 包内结构（MVP）

```
something.vfxpack          # zip
└── pack/
    ├── manifest.json      # vfxpack/1.1 契约
    ├── scene.json         # 相机 / 灯 / Mesh / UI stub / 变换
    ├── textures/          # 从材质 map 等导出的 PNG（能画到 canvas 的才会写入）
    ├── shaders/
    │   ├── mat_0_<name>.vert.glsl   # 来自 ShaderMaterial（若有）
    │   ├── mat_0_<name>.frag.glsl
    │   ├── placeholder.*.glsl       # 仅当场景里没有自定义 shader
    │   └── README.txt
    └── preview/
        └── README.txt     # 预留 thumb / demo
```

### `manifest.json` 要点

| 字段 | 说明 |
|------|------|
| `schema` | `vfxpack/1.1` |
| `id` / `version` / `displayName` | 包标识 |
| `engine.api` | `webgl2`；`engine.renderer` = `three` |
| `type` / `scope` | 挂载语义（见架构文档） |
| `entry.scene` | `scene.json` |
| `passes[]` | MVP 指向 placeholder shader；`uInput: accumBelow` |
| `params[]` | 示例 `intensity` |

### `scene.json` 要点

- `nodes[]`：遍历编辑器 `scene`，`kind` 为 `camera` / `light` / `mesh` / `sprite` / `group` / `ui` / …
- 灯光、相机带常用参数；Mesh 带 geometry 类型/参数摘要 + 材质与贴图路径
- `assets.textures[]`：导出结果列表（`exported: false` 表示跨域等原因未能写出像素）
- **UI**：暂为 stub（`userData.ui` 或 `userData.kind === 'ui'` 可标成 `ui`）

完整产品契约见 [`architecture.md`](./architecture.md) §5–§8。

---

---

## 画布安全框（与剪辑端对齐）

右侧 **Project → SAFE FRAME** 可设置目标分辨率，视口会实时显示 letterbox 安全框：

- **Show frame**：开关安全框；开启时相机 aspect / 渲染裁剪按该分辨率比例
- **Preset**：`16:9`（1920×1080 / 1280×720）、`9:16`、`1:1`、`4:3`、Custom
- **Resolution**：自定义宽高（1–8192），改完立即刷新预览框
- 设置写入 `localStorage`（`project/resolution/*`）

导出 `.vfxpack` 时，`manifest.json` 与 `scene.json` 都会带上：

```json
"resolution": { "width": 1920, "height": 1080 }
```

构图时请以黄框内画面为准；框外为 letterbox，不会进入成片/剪辑端对应画幅。

相关源码：`Viewport.SafeFrame.js`、`Sidebar.Project.Resolution.js`。

---



---

## 自定义 Shader（顶点 + 片元）

编辑器已支持用现有 **Material** 侧栏做自定义 GLSL，并写入 `.vfxpack`。

### 操作步骤

1. 选中一个 Mesh。
2. 右侧 **Material → Type** 选 `ShaderMaterial`（或 `RawShaderMaterial`）。
3. 会自动挂上 FreeFilmCut 默认 shader（支持 `map` / `color` / `opacity` / `uTime`）。
4. **Program** 一行：
   - **Vert**：编辑顶点着色器
   - **Frag**：编辑片元着色器
   - **Info**：JSON 编辑 `defines` / `uniforms` / `attributes`
5. 侧栏 **Map / Color / Opacity** 仍可用（会同步到 `uniforms.map` / `uniforms.color` / `uniforms.opacity`）。
6. **File → Export → VfxPack**：包内 `pack/shaders/mat_*.vert.glsl`、`mat_*.frag.glsl` 为真实源码；`scene.json` 里对应材质的 `shader.vertex` / `shader.fragment` 指向这些文件。

### 约定 uniform（默认模板）

| 名 | 类型 | 说明 |
|----|------|------|
| `map` | sampler2D | 贴图（侧栏 Map） |
| `useMap` | bool | 是否采样 map |
| `color` | vec3 | 颜色乘子 |
| `opacity` | float | 透明度 |
| `uTime` | float | 预留时间（NLE 后续可喂） |

滤镜类可自行在 Frag 里加 `uniform sampler2D uInput`（下层画面），与 `scope: below` 约定一致。

### 相关源码

| 文件 | 作用 |
|------|------|
| `editor/js/FreeCapCutShaders.js` | 默认 GLSL + map/color 桥接 |
| `editor/js/Sidebar.Material.js` | 切到 ShaderMaterial 时用 FreeFilmCut 模板 |
| `editor/js/Sidebar.Material.Program.js` | Vert / Frag / Info 入口 |
| `editor/js/Script.js` | CodeMirror GLSL 编辑（官方） |
| `editor/js/VfxPackExporter.js` | 抽出 GLSL 进 zip |


## 4. 相关源码

| 文件 | 作用 |
|------|------|
| `editor/js/Sidebar.Project.VfxPack.js` | Project → 包类型设置 |
| `editor/js/VfxPackExporter.js` | 组 zip、写 manifest/scene、抽贴图 |
| `editor/js/Menubar.File.js` | File → Export → VfxPack |
| `editor/js/Toolbar.js` | 工具栏 VfxPack 按钮 |
| `editor/js/Strings.js` | en / zh 文案 |
| `editor/index.html` | importmap 增加 `jszip` CDN |

依赖：浏览器加载 [JSZip 3.10.1](https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm)（需联网一次；也可日后改为本地 `js/libs`）。

---

## 5. 自测清单

1. `serve` 起服务后打开 `/editor/`，标题为 **FreeFilmCut Asset Editor (three.js)**。
2. Add → Mesh → Box；可选再 Add → Light / Camera。
3. 给 Mesh 材质拖一张本地图片作 map（Import 或拖放）。
4. 先在 Project → VFX PACK 选好 Pack type，再 File → Export → VfxPack，只输入包名（如 `glow`）。
5. 下载成功；解压确认有 `pack/manifest.json`、`pack/scene.json`，且 `scene.json` 的 `nodes` 含 mesh/light/camera。
6. 若有贴图且非跨域污染，`pack/textures/` 下应有 PNG。
7. 控制台有 `[FreeFilmCut] Exported ...` 日志。

---

## 6. 已知 MVP 限制

- 无 ShaderMaterial 时仍写 `shaders/placeholder.*`；有自定义材质则写出 `mat_*.vert.glsl` / `mat_*.frag.glsl`。
- 几何体不导出完整 glTF buffer，只写类型与 `parameters` 摘要（NLE 侧后期可补 meshes/）。
- 后处理 / 关键帧编辑 UI 未做；导出只问包名。包类型在 Project → VFX PACK 设置（默认 `effect`）。
- CORS 污染的贴图无法 `drawImage` 进 PNG（`exported: false`）。
- 未接 FreeFilmCut NLE 的 `PackRegistry` 导入（下一阶段）。

---

## 7. 下一步建议

1. NLE：`PackRegistry.install(.vfxpack)` + Three compositor 读 `scope: below`。
2. Editor：后处理节点面板、关键帧轨；ShaderMaterial 的 GLSL 已可导出。
3. 可选：把 JSZip 下到 `editor/js/libs/jszip.esm.js`，离线可用。

---

## Scene render settings export (v1.2)

Exporting `.vfxpack` now includes Project/Scene render-related settings and all custom shaders:

| Source | Written to | Fields |
|--------|------------|--------|
| Scene → Background | `scene.json.background` | `Color` / `Texture` / `Equirectangular` / `None`, plus blurriness / intensity / rotation; textures under `textures/` |
| Scene → Environment | `scene.json.environment` | Equirect env map path + intensity |
| Scene → Fog | `scene.json.fog` | `Fog` / `FogExp2` + color / near / far / density |
| Project → Renderer | `scene.json.render` and `manifest.render` | antialias, shadows, shadowType, **toneMapping**, toneMappingExposure, rendererType, cameraType |
| Material → ShaderMaterial | `shaders/mat_*.vert.glsl` + `.frag.glsl` | Every custom vertex/fragment in the scene; listed in `scene.json.assets.shaders`; placeholder only if none |

### What is Tone Mapping?

3D lighting / environment maps often produce **HDR** colors (values beyond 0–1). **Tone mapping** compresses that into displayable LDR and sets the filmic look:

- **No**: raw values (easy to blow out)
- **Linear**: linear scale
- **Reinhard / Cineon**: classic film curves
- **ACESFilmic / AgX / Neutral**: common cinematic operators (Editor often defaults to Neutral)

**Exposure** is a brightness multiplier before mapping. The NLE applies `render.toneMapping` / `toneMappingExposure` while drawing that pack, then restores the global renderer.

### Schema

`manifest.schema` = `vfxpack/1.2`, `scene.json.schema` = `vfxpack-scene/1.1`.


---

## Shader color / color2 uniforms

See [shader-uniforms-fix.md](./shader-uniforms-fix.md). Info JSON must use `[r,g,b]` arrays (or hex ints, which are now auto-converted). Default fragment mixes `color`→`color2` by `vUv.x`.


---

## ShaderMaterial：自定义 uniforms 侧栏

切换多个颜色 / 贴图时：

1. 在 **Program → Frag/Vert** 声明 `uniform vec3 color2;`、`uniform sampler2D map2;` 等  
2. 在 **Program → Info** 的 `uniforms` 里写上同名条目（颜色用 `[r,g,b]` 0～1）  
3. 材质面板出现 **Shader Uniforms**：`color*` → 取色器，`map*`/`*Map`/`tex*` → 贴图槽，`float` → 数字，`bool` → 勾选  

内置行仍管 `color` / `map` / `opacity`。命名约定详见 [`shader-uniforms-sidebar.md`](./shader-uniforms-sidebar.md)。

## Shader Uniforms sidebar

For ShaderMaterial / RawShaderMaterial, the Material panel shows a **Shader Uniforms** section after Color:

- Color-like uniforms (color2, names containing color/tint/albedo, or THREE.Color / color-named Vector3) get a color picker
- Numbers (uTime, etc.) get a number field
- Booleans (useMap, etc.) get a checkbox
- Built-in color / opacity / map stay on their existing rows (not duplicated)

Add new uniforms in Program → Info JSON; after apply, they appear in this list.


---

## Below-track input (`uInput`)

When a pack is **filter** or **effect** with `scope: "below"` (the default for those types), the NLE snapshots everything already composited under that timeline item and binds it to special `sampler2D` uniforms on any ShaderMaterial in the pack.

### Declare in GLSL (prefer this name)

```glsl
uniform sampler2D uInput;   // preferred — NLE auto-binds below composite

// also accepted:
// uniform sampler2D belowInput;
// uniform sampler2D iChannel0;
```

Also list it in **Program → Info** uniforms (value can be `null` in the editor):

```json
{
  "uniforms": {
    "uInput": { "value": null },
    "opacity": { "value": 1 }
  }
}
```

### Behaviour in the NLE

1. Draw layers / packs below this item into an offscreen accum RT.
2. Copy accum → `belowSource` texture (avoid feedback).
3. Set `material.uniforms.uInput.value` (and any alias present) to that texture.
4. Clear accum and render this pack (filter output **replaces** the stack below it; higher tracks still compose on top).

Editor preview does **not** inject the timeline composite. Use **Material → Shader Uniforms → uInput preview (Editor only)** to pick a local image (`userData.editorPreviewInputs`); it is not exported as the real below source. OpenCut still binds the below composite each frame.

### Example fragment (fullscreen-style tint of below)

```glsl
uniform sampler2D uInput;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;

void main() {
	vec4 src = texture2D( uInput, vUv );
	gl_FragColor = vec4( src.rgb * color, src.a * opacity );
}
```

Set **Project → VFX PACK → Pack type** to `filter` (or `effect`) before export so `manifest.scope` defaults to `below`.

