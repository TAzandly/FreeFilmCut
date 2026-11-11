# FreeFilmCut

**[English](README.md)** | **[中文](README.zh-CN.md)**

免费的浏览器端 **剪映式多轨剪辑** —— 时间线、预览、导出。  
另附 Three.js **特效编辑器**，制作 `.vfxpack` 资源包供剪辑端使用。

**在线体验：** [free-film-cut.vercel.app](https://free-film-cut.vercel.app)

---

## 演示视频

剪辑端演示（时间线 / 预览 / 资源包）：

[![FreeFilmCut 剪辑端 Demo](https://img.youtube.com/vi/QRCSDf3mw9k/hqdefault.jpg)](https://youtu.be/QRCSDf3mw9k)

https://youtu.be/QRCSDf3mw9k

---

## 仓库内容

| | 路径 | 作用 |
|---|------|------|
| **剪辑端** | `freefilmcut/` | 剪辑、预览、导出 |
| **特效编辑器** | `three.js/editor/` | 做特效 / 艺术字 → `.vfxpack` |
| **示例资源** | `freefilmcut/apps/web/public/vfxpacks/`、`flower/` | 贴纸、转场、特效、艺术字等 |

### 快速启动（Windows）

- 剪辑端：`start-filmcut.bat` → http://localhost:3000  
- 特效编辑器：`start-asset-editor.bat` → http://localhost:5174/editor/  

剪辑端脚本可自动装 Bun，首次会跑 `bun install`。  
特效编辑器需要 Python 3（缺失时可用 winget 安装）。

---

## 剪辑端能力

Web 多轨剪辑，Three.js 合成，观感主要靠资源包：

艺术字 · 文字动画 · 特效 · 滤镜 · 调色 · 抠像 · 遮罩 · 转场 · 贴纸 · **人脸美颜**（磨皮 / 美白 / 大眼 / 瘦脸 / V脸 / 瘦鼻）等

美颜在浏览器端完成（MediaPipe 关键点 + DLMV 皮肤分割，GPU warp / 磨皮 / 美白）。模型需单独下载，见 [`freefilmcut/apps/web/public/models/beauty/README.md`](freefilmcut/apps/web/public/models/beauty/README.md)。

---

## 特效编辑器

用来做可复用特效（不是剪成片）：搭场景、后处理栈、媒体输入 → 导出 `.vfxpack` 进剪辑端。

文档：[vfxpack-editor](docs/vfxpack-editor.md) · [postprocess](docs/postprocess-stack.md)

---

## 计划

更多资源包 · 美体塑形 · 自动字幕 · 更强粒子 · 把「做包 → 剪辑」链路继续做好、保持免费

---

## 交流

- **Discord：** [加入](https://discord.gg/QmNQBrtXrU)  
- **QQ 群：** [FreeFilmCut 交流群](https://qm.qq.com/q/MywTcYMNci)

---

## 致谢

- [OpenCut](https://github.com/OpenCut-app/OpenCut) — 剪辑端基础  
- [three.js](https://github.com/mrdoob/three.js) — WebGL 与我们扩展后的 Editor

二次分发或修改请遵守上游许可证。
