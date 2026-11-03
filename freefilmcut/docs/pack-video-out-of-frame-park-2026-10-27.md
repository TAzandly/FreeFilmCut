# vfxpack 内部视频越界播放修复（fcc-tl-flower-68）— 2026-10-27

## 现象

普通特效 vfx pack：播放头离开 pack 的 clip 后，其内部 timeline 控制的视频**继续播放**（含声音），把媒体放完为止；媒体播放完成后也不会按预期停住等 timeline 下一次播放。期望行为：

1. pack 内部视频播放完成 → 停住，直到 timeline 再次播放才重新开始；
2. **pack clip 的时间范围之外，内部视频完全不播放**。

## 根因：三套"暂停机制"合起来刚好漏掉出画场景

| 机制 | 覆盖的场景 | 漏掉的场景 |
| --- | --- | --- |
| `samplePackTimeline` → `seekVideo(obj, null)` | pack **在画内**时，内部 clip 范围外的元素停车 | pack 本身出画后无人调用 |
| `setPackVideoPreviewState`（fcc-tl-flower-54） | **transport 停止**时暂停全部 live 视频 | transport 播放中、clip 出画 |
| fcc-tl-flower-67 ended-park | 画内媒体播完停车 | 同上 |

关键事实（`syncPackScenes` 注释自己写明）：**注册过的 pack 场景常驻不销毁**（首次拖入秒显的优化），而 `syncPackVideos` 只访问"本帧被绘制"的 pack。于是播放头离开 clip 的那一刻，pack 的 `<video>` 元素停留在最后状态——playing、可能不静音——没有人再碰它，媒体自由跑完，声音一直响到播放结束。

## 修复：每帧停靠"本帧未绘制"的 pack

### 1. `vfxpack/pack-video.ts` — 新增 `pausePackSceneVideos({ root })`

遍历单个 pack 场景 root，对每个 `__fccVideo` 元素执行与 timeline 出画访问完全相同的 park 语义：

- **先静音**（Chromium 在未静音时动 currentTime 会咔咔响），再 `pause()`；
- 会话复位：`__fccTlWantPlay=false`、`__fccTlIdleParked=true`、`__fccTlInRange=false`、`__fccTlStartSeekDone=false`、`__fccTlLastCorrectionMs=0`、`__fccTlSeekTarget=currentTime`。

**不写 currentTime**：出画时画面不可见，seek 只增加 seek-storm 风险。复位 `__fccTlStartSeekDone` 保证重进 clip 时走 start-seek 分支——从 clip 位置强制药 seek 后 `play()`，而不是从停在半路的旧位置续播。

### 2. `services/renderer/compositor/three-compositor.ts` — `syncPackScenes()` 每帧调用

```ts
if (!this.lastFramePackIds.has(packId) && !activeOverlayIds.includes(packId)) {
    pausePackSceneVideos({ root: built.root });
}
```

- `lastFramePackIds` = 本帧 sceneEffect / transition 引用的 pack（`renderOnePack` 已驱动它们，不碰）；
- `activeOverlayIds` = 特效面板强制开启的 pack（`renderForcedOverlays` 每帧渲染驱动，不碰）；
- 其余 built pack（注册表常驻但出画）→ 停靠。幂等且廉价（已暂停元素是 no-op）。

flowerText / 文本模板场景在独立的 `flowerTextScenes` map，不在 `packScenes`，不受影响。

## 修复后的行为闭环

| 场景 | 机制 |
| --- | ---|
| 画内、媒体播完（clip 未结束） | fcc-tl-flower-67 ended-park |
| 播放头离开 pack clip（transport 播放中） | **新增**：`pausePackSceneVideos` 每帧停靠 |
| transport 停止 | fcc-tl-flower-54 `pauseAllPackVideos` |
| timeline 再次进入 clip / 再次播放 | `__fccTlStartSeekDone=false` → start-seek → 从 clip 位置重新 `play()` |

即用户要求的两条语义都成立：**播放完成即停，等 timeline 下一次播放；clip 之外内部视频不播放**。

## 校验

- 新增 `vfxpack/__tests__/pack-video-park.test.ts`（4 用例）：播放中元素被静音+暂停+会话复位；无视频对象 no-op；幂等；深层嵌套可达。
- `bun test src/vfxpack src/services/renderer/__tests__ src/params src/chroma-key` → **71 pass / 0 fail**
- eslint：`pack-video.ts` 28 个错误全部为存量（位置参数等旧风格），新函数（627 行起）0 命中；新测试文件 0。
- tsc：全量与基线一致（0 新增）。

## 附带事故记录：.git 损坏与恢复（与本修复无关，但同日发生）

跑 eslint 存量对比时执行了一次 `git stash` / `git stash pop`，之后发现 `.git` 遭受大范围破坏：`refs/` 目录消失、`objects/pack/*.pack` 数据文件丢失（只剩 .idx）、大量 loose objects 丢失、stash 引用指向失效对象——git 报 "not a git repository" / "bad object HEAD"。

**工作树完好无损**（stash 实际从未成功创建，所有未提交改动原样保留）。恢复过程：

1. 备份 `apps/web/src` + `docs` → `D:/GrokbotWork/FreeFilmCut/_backup_before_git_recovery_2026-10-27/`
2. 重建 `refs/heads/feat/timeline-nle` → 指向 `origin/main`（cf5e79e，packed-refs 幸存）
3. `git fetch origin main` 重新拉取对象库
4. `git fsck` 仅剩 reflog 失效条目（无害）

**代价**：feat/timeline-nle 上 4 个本地提交（NLE samplePackTimeline 系列）的提交历史塌缩——其内容如今以未提交修改的形式存在于工作树（`git status` 235 个文件）。内容零丢失，但建议尽快 `git add -A && git commit` 固化现状。剩余 reflog 坏条目可用 `git reflog expire --expire=now --all` 清除（可选）。
