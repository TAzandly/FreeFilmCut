# FreeFilmCut project asset layout

When you create a **New** project, the editor asks you to:

1. Pick a **parent** folder (File System Access API / Chrome on localhost).
2. Enter a **特效项目名称** (VFX project name).
3. Create a **subfolder** named after a Windows-safe version of that title, then bind the editor to it.

## Directory tree

```
{Parent}/
  {SafeProjectName}/          ← bound project root (status bar "Folder")
    project.json
    assets/
      shaders/
      textures/               ← imported images
      videos/
      sequences/              ← image sequences (reserved)
      animations/
      meshes/                 ← imported 3D meshes
      fonts/
      audio/
    exports/                  ← .vfxpack writes here when bound
    docs/
```

## Safe folder name

Illegal Windows characters `<>:"/\\|?*` and control chars are replaced with `_`.
Trailing dots/spaces are stripped. Reserved device names (`CON`, `PRN`, …) get a `_proj` suffix.
If `{SafeProjectName}` already exists, a `_YYYYMMDD_HHMM` suffix is added.

## Imports

File → Import / drag-drop copies matching assets into `assets/...` when a project is bound
(textures, meshes, videos, audio, fonts, shaders). The editor still loads from the browser `File` object as before.

## Export

**File → Export → VfxPack**: if a project folder is bound, the pack is written to `exports/{name}.vfxpack`;
otherwise the browser downloads it.

## Chinese UI notes

- 新建：先选**父目录**，再输入**特效项目名称**，自动创建子文件夹与资源目录。
- 媒体资源在 `assets/` 下；`exports/` 与 `docs/` 在项目根目录。
- 状态栏显示绑定的**项目子文件夹**名；标题可改，不重命名磁盘文件夹。
- 导出 VfxPack 默认进 `exports/`。
