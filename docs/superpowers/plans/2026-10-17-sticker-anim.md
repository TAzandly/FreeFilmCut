# 贴纸动画（sticker-anim）开发说明

> 给实现用。未明确要求时不要 git commit。  
> 目标：在资源编辑器里单独做贴纸动画，导出成包；剪辑端自动出现在贴纸属性的 In / Out / Loop，并在时间线片段上画出固定时长的白线。

## 已经定下的规则

- 新资源类型 `sticker-anim`。不要用现有的 sticker、effect，也不要走会被收成 effect 的旧 `animation`。
- 一个 `.vfxpack` 只做一种阶段：`in`、`out` 或 `loop`。阶段在编辑器里选定。
- 一个包可以任意组合这些轨道，缺的轨道保持贴花原样：

| 轨道 | 采样结果 | 缺省 | 怎么叠到用户已经摆好的贴花上 |
|---|---|---|---|
| `sticker.opacity` | 0..1 | 1 | 整张图的 rgb 和 alpha 一起乘 |
| `sticker.scale` | 乘数 | 1 | 同时乘 scaleX、scaleY |
| `sticker.rotate` | 度 | 0 | 加到用户旋转上 |
| `sticker.positionX` | 当前贴花宽度的比例 | 0 | 位移像素 = 值 × 用户摆好后的宽度 |
| `sticker.positionY` | 当前贴花高度的比例 | 0 | 位移像素 = 值 × 用户摆好后的高度，正值向上 |

- 位移用的宽高是用户缩放之后、贴纸动画缩放之前的摆放尺寸。
- 贴花自己的 timeline / `.anim` 先采样，整张画完，再套贴纸动画。两边关键帧不写在一起。
- 入场、出场时长等于包里的 `duration`，剪辑端不能改，时间线上不能拖。
- 白线画在片段底部。线的右端是朝右的箭头。没有圆点。
- 循环线占入场和出场留下的时间。两边都没有就画满整段。两边重叠到没有空隙时不画循环线。
- 剪辑端不扫描目录。包放在 `freefilmcut/apps/web/public/vfxpacks/sticker-anims/`，文件名写进同目录的 `index.json`。

## 包格式

```json
{
  "schema": "freecapcut.vfxpack/1",
  "id": "freecapcut.sticker-anim.fade-in",
  "version": "1.0.0",
  "displayName": "Fade In",
  "type": "sticker-anim",
  "phase": "in",
  "duration": 0.5,
  "preview": { "poster": "preview/poster.png", "hover": "preview/hover.gif" },
  "motion": {
    "format": "freecapcut.sticker-motion/1",
    "duration": 0.5,
    "loop": "clamp",
    "tracks": [
      { "path": "sticker.opacity", "interp": "linear", "keys": [{ "t": 0, "v": 0 }, { "t": 0.5, "v": 1 }] },
      { "path": "sticker.scale", "interp": "linear", "keys": [{ "t": 0, "v": 0.8 }, { "t": 0.5, "v": 1 }] }
    ]
  }
}
```

`phase` 为 `in` 或 `out` 时 `motion.loop` 必须是 `clamp`。`phase` 为 `loop` 时 `motion.loop` 必须是 `loop`。`duration` 与 `motion.duration` 相同，单位秒，最小 0.1。包内没有场景、模型、贴图、着色器。

剪辑端贴花上只存包 id：

```ts
stickerAnims?: {
  in?: { packId: string } | null;
  out?: { packId: string } | null;
  loop?: { packId: string } | null;
}
```

时长每次从包的 `duration` 读。同一个阶段再点一次已选中的动画就清空该阶段。

## 播放合成

贴花片段本地时间 `t`（秒），片段长度 `D`，三个姿态缺省都是恒等（opacity 1，scale 1，rotate 0，position 0）。

- 入场：包存在且 `t < inDuration` 时，用 `t` 采样，`clamp`。否则该姿态为恒等。
- 出场：包存在且 `t > D - outDuration` 时，用 `t - (D - outDuration)` 采样，`clamp`。否则恒等。
- 循环：包存在且循环区间长度大于 0，并且 `t` 落在区间内时，用 `(t - loopStart) % loopDuration` 采样。否则恒等。循环区间见下面的 `stickerAnimSpans`。

三个姿态再合成一次：opacity 相乘，scale 相乘，rotate 相加，positionX 相加，positionY 相加。

采样函数与现有 `.anim` 相同：时间在第一帧之前取第一帧，最后一帧之后取最后一帧；`step` 取左键，`linear` 按时间插值。

## 时间线白线

只画在贴纸片段上：原生 `StickerElement`，以及 `effectType` 以 `vfxpack:` 开头且包类型是 `sticker` 的 `EffectElement`。

