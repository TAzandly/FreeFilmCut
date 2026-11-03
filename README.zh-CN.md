# FreeFilmCut

**[English](README.md)** | **[中文](README.zh-CN.md)**

**免费**的浏览器端视频剪辑 + 特效制作。剪映式多轨时间线，配合 Three.js 资源编辑器导出 `.vfxpack` 特效包。

> 免费使用。有问题欢迎加 QQ 群：  
> [点击链接加入群聊【FreeFilmCut交流群】](https://qm.qq.com/q/MywTcYMNci)

---

## 仓库里有什么

| 部分 | 路径 | 作用 |
|------|------|------|
| **剪辑端** | `freefilmcut/` | 多轨剪辑、预览、导出 |
| **特效编辑器** | `three.js/editor/` | 制作特效 / 艺术字等，导出 `.vfxpack` |
| **已有资源包** | `freefilmcut/apps/web/public/vfxpacks/`、`.../flower/` | 贴纸、转场、特效、艺术字等示例包 |

### 环境要求

| 脚本 | 需要 |
|------|------|
| `start-filmcut.bat`（剪辑端） | 缺 Bun 自动安装；缺 `apps/web/.env.local` 时从 `.env.example` 复制；缺 `node_modules` 时跑 `bun install` |
| `start-asset-editor.bat`（资源编辑器） | 需要 Python 3；缺失时会尝试用 **winget** 安装 |

### 快速启动（Windows）

- 剪辑端：`start-filmcut.bat` → http://localhost:3000  
- 资源编辑器：`start-asset-editor.bat` → http://localhost:5174/editor/  

剪辑端第一次启动可能较慢（`bun install` + Next.js）。

时间线文字默认使用开源 **Noto Sans SC**（`apps/web/public/fonts/NotoSansSC-Regular.ttf`）。微软雅黑 `msyh.ttf` 不能随仓库分发；若你本机自己放进 `public/fonts/`，启动后会自动优先使用。

---

## 剪辑端是什么

面向短视频 / 剪映式流程的 **Web 多轨剪辑器**：时间线 + 预览 + 属性面板。画面合成基于 **Three.js**；大量观感来自导入的 **`.vfxpack`** 资源。

### 已支持 / 正在完善的能力

- **艺术字** — 花字 / 艺术字资源包  
- **艺术字动画** — 入场 / 出场 / 循环等文字动画包  
- **特效** — 片段 / 场景特效包（如大光斑等）  
- **滤镜** — 调整 / 滤镜类资源包  
- **调色** — 片段调色  
- **抠像** — 色度键（绿幕等）  
- **遮罩** — 形状遮罩、羽化、翻转、描边等  
- **转场** — 基于资源包的转场  
- 以及贴纸 / 贴纸动画、片段动画等（随资源包扩展）  

仓库内示例见 `public/vfxpacks/`、`public/flower/`。

---

## 编辑器端是什么

基于改版 **Three.js Editor**，用来做 **可复用的特效资源**，不是用来剪成片的。

### 能做什么、能出什么效果

- 搭建 3D / UI / Shader 场景：特效、滤镜、贴纸、文字模板等  
- 摄像机 **后处理** 栈（Bloom、胶片、FXAA、自定义 Pass 等）  
- MediaPlayer / 渲染贴图作为包内媒体输入  
- 导出 **`.vfxpack`**，拖进剪辑端时间线使用  
- 在编辑器里按「上线后用法」预览效果  

文档：[docs/vfxpack-editor.md](docs/vfxpack-editor.md)、[docs/postprocess-stack.md](docs/postprocess-stack.md)

---

## 未来计划

- 持续制作更多 **特效资源包**  
- **美颜美体**（如结合人体 / 人脸检测的瘦身、磨皮等）  
- **自动配字幕**  
- 更完善的粒子系统（镭射眼等玩法）  
- 坚持免费，把「做包 → 剪辑里用」这条链路做得更顺  

---

## 致谢

FreeFilmCut 建立在开源之上，特别感谢：

- **[OpenCut](https://github.com/OpenCut-app/OpenCut)** / OpenCut Classic — 剪辑 UI 与时间线基础  
- **[three.js](https://github.com/mrdoob/three.js)** — WebGL 引擎，以及我们扩展后用于导出 `.vfxpack` 的 Editor  

二次分发或修改时，请遵守各自上游许可证。

---

## 交流群

QQ 群：[FreeFilmCut 交流群](https://qm.qq.com/q/MywTcYMNci)
