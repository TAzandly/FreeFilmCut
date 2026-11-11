# 人脸美颜 / 美型（浏览器端）

日期：2026-11-11  
状态：已确认（待实现计划）  
范围：视频 / 图片 clip 属性「美颜」；浏览器推理 + Web GPU 渲染。

---

## 1. 目标

1. 在 **视频 / 图片 clip** 属性面板提供「美颜」页，参数写入该 clip，预览与导出一致生效。
2. 第一期五个强度滑条（0–1）：**磨皮、美白、大眼、瘦脸、瘦鼻**。
3. 浏览器端完成：人脸检测兜底、稠密关键点、皮肤分割、GPU warp / 美颜 pass。
4. **不**加载或逆向 CapCut `effect/model` 私有 `.model`；仅可借鉴其 shader / 参数语义。

---

## 2. 非目标（第一期）

- 美体（瘦身 / 长腿 / 小头等）
- 妆容贴图、3D face fitting
- BiSeNet / SegFormer 等更重的 face-parsing（可作二期升级）
- 挂到 effect 轨或全局调节轨（入口固定为 clip 属性）
- 完整对齐剪映全部美颜参数面板

---

## 3. 产品入口与参数

### 3.1 UI

- 选中 video / image clip → 属性面板 **「美颜」** Tab。
- 五个滑条，范围 `[0, 1]`，默认 `0`（全 0 时跳过 Beauty GPU pass）。

| Key（建议） | 显示名 | 作用 |
|-------------|--------|------|
| `smooth` | 磨皮 | 皮肤 mask 内平滑 |
| `whiten` | 美白 | 皮肤 mask 内提亮 / 轻微去饱和 |
| `eye` | 大眼 | 关键点驱动眼周 warp |
| `faceSlim` | 瘦脸 | 关键点驱动面颊 / 下颌 warp |
| `noseSlim` | 瘦鼻 | 关键点驱动鼻翼 / 鼻梁局部 warp |

### 3.2 数据模型

挂在 image / video element 上（名称可最终定为 `beauty`）：

```ts
type ClipBeautyParams = {
  smooth: number; // 0..1
  whiten: number;
  eye: number;
  faceSlim: number;
  noseSlim: number;
};

// element.beauty?: ClipBeautyParams  // omit 或全 0 ≡ 关闭
```

- 参与 undo / 工程序列化 / 草稿包导出。
- **不是** vfxpack，也不是 `element.effects[]` 里的普通 clip effect（避免与「不可再挂特效到 clip」的产品规则混淆）；若实现上复用 effect 基础设施，须在类型与 UI 上与「美颜」明确区分，且默认仍以 clip 自带字段为准。

### 3.3 多人脸

- 第一期：同一套强度作用于检测到的所有脸，或主脸（面积最大）；实现计划中二选一并写死默认（建议：**所有脸同一强度**）。

---

## 4. 推理管线（浏览器 Worker）

```
帧像素（预览当前帧 / 导出逐帧）
  → MediaPipe Face Landmarker（检测 + 478 关键点）
  → 若无人脸：YOLO-Face 出框 → 扩边裁剪 → 再跑 MediaPipe Landmarker
  → 关键点时序平滑（EMA / IOU 关联）
  → MediaPipe Selfie Multiclass（256²）→ skin 类 mask
       （可选：与脸外接矩形 / 脸椭圆求交，减少衣服误检）
  → 主线程：关键点 + skin mask 纹理 → Beauty GPU pass
```

### 4.1 模型选型（已确认）

| 角色 | 选型 | 备注 |
|------|------|------|
| 主检测 + 关键点 | **MediaPipe Face Landmarker** | 478 点；Tasks / WASM 或 WebGPU 后端 |
| 检测兜底 | **YOLO-Face**（ONNX → ORT Web） | 仅 MediaPipe 无人脸时启用 |
| 皮肤分割 | **MediaPipe Selfie Multiclass 256×256 ONNX** | 取 **skin** 通道；Apache 2.0；体积优先 |

降级：皮肤模型未加载或推理失败时，临时用 **478 点脸部拓扑 ROI**（挖空眼嘴）作为磨皮/美白 mask，不阻塞预览。

### 4.2 调度与缓存

- 架构：**方案 B** — Worker 异步推理 + 按 `(clipId, mediaTime 量化)` 缓存关键点与 mask；Beauty pass 读最近可用结果。
- 预览允许关键点落后 1～2 帧；导出路径须 **等帧推理完成** 或等价可靠策略，保证成片正确。
- 滑条变更 **不**强制重跑检测；仅改 GPU uniforms / warp 强度。
- clip 换源、裁剪、翻转、缩放等几何变更时使缓存失效。

### 4.3 禁止

- 直接加载 CapCut `Cache/effect/model/*.model`（私有封装，非标准 ONNX/TFLite）。

---

## 5. GPU 渲染（Three compositor）

在该 clip 画面渲染完成后、参与时间线合成前插入 **Beauty pass**（全参数为 0 则跳过）：

1. **美型（warp）**  
   - 输入：原图 + 478 点。  
   - 大眼 / 瘦脸 / 瘦鼻：局部 UV 位移（语义对齐 CapCut `fd_withMask_*` 一类 mask blend warp，实现为自研 GLSL，不复制闭源资源）。  
2. **磨皮（smooth）**  
   - 在 skin mask（或降级脸 ROI）内做双边 / 高频分离模糊类处理。  
3. **美白（whiten）**  
   - 同 mask 内提亮 + 可控去饱和。

顺序建议：`warp → smooth → whiten`（先变形再质感，避免磨皮模糊位移边界）。

---

## 6. 与现有系统关系

- **属性面板**：video / image 注册「美颜」Tab（与调色等并列）。  
- **合成器**：`three-compositor`（或等价 clip 后处理钩子）增加 beauty 分支。  
- **不**走「拖 vfxpack 挂到 clip」路径；与近期「特效/滤镜只进 effect 轨」的规则不冲突。

---

## 7. 测试与验收（高层）

- 无人脸：不崩溃；YOLO 检出后能出点；仍失败则跳过 beauty（或仅跳过依赖点的项）。  
- 有人脸：五滑条独立响应；全 0 与未配置 visually 等价。  
- 皮肤 mask 未就绪时降级 ROI 仍可磨皮。  
- 预览 scrub / 播放无明显崩溃；导出一段含人脸片段与预览强度方向一致。  
- 工程保存再打开，美颜参数恢复。

---

## 8. 后续（非本设计范围）

- 美体 + 骨架模型（开源 pose，非 CapCut `tt_skeletonsquat`）。  
- 升级皮肤为 BiSeNet Face Parsing（更贴五官边界）。  
- 更多美颜参数、多人脸分控、妆容。

---

## 9. 确认记录

- 入口：clip 属性美颜页  
- 参数套装：磨皮 / 美白 / 大眼 / 瘦脸 / 瘦鼻  
- 栈：YOLO-Face 兜底 + MediaPipe 关键点 + Selfie Multiclass 皮肤 + Web GPU warp  
- 架构：Worker + 缓存 + compositor pass（方案 B）  
- 用户确认日期：2026-11-11  
