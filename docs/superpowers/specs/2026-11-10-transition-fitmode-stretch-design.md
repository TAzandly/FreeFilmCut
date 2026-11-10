# 转场 VfxPack 画幅适配：fitMode crop / stretch

日期：2026-11-10  
状态：已确认并实现（Approach A）  
范围：仅 **transition** 类型；资源编辑器配置 + 剪辑端渲染。

---

## 1. 目标

1. 作者可在 1:1（或其它设计分辨率）下制作转场，并选择在剪辑端工程画幅上 **stretch（拉伸）** 或 **crop（裁切，现状）**。
2. 缺省与旧包行为不变：未配置时视为 **`crop`**。
3. 只影响转场 pack 的 3D / 后处理构图如何映射到工程像素；A/B 输入纹理仍为工程画幅整帧。

---

## 2. 非目标

- effect / filter / sticker / clip-anim / text-* 的 fitMode（本轮不做）
- letterbox / contain / pillarbox 第三种模式
- 剪辑端运行时 UI 覆盖包内 fitMode（以 pack 为准）
- 改动 CapCut 导入链路或 Amazing 包

---

## 3. 数据模型

### 3.1 Manifest

```ts
/** How transition pack design aspect maps onto the NLE canvas. */
fitMode?: "crop" | "stretch"; // omit / unknown → "crop"
```

- 写入 `pack/manifest.json`（与现有 `type`、`resolution` 同级）。
- 仅当 `type === "transition"` 时有意义；其它类型可忽略该字段。
- **设计比例**来源：`manifest.resolution`（或 scene.resolution）；宽高均有效时  
  `authoredAspect = width / height`；否则回退为当前相机 aspect，再不行用 `1`。

### 3.2 语义

| fitMode | 行为 |
|---------|------|
| `crop`（默认） | 每帧将 `PerspectiveCamera.aspect` 设为 **工程** `W/H`，再画到工程尺寸 RT。竖向 FOV 不变，宽画幅左右被裁 / 窄画幅上下被裁。**与现状一致。** |
| `stretch` | 将 `PerspectiveCamera.aspect` 固定为 **包设计比例** `authoredAspect`，仍渲染到工程尺寸 RT。NDC 正方形映射到非正方形像素 → **非均匀拉伸**铺满工程画幅。 |

正交相机：`crop` 保持现状（若有按工程尺寸改 frustum 的逻辑则继续）；`stretch` 保持包内 authored 投影参数，不按工程比例改写左右/上下，从而同样在非方画布上拉伸。

---

## 4. 剪辑端（NLE）

### 4.1 读取

- `LoadedVfxPack` / pack meta 暴露 `fitMode`（normalize：非法值 → `crop`）。
- 仅在 `renderOnePack` 且 pack 规范化类型为 `transition` 时启用分支。

### 4.2 渲染分支（Approach A）

伪代码：

```ts
const isTransition = normalizeType(meta.type) === "transition";
const fitMode = isTransition ? normalizeFitMode(meta.fitMode) : "crop";

if (built.camera is PerspectiveCamera) {
  if (fitMode === "stretch") {
    camera.aspect = authoredAspectFrom(pack.resolution | built.resolution);
  } else {
    camera.aspect = renderW / renderH; // project size
  }
  camera.updateProjectionMatrix();
}
// renderW/H 仍为工程宽高（非 sticker 路径）
```

- `uFrom` / `uTo`、全局 `uResolution` 等仍按 **工程** 像素。
- UI Canvas / `placeCanvasInFrontOfCamera` 继续用当前相机 aspect + 工程 res；在 stretch 下与相机一致，整体随视口拉伸。

### 4.3 测试

- unit：`normalizeFitMode`；缺省 / 非法 → `crop`。
- unit 或轻量：给定 pack resolution 1:1 + project 9:16，`stretch` 时 aspect≈1，`crop` 时 aspect≈9/16。

---

## 5. 资源编辑器

### 5.1 Project → VFX Pack UI

- 当 Pack type = **Transition** 时显示控件：**Fit mode**  
  - Crop（default）  
  - Stretch  
- 非 Transition 时隐藏（或禁用），不写/不覆盖无关字段。
- 文案（中/英）：说明 Crop = 保持正确透视裁切；Stretch = 按设计比例拉满工程画幅（1:1→9:16 会变形）。

### 5.2 持久化与导出

- 工程侧与现有 vfxpack type 一样存 localStorage / project 设置（键名如 `project/vfxpack/fitMode`）。
- 导出 `.vfxpack` 时若 type 为 transition，写入 `manifest.fitMode`；为 crop 时可省略字段（与缺省一致）或显式写 `"crop"`（推荐显式写，便于对照）。
- 打开已有含 `fitMode` 的包 / 工程时回填 UI。

---

## 6. 作者工作流（预期）

1. 编辑器分辨率设为 1:1，方块正面贴满安全框。  
2. Pack type = Transition，Fit mode = **Stretch**。  
3. 导出 → 剪辑端 9:16 工程导入应用 → 构图被纵向拉满，左右不裁切。  
4. 若选 Crop → 与今天相同（中心竖裁）。

---

## 7. 风险与注意

- Stretch 会改变透视感知（圆形变椭圆）；适合「故意按设计稿拉满」的立方体/平面转场，不适合依赖真实透视比例的包。
- 包 `resolution` 若与制作时安全框不一致，stretch 的 authoredAspect 会错；UI hint 提醒与 Project Resolution 对齐。

---

## 8. 验收

- [ ] 无 `fitMode` 的旧 transition：行为与改前一致（crop）。
- [ ] `fitMode: "stretch"` + 1:1 pack + 9:16 工程：画面铺满且无左右裁切（相对 crop 可见更多左右内容被压扁进画幅）。
- [ ] 编辑器仅 Transition 显示选项；导出 manifest 含正确字段。
- [ ] effect/filter/sticker 路径不受影响。
