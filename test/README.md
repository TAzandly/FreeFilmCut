# FreeFilmCut / test

整理原则：**只搬迁、不删除**，出问题可按清单回退。

最近一次清理：`2026-11-02`（根目录 `_tmp_*` / `_hello_*` / inspect 产物、一次性 rename bat、git recovery 备份）。

## 目录

| 路径 | 内容 |
|------|------|
| `agent-scratch/` | 根目录历史调试脚本、`_tmp_*`、inspect 产物、一次性 bat 等 |
| `backups/` | 源码旁挪走的 `.bak*`，以及 `_backup_before_git_recovery_*` |
| `MOVE_MANIFEST.json` | 每条 `from` → `to`，回退时把文件移回 `from` |

## 正式单测（未搬）

`freefilmcut/apps/web/src/**/__tests__` 与 `*.test.ts` 仍留在源码旁，避免打断测试运行器。需要集中查看时可在仓库内搜 `__tests__`。

## 回退示例

```powershell
# 查看清单
Get-Content .\test\MOVE_MANIFEST.json | Select-Object -First 40

# 恢复某一个文件到原位（按清单里的 from/to）
Move-Item .\test\agent-scratch\_tmp_mg.mp4 .\
```

不要把 `agent-scratch` 里的脚本当生产入口；正式启动仍用根目录 `start-filmcut.bat` / `start-asset-editor.bat`。