设片段宽度为 `W` 像素，`span` 为秒：

```ts
export function stickerAnimSpans(args: {
  clipDuration: number;
  inDuration: number;
  outDuration: number;
  hasLoop: boolean;
}): { in: [number, number] | null; out: [number, number] | null; loop: [number, number] | null } {
  const D = Math.max(0, args.clipDuration);
  const inDur = args.inDuration > 0 ? Math.min(args.inDuration, D) : 0;
  const outDur = args.outDuration > 0 ? Math.min(args.outDuration, D) : 0;
  const inSpan = inDur > 0 ? [0, inDur] as [number, number] : null;
  const outSpan = outDur > 0 ? [D - outDur, D] as [number, number] : null;
  const loopStart = inSpan ? inSpan[1] : 0;
  const loopEnd = outSpan ? outSpan[0] : D;
  const loop = args.hasLoop && loopEnd - loopStart > 0.0001
    ? [loopStart, loopEnd] as [number, number]
    : null;
  return { in: inSpan, out: outSpan, loop };
}
```

每条 span 画一条高 2px 的白线，贴在片段内容底边之上 4px。右端用一个朝右的三角箭头，宽 6px，算在线长里面，不另占时间。线不接收指针事件。

## 编辑器里怎么做

视图菜单增加「贴纸动画」，和现有「动画」分开。面板打开时：

- 若工程 Pack type 不是 `sticker-anim`，面板只显示一行说明，让用户到工程设置里改类型。不自动改类型。
- 类型是 `sticker-anim` 时，面板编辑 `project.stickerMotion`。场景物体的动画控制器和 timeline 不动。

面板内容：

- Phase：In / Out / Loop。切换 phase 时，`in`/`out` 把 `loop` 设为 `clamp`，`loop` 把 `loop` 设为 `loop`。
- Duration：秒，最小 0.1。改时长只改 `duration`，不缩放已有关键帧。
- 五个通道。每条可以添加关键帧（时间默认当前播放头，数值默认该通道缺省值）、改时间、改数值、删除。插值默认 linear。
- 播放 / 停止。
- 开关「播放贴花 timeline」，默认开。存在 `project.stickerMotion.playStickerTimeline`。

播放时钟：

- 贴纸动画时间从 0 增加。phase 为 loop 时对 `duration` 取模，否则停在 `duration`。
- 开关打开时，同一帧用增量去推进贴花自己的 timeline（`editor.fccTimelineEditor.sampleAt`），超过贴花 timeline 时长后从 0 再开始。贴花没有 timeline 时这个开关不改变画面。
- 开关关闭时不调用 `sampleAt`，场景停在打开面板时的那一帧。

视口只在这个面板打开且类型为 `sticker-anim` 时进入预览：

1. 场景照常画进一张透明缓冲（棋盘格不要画进这张图）。
2. 安全框里先画棋盘格。
3. 用采样姿态把缓冲贴上去：缩放乘 `scale`，旋转加 `rotate`，平移按上面的像素规则，`gl_FragColor = texel * opacity`。
4. 面板关闭后视口回到现在的画法，方便继续改贴花场景。

导出 `sticker-anim` 时只写 `manifest.json` 和已有的 `preview/poster.png`、`preview/hover.gif`。不写 scene、材质、着色器、贴花自己的 `.anim`。`id` 用 `freecapcut.sticker-anim.` 加工程名的 slug。没有关键帧也可以导出，效果是恒等姿态。

工程 json 的 `project.stickerMotion` 随工程保存。没有这块时读出来是空运动：duration 0.5，phase `in`，tracks 空，`playStickerTimeline` true。

## 剪辑端

启动时 `fetch("/vfxpacks/sticker-anims/index.json")`。文件不存在或解析失败时动画库为空，不报阻塞错误。数组里每个文件名再 fetch 成 blob，走现有 `loadPack`，`type === "sticker-anim"` 才 `registerPack`。这些包不进贴纸素材格，不能拖到时间线上。

贴纸属性的 Animation 页三个标签按 `phase` 列包。卡片用现有 poster / hover。点击选中，再点取消。英文界面：In、Out、Loop，名字用 `displayName`。

合成发生在贴纸 `stickerRT` 已经画完、`blitTextureToTarget` 贴到画面上的那一次。给 blit shader 增加 `uOpacity`，默认 1。`readStickerPlacement` 的 scale、rotate、position 按「播放合成」改过再写入现有 uniform。`uOpacity` 为 1 且姿态是恒等时，画面与现在一致。

## 文件

编辑器：

