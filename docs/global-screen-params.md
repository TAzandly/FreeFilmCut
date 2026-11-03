# 全局屏幕参数（Unity-like Screen Params）

编辑器与 OpenCut 每帧向 ShaderMaterial 注入项目/画面分辨率，方便在 GLSL 里直接使用，无需自己算宽高。

## Uniform 名称与含义

| 名称 | 类型 | 含义 |
|------|------|------|
| `uResolution` | `vec2` | `(width, height)` 像素 |
| `uScreenTexelSize` | `vec2` | `(1/width, 1/height)` |
| `uScreenParams` | `vec4` | `(width, height, 1+1/width, 1+1/height)` — 对齐 Unity `_ScreenParams` |
| `_ScreenParams` | `vec4` | 与 `uScreenParams` 相同（可选别名） |

**分辨率来源**

- **Editor**：项目安全框分辨率（`project/resolution`，与后处理 RT 一致），不是 CSS letterbox 像素。
- **OpenCut**：合成器 / pack 渲染宽高（`frame.width/height`）。

## GLSL 用法

Three.js 要求 **在着色器里声明** uniform；运行时只负责写入 `material.uniforms`。

```glsl
uniform vec2 uResolution;
uniform vec4 uScreenParams;
uniform vec2 uScreenTexelSize;
// uniform vec4 _ScreenParams; // 可选

varying vec2 vUv;

void main() {
	// 屏幕像素 UV（全屏后处理常用）
	vec2 screenUV = gl_FragCoord.xy / uResolution.xy;
	// 或用网格 UV：vUv
	gl_FragColor = vec4(screenUV, 0.0, 1.0);
}
```

「新建 Shader」默认模板已声明 `uResolution` / `uScreenParams` / `uScreenTexelSize`。

自定义材质：在 Frag/Vert 写上声明后，编辑器会按 GLSL 自动创建对应 uniform；若材质带 `userData.freecapcutGlobalScreen`（新建 Shader 会打标），则四个都会注入。

## 实现位置

| 端 | 文件 |
|----|------|
| Editor helper | `three.js/editor/js/GlobalScreenParams.js` |
| Editor 每帧 | `Viewport.js`（`projectRes`） |
| Editor 默认模板 | `FreeCapCutShaders.js` |
| OpenCut helper | `freefilmcut/.../vfxpack/global-screen-params.ts` |
| OpenCut 每帧 | `three-compositor.ts` `renderOnePack` |
| OpenCut 构建 | `scene-builder.ts`（`forceAll` 注入槽位） |
