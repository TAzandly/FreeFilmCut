# Face FX 示例工程

在资源编辑器里做一个可预览 / 可导出的人脸特效工程。

## 快速开始

1. 打开 Three.js Asset Editor，新建工程。
2. **Project → VFX Pack → Pack type** 选 **Face FX / 人脸特效**。
3. 场景：`MediaFramePlayer` → 绑定 `RenderTexture` → 平面材质采样该 RT；导入人脸测试视频。
4. **View → Face FX** 打开预览面板：选预设 → **开启预览**（MediaPipe 跟人 + warp / 镭射 / GLB 耳朵）。
5. Export VfxPack（`anchor3d.asset` 指向的 GLB 会打进包）。

剪辑端：导入导出的 `.vfxpack`，或使用内置库 `public/vfxpacks/face-fx/`，拖到**特效轨**（吃下层画面）。

## 预设 JSON

### 兔耳朵（真实 GLB）

把 `models/rabbit_ears.glb` 放进工程 `assets/models/`（或依赖内置 `/vfxpacks/face-fx/models/rabbit_ears.glb`）。

```json
{
  "driver": { "landmarks": true, "transformationMatrix": true, "maxFaces": 4 },
  "layers": [
    {
      "id": "ears",
      "kind": "anchor3d",
      "asset": "models/rabbit_ears.glb",
      "bind": "forehead",
      "offset": [0, 0.02, 0],
      "scale": 1
    }
  ]
}
```

`asset` 为空时回退为程序化耳朵着色器。

### 双眼镭射

```json
{
  "driver": { "landmarks": true, "transformationMatrix": true, "maxFaces": 4 },
  "layers": [
    {
      "id": "laser",
      "kind": "eyeRay",
      "color": "#ff2244",
      "length": 2.2,
      "width": 0.012
    }
  ]
}
```

### 哈哈镜鼓腮

```json
{
  "driver": { "landmarks": true, "transformationMatrix": true, "maxFaces": 4 },
  "layers": [
    {
      "id": "bulge",
      "kind": "warp2d",
      "preset": "bulge",
      "strength": 0.85,
      "region": "face"
    }
  ]
}
```

`warp2d` presets：`bulge` | `pinch` | `stretchY` | `wave`。

## 说明

- `anchor3d` + `asset` → 加载真实 GLB 并绑 forehead/nose/eyes；无 asset → 程序化耳朵。
- 无人脸时效果透传下层画面。
- 编辑器预览与剪辑端共用同一套 layer 语义。