- 新建 `three.js/editor/js/sticker-motion/StickerMotion.js`：路径表、缺省、归一化、采样、多姿态合成。
- 新建 `three.js/editor/js/sticker-motion/StickerMotionPanel.js`：面板 UI 和播放时钟。
- 新建 `three.js/editor/js/sticker-motion/StickerMotionPreview.js`：棋盘格和姿态 blit。
- 改 `Viewport.js`：面板打开时走预览。
- 改 `Sidebar.Project.VfxPack.js`、`Strings.js`、`Config.js`：类型和 phase。
- 改 `Editor.js`：`project.stickerMotion` 读写，`toggleStickerAnimPanel`。
- 改 `Menubar.View.js`、`index.html`：菜单和脚本版本号。
- 改 `VfxPackExporter.js`：`sticker-anim` 只写 manifest 和预览图。

剪辑端：

- 新建 `freefilmcut/apps/web/src/vfxpack/sticker-motion.ts`：与编辑器相同的采样、合成、`stickerAnimSpans`。
- 新建 `freefilmcut/apps/web/src/vfxpack/__tests__/sticker-motion.test.ts`。
- 新建 `freefilmcut/apps/web/src/vfxpack/load-sticker-anims.ts`。
- 改 `types.ts`、`pack-placement.ts`：`sticker-anim` 不映射成 effect，不产生时间线拖放。
- 改 `timeline/types.ts`：`stickerAnims` 加到 `StickerElement` 和 `EffectElement`。
- 改 `sticker-properties-view.tsx`：三个标签列出对应 phase 的包。
- 新建 `timeline/components/sticker-anim-marks.tsx`，由 `timeline-element.tsx` 在片段底部挂上。
- 改 `three-compositor.ts`：blit 前合成姿态，shader 乘 `uOpacity`。
- 新建 `public/vfxpacks/sticker-anims/index.json`，内容先为 `[]`。

共享逻辑以剪辑端的 `sticker-motion.ts` 单测为准。编辑器的 `StickerMotion.js` 保持同样的函数名和公式，避免两套语义。

## 任务

### 1. 采样和区间

先写 `sticker-motion.test.ts`，再实现 `sticker-motion.ts`。

断言：

- 空 tracks 在任意时间都是恒等姿态。
- opacity 两键 0 和 1、duration 0.5，在 0.25 秒得到 0.5。
- `step` 在两键之间取左键。
- 只有 scale 时 opacity 仍是 1，rotate 仍是 0。
- 三个姿态 opacity 0.5、0.5、1 合成为 0.25；scale 2 和 0.5 合成为 1；rotate 10 和 -3 合成为 7；positionX 0.2 和 -0.1 合成为 0.1。
- `stickerAnimSpans({ clipDuration: 5, inDuration: 0.5, outDuration: 0.5, hasLoop: true })` 得到 in `[0, 0.5]`、out `[4.5, 5]`、loop `[0.5, 4.5]`。
- 只有入场时 loop 是 `[inDuration, D]`。只有出场时 loop 是 `[0, D - outDuration]`。都没有时 loop 是 `[0, D]`。
- `inDuration + outDuration >= D` 时 loop 为 null。
- `hasLoop: false` 时 loop 为 null，入场出场仍在。

运行：在 `freefilmcut/apps/web` 执行 `bun test src/vfxpack/__tests__/sticker-motion.test.ts`。

然后把同一实现抄到 `StickerMotion.js`，用 `node --check` 确认语法。

### 2. 工程设置和保存

`PACK_TYPES` 增加 `sticker-anim`，中文「贴纸动画」，英文 `Sticker animation`。类型下拉在选中它时多一个 Phase 下拉，写入 `project/vfxpack/stickerAnimPhase`。

`Config.js` 默认：`project/vfxpack/stickerAnimPhase` 为 `in`，`project/stickerMotion` 不放 localStorage（存在工程 json 里，避免关键帧撑满配额）。

`Editor.toJSON` 的 `project.stickerMotion` 写出当前运动。`fromJSON` 读回；没有该字段时用空运动。读回后派发 `stickerMotionChanged`。

空运动：

```js
{
  phase: "in",
  duration: 0.5,
  loop: "clamp",
  playStickerTimeline: true,
  tracks: []
}
```

### 3. 贴纸动画面板

`index.html` 在 `new Animation(editor)` 旁创建 `new StickerMotionPanel(editor)`。视图菜单加一项，调用 `editor.toggleStickerAnimPanel`。脚本查询串用新的 `fcc-ui` 版本，沿现有 import 链往上改到 `index.html`。

面板打开时设置 `editor.stickerMotionPreview = true` 并 `sceneGraphChanged`。关闭时设回 false。

