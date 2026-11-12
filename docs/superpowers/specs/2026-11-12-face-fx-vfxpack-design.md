# Face FX vfxpack（人脸挂件 / 镭射 / 2D 搞怪）

Date: 2026-11-12  
Status: **Editor + NLE MVP**（MediaPlayer 预览控制器；warp2d / eyeRay；anchor3d 绑真实 GLB；内置示例包）  
Scope: 资源编辑器制作与预览 → 导出 `.vfxpack` → 剪辑端特效轨使用。

---

## 1. Goals

1. 新包类型 **`face-fx`**：在编辑器中制作、用测试视频/图片预览，导出给剪辑端。
2. 一期同时支持：
   - **A. 3D 人脸锚点挂件**（兔耳朵、狐狸鼻、太阳镜等 GLB）
   - **B. 方向特效**（如双眼发出镭射）
   - **2D 搞怪脸**（哈哈镜、局部鼓腮/拉长等，基于人脸网格或 ROI warp）
3. 剪辑端：**特效轨**、`scope: below`，吃下层已合成画面（与滤镜一致）。
4. 人脸驱动复用 / 扩展现有 MediaPipe Face Landmarker（与美颜分析同源模型）。

---

## 2. Non-goals（一期）

- **通用 / Unity 式粒子系统**（Emission / Shape / Color·Size over Lifetime / 重力 / 材质球等）——已确认一期不做；`eyeRay` 用程序化光束，不用完整粒子
- 人体轮廓粒子、全身骨骼驱动（C 类）
- 编辑器摄像头实时预览（二期；一期仅 MediaPlayer 视频/图）
- 美妆贴图全套、美体塑形
- 把 face-fx 挂到单个 video/image clip（一期不做 clip attach）

> 粒子可作为后续独立子系统（轻量模块化 MVP），不阻塞本 face-fx 一期。

---

## 3. Decisions (confirmed)

| 项 | 选择 |
|----|------|
| 架构 | 新类型 `face-fx`，不塞进普通 `effect` 的 meta 开关 |
| 编辑器预览输入 | MediaPlayer 导入测试视频 / 图片 |
| 剪辑端挂载 | 特效轨，吃下层 |
| 一期内容 | A + B + 2D 搞怪 |

---

## 4. Pack contract

### 4.1 Manifest

```json
{
  "schema": "vfxpack/1.4",
  "id": "freecapcut.face-fx.example",
  "type": "face-fx",
  "scope": "below",
  "displayName": "Rabbit Ears",
  "faceFx": {
    "driver": {
      "landmarks": true,
      "transformationMatrix": true,
      "maxFaces": 4
    },
    "layers": [
      {
        "id": "ears",
        "kind": "anchor3d",
        "asset": "models/rabbit_ears.glb",
        "bind": "forehead",
        "offset": [0, 0.02, 0],
        "scale": 1
      },
      {
        "id": "laser",
        "kind": "eyeRay",
        "color": "#ff0033",
        "length": 2.0,
        "width": 0.01
      },
      {
        "id": "funhouse",
        "kind": "warp2d",
        "preset": "bulge",
        "strength": 0.5,
        "region": "cheeks"
      }
    ]
  },
  "entry": { "scene": "scene.json" },
  "exposedParams": []
}
```

- `type: "face-fx"` → 剪辑端 `normalizeVfxPackType` / placement：与 filter 相同（特效轨 + below）。
- `faceFx.layers[].kind` 一期枚举：`anchor3d` | `eyeRay` | `warp2d`（可扩展）。
- 场景仍可用 `scene.json` 放灯光、锚点空节点；GLB 路径相对 pack。
- NLE 可调参数走现有 `exposedParams`（强度、缩放、镭射长度等）。

### 4.2 Bind targets（锚点语义）

预置 landmark 组（实现时映射到 MediaPipe 478 索引）：

| bind | 用途 |
|------|------|
| `forehead` | 兔耳朵等 |
| `noseBridge` | 眼镜梁 / 狐狸鼻 |
| `leftEye` / `rightEye` / `eyesCenter` | 镜片、镭射起点 |
| `faceMatrix` | 使用 `facialTransformationMatrix` 刚体跟随整头 |

`eyeRay`：起点为左右虹膜/眼角中点，方向由眼轴或头朝向前方推出（可暴露 `length` / `spread`）。

### 4.3 warp2d presets（一期）

