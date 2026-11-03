# FreeFilmCut uInput 黑块根因说明（2026-10-13）

## NLE 一帧怎么渲

1. uildScene 按轨道从底到顶收集节点（视频/图片/特效…）。
2. uildFrameDescriptor 生成 rame.items（同序）。
3. ThreeCompositor.render：
   - 清 ccumRT
   - 遇到普通 layer：先攒 mesh，碰到 sceneEffect（或结束）时 lushLayers → 把视频/图片 blit 进 ccumRT
   - 遇到 vfxpack：snapshotBelowSource 把当前 accum 拷成 uInput 源 → 渲 pack 场景（cube）→ 叠回 accum
   - 最后 presentAccum 把 accum 画到预览 canvas

所以「周围有视频、中间黑方块」= **下层画面已经在 accum 里，pack 画在上面，但 cube 的 shader 采到的 uInput 是黑的（或等价于没绑上）。**

## 为什么 uInput 是空的（根因）

代码路径上 flush 顺序是对的（视频/图在 effect 之前进 accum）。黑块来自绑定/采样，不是「没渲视频」：

1. **ShaderMaterial 里 map: null 等空 sampler2D**：WebGL 上常导致**同材质其它 sampler（含 uInput）也采黑**。包里声明了 map 但没贴图时原来是 
ull。
2. **对 RenderTarget.texture 运行时改 colorSpace / lipY**：Three 文档不建议；会让 RT 采样异常。旧 snapshot 路径改过这些属性。
3. **用自定义 blit shader 从 ccumRT.texture 再采样**，不如 copyFramebufferToTexture 稳；present 用 MeshBasic 能显示 accum，不代表自定义 sampler 路径一定有像素。

## 已做修复

- scene-builder.ts：所有空贴图槽绑 1x1 白占位，禁止 null sampler。
- 	hree-compositor.ts：snapshotBelowSource 改为 setRenderTarget(accum) + copyFramebufferToTexture(FramebufferTexture)；不再改 RT 的 colorSpace/flipY；控制台前 3 帧打印 accum 角上 
onzero/maxRGB 证明下层有像素。

请硬刷新 localhost:3000，重新导入  
C:\Users\pc\Downloads\freecapcut.testshader.uinput-fixed.vfxpack  
（或删掉旧 pack 再拖），看立方体是否透出视频；F12 应有 [FreeFilmCut uInput] ... nonzero=... maxRGB=...。