通道行用现有 `UINumber`。播放用 `requestAnimationFrame`，面板关闭或停止时取消。推进贴花 timeline 时若 `editor.fccTimelineEditor.sampleAt` 不存在，只播贴纸动画。

### 4. 视口预览

`StickerMotionPreview.js` 提供 `renderStickerMotionPreview(renderer, scene, camera, rect, pose)`。

- `rect` 沿用视口现在的安全框 CSS 像素矩形。
- 场景渲染到 `HalfFloat`、`NoColorSpace`、透明清除的 RT，尺寸为 `rect` 乘 pixel ratio。这一步复用现在的场景渲染，不把棋盘格放进 RT。
- 回到画布后，在 `rect` 里先画棋盘格（两种灰，格约 16 CSS 像素），再把 RT 按姿态贴上。
- 姿态缩放绕贴花中心。平移用 RT 宽高乘 position 比例，再乘 pixel ratio 得到缓冲像素。旋转单位从度转弧度，方向与剪辑端 blit 的 `uRotate` 一致（屏幕上正角度的视觉方向两边相同）。

`Viewport.js` 的常规渲染在 `editor.stickerMotionPreview && packType === "sticker-anim"` 时改走这个函数，不再走原来的直接上屏。后处理在这个预览模式下不启用；贴花场景本身的后处理不属于贴纸动画预览。

验收：打开爱心一类的贴花工程，类型改为贴纸动画，打开面板。无关键帧时贴花形状与原来一致，背后是棋盘格。Opacity 在 0 和 duration 两处打 0 和 1，播放时贴花从透明变到不透明，模型之间的重叠仍是整张一起淡。

### 5. 导出

`buildVfxPack` 发现类型是 `sticker-anim` 时走单独分支：

- manifest 用本文的包格式。`phase` 取 `stickerMotion.phase`。`displayName` 用导出对话框里的名字。
- `motion.tracks` 只保留五条合法路径，丢掉空 keys。
- 预览图沿用现在的 poster / hover 写入。没有预览图就不写 `preview` 字段。
- 不调用场景收集。

导出的 zip 用现有 `loadPack` 能读回，且 `normalize` 之后类型仍是 `sticker-anim`。

### 6. 剪辑端装载和属性

`load-sticker-anims.ts` 在应用启动、贴纸面板第一次打开时调用一次。`pack-placement.ts` 的 `PRIMARY_VFX_PACK_TYPES` 增加 `sticker-anim`，但 `getVfxPackPlacement` 对它返回「不可拖放」：`insertTrackType: null`，`targetElementTypes: []`。`normalizeVfxPackType` 不要把 `sticker-anim` 收成 effect。

`StickerAnimationPage` 接收当前 element 和 trackId。三个标签过滤 `getPackRegistrySnapshot().packs`。点击写入 `stickerAnims` 对应字段并走现有 element 更新。再点同一个 `packId` 则把该字段设为 null。

### 7. 合成进贴纸 blit

在 `three-compositor.ts` 贴纸分支，`readStickerPlacement` 之后：

```ts
const pose = resolveAppliedStickerPose({ element, localTimeSec, packs });
const placedW = containWidth * placement.scaleX;
const placedH = containHeight * placement.scaleY;
placement.scaleX *= pose.scale;
placement.scaleY *= pose.scale;
placement.rotate += pose.rotate;
placement.positionX += pose.positionX * placedW;
placement.positionY += pose.positionY * placedH;
blitMaterial.uniforms.uOpacity.value = pose.opacity;
```

`resolveAppliedStickerPose` 用任务 1 的采样和合成。找不到 packId 的阶段当没有这段动画。shader 末尾改为 `gl_FragColor = texture2D(tDiffuse, uv) * uOpacity;`。其它非贴纸 blit 把 `uOpacity` 设为 1。

验收：同一张贴花，不挂动画时和现在逐帧一致。只挂 Fade In 时，片段开头 opacity 按曲线变化，超过包时长后回到恒等。贴花自己的 timeline 仍在整段里播放。

### 8. 片段白线

`sticker-anim-marks.tsx` 调用 `stickerAnimSpans`，用片段 `duration / TICKS_PER_SECOND` 当 `clipDuration`。三条线绝对定位在 `timeline-element.tsx` 片段按钮内部的底边，`pointer-events: none`。左端百分比是 `start / D * 100`，宽度是 `(end - start) / D * 100`。箭头是右端的 CSS 三角，颜色白色，不伸出片段圆角裁切之外。

没有 `stickerAnims` 时不画。循环区间为 null 时不画循环线。

## 不做

- 不在片段上改动画时长。
- 不做「无」资源包。
- 不把贴纸动画放进贴纸素材格。
- 不改贴花自己的 `.anim` 格式。
- 属性里不提供第二套时长数字。