最少：`bulge`（鼓）、`pinch`、`stretchY`（拉长脸）、`wave`（哈哈镜水波）。  
在人脸 ROI 或稠密网格上做位移；无人脸时跳过该 layer。

---

## 5. Asset editor

### 5.1 工程

- Project → VFX PACK 增加类型 **Face FX**（与 sticker / filter 并列）。
- 模板场景：PerspectiveCamera + 一个 **MediaPlayer**（用户放入测试人脸视频/图）+ Face FX 预览控制器。

### 5.2 预览管线

```
MediaPlayer frame
  → Face Landmarker (IMAGE 或 VIDEO 模式)
  → faceFx driver (points + optional matrix)
  → apply layers (warp2d on RT, then 3D anchors / eyeRay in overlay pass)
  → present
```

- 预览必须能看到：挂件跟脸、镭射方向、2D 变形强度。
- 参数面板：layer 列表、bind、offset/scale、warp strength；勾选 NLE 暴露。

### 5.3 导出

- `VfxPackExporter` 写入 `type: "face-fx"`、`scope: "below"`、`faceFx` 块、GLB/贴图、scene。
- 自定义/内置 layer 所需 shader 打进 pack（与 customEffects 类似，或 faceFx 专用 `passes`）。

---

## 6. NLE runtime

### 6.1 Placement

`getVfxPackPlacement("face-fx")`：

- `insertTrackType: "effect"`
- `targetElementTypes: []`
- `dragHint: "Drag onto the timeline (effect track)"`

Assets 面板归入 Effects（或单独 Face FX 分组，产品可选；一期进 Effects 即可）。

### 6.2 Compose

```
accum = layers below face-fx clip
analysis = face landmarks (+ matrix) on snapshot(accum or primary video — prefer accumBelow bitmap)
out = renderFaceFxPack(pack, accum, analysis, params)
accum = out
```

- 分析：扩展现有 beauty worker / 共享 Face Landmarker；face-fx 需要时可开 `outputFacialTransformationMatrixes`。
- 与美颜共存：美颜若在 clip 上、face-fx 在轨上，顺序按时间线栈；不强行合并。
- 无人脸：`warp2d` / 挂件 / 镭射跳过，输出 ≈ 输入（passthrough）。

### 6.3 Performance

- 预览：节流分析（对齐 beauty throttle）；导出：逐帧 ensure。
- 多脸：最多 `maxFaces`（默认 4），每层对每张脸各实例化一次（可声明 `multiFace: true/false`）。

---

## 7. Editor ↔ NLE parity

| 能力 | 编辑器 | 剪辑端 |
|------|--------|--------|
| 输入画面 | MediaPlayer | accumBelow |
| 检测 | 同模型 | 同模型 |
| layers | 实时 | 同 pack 定义 |
| 参数 | 侧栏 | exposedParams |

差异仅允许：编辑器可用更高预览分辨率；逻辑与 bind 语义必须一致。

---

## 8. Implementation slices（建议顺序）

1. **契约**：`face-fx` type / placement / manifest `faceFx` schema + 空 pack 导出导入。
2. **驱动**：共享 landmarks（+ matrix）供 face-fx；编辑器 MediaPlayer 预览驱动 HUD。
3. **warp2d**：第一个搞怪预设 + 剪辑端 below pass。
4. **anchor3d**：GLB bind + 编辑器/NLE 叠加。
5. **eyeRay**：镭射 layer。
6. **示例包**：兔耳朵 + 简单哈哈镜各一，写入 `public/vfxpacks/`。

---

## 9. Acceptance

1. 编辑器：导入人脸测试视频，能预览挂件跟随、镭射、至少一种 2D 搞怪，并导出 `.vfxpack`。
2. 剪辑端：拖到特效轨，下层有人脸时效果生效；无人脸时画面正常。
3. 刷新工程后参数与包仍可用。
4. 美颜开关与 face-fx 可同时存在且不崩溃。

---

## 10. Risks

- **矩阵坐标系**：MediaPipe cm / 63° FOV 与 NLE 正交/透视合成不一致 → 一期优先 landmark 刚体估姿，matrix 作增强。
- **遮挡**：眼镜镜腿穿模 → 一期可不做 occluder，文档标明限制。
- **分析成本**：与美颜抢同一 worker → 共享帧缓存 / 节流，避免双倍推理。
