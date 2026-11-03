import os
import json
import shutil
from datetime import datetime

root = r"D:\GrokbotWork\FreeFilmCut"
test_root = os.path.join(root, "test")
scratch = os.path.join(test_root, "agent-scratch")
backups = os.path.join(test_root, "backups")
os.makedirs(scratch, exist_ok=True)
os.makedirs(backups, exist_ok=True)

keep_dirs = {
    "freefilmcut",
    "three.js",
    "docs",
    "projects",
    "scripts",
    "node_modules",
    ".codegraph",
    ".workbuddy",
    "test",
}
keep_files = {
    "README.md",
    "package.json",
    "start-asset-editor.bat",
    "start-opencut.bat",
}

moved = []
skipped = []

# 1) Move top-level scratch into test/agent-scratch (preserve name)
for name in sorted(os.listdir(root)):
    if name in keep_dirs or name in keep_files:
        continue
    if name.endswith(".bat"):
        continue
    src = os.path.join(root, name)
    dst = os.path.join(scratch, name)
    if os.path.exists(dst):
        # avoid clobber: stamp
        dst = os.path.join(scratch, name + "__" + datetime.now().strftime("%H%M%S"))
    try:
        shutil.move(src, dst)
        moved.append({"from": name, "to": os.path.relpath(dst, root).replace("\\", "/"), "kind": "scratch"})
    except Exception as e:
        skipped.append({"from": name, "error": str(e)})

# 2) Move .bak* beside live sources into test/backups/<relpath>
bak_suffixes = (".bak", ".bak_corrupt", ".bak_corrupt2")
bak_extra = []
for dp, dns, fs in os.walk(root):
    # skip huge / irrelevant
    parts = dp.replace("/", "\\").split("\\")
    if "node_modules" in parts or ".next" in parts or "test" in parts:
        continue
    for f in fs:
        low = f.lower()
        if (
            low.endswith(".bak")
            or ".bak-" in low
            or low.endswith(".bak_corrupt")
            or low.endswith(".bak_corrupt2")
            or ".bak-savefix" in low
            or ".bak-below" in low
            or ".bak-uinput" in low
            or ".bak-fcc" in low
        ):
            src = os.path.join(dp, f)
            rel = os.path.relpath(src, root)
            dst = os.path.join(backups, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.exists(dst):
                skipped.append({"from": rel, "error": "dst exists"})
                continue
            try:
                shutil.move(src, dst)
                moved.append(
                    {
                        "from": rel.replace("\\", "/"),
                        "to": os.path.relpath(dst, root).replace("\\", "/"),
                        "kind": "backup",
                    }
                )
            except Exception as e:
                skipped.append({"from": rel, "error": str(e)})

manifest = {
    "created": datetime.now().isoformat(timespec="seconds"),
    "note": "Moved only; nothing deleted. To restore a file: move it back from 'to' to 'from' under FreeFilmCut root.",
    "formal_unit_tests": "Left in place under freefilmcut/**/__tests__ and *.test.ts so vitest/jest keep working. See test/README.md.",
    "moved": moved,
    "skipped": skipped,
}
man_path = os.path.join(test_root, "MOVE_MANIFEST.json")
with open(man_path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

readme = """# FreeFilmCut / test

整理于 2026-10-22。原则：**只搬迁、不删除**，出问题可按清单回退。

## 目录

| 路径 | 内容 |
|------|------|
| `agent-scratch/` | 根目录历史调试脚本、`_tmp_*`、`_fx*`、diagnose/repro/patch 等 |
| `backups/` | 从源码旁挪走的 `.bak*` / `.bak_corrupt*`（保留相对路径） |
| `MOVE_MANIFEST.json` | 每条 `from` → `to`，回退时把文件移回 `from` |

## 正式单测（未搬）

`freefilmcut/apps/web/src/**/__tests__` 与 `*.test.ts` 仍留在源码旁，避免打断测试运行器。需要集中查看时可在仓库内搜 `__tests__`。

## 回退示例

```powershell
# 查看清单
Get-Content .\\test\\MOVE_MANIFEST.json | Select-Object -First 40

# 恢复某一个备份到原位（按清单里的 from/to）
Move-Item .\\test\\backups\\three.js\\editor\\js\\textanim\\TextAnimBuiltins.js.bak_corrupt `
  .\\three.js\\editor\\js\\textanim\\TextAnimBuiltins.js.bak_corrupt
```

不要把 `agent-scratch` 里的脚本当生产入口；正式启动仍用根目录 `start-opencut.bat` / `start-asset-editor.bat`。
"""
with open(os.path.join(test_root, "README.md"), "w", encoding="utf-8", newline="\n") as f:
    f.write(readme)

print("moved", len(moved), "skipped", len(skipped))
print("scratch entries", len(os.listdir(scratch)))
print("manifest", man_path)
