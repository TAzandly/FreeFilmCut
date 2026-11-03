# Local project folder (Editor)

FreeFilmCut Three.js Editor can bind a **local directory** and keep `project.json` there.

## How it works

1. **File → New (新建项目)** — pick a **parent** folder, enter **特效项目名称**, create `{name}/` + asset dirs (see `project-asset-layout.md`)  
   - Confirms discard of unsaved work.  
   - **Always** opens a folder picker (`showDirectoryPicker`, Chrome/Edge on `localhost` or HTTPS).  
   - **Cancel picker or unsupported browser → scene is NOT cleared.**  
   - On success: clears the scene, remembers the folder, writes an initial `project.json`.  
   - Example templates under New also pick a folder before loading.

2. **File → Save**  
   - Writes `project.json` into the bound folder when one is set.  
   - If none: offers to pick a folder; cancel falls back to downloading `project.json`.

3. **File → Set Project Folder…**  
   - Re-bind / change the folder and save current project into it.

4. **Autosave**  
   - Still saves to IndexedDB.  
   - When a folder is bound, also writes `project.json` into that folder.

5. **Status bar**  
   - Shows `Folder: <name>` when a project folder is active.

## Browser requirement

- **Chrome / Edge** (File System Access API).  
- Works on **http://localhost** (python `http.server` is fine).  
- Folder handles are stored in IndexedDB (`freecapcut-editor-project`) and restored across reloads when permission remains granted.

## Code

| File | Role |
|------|------|
| `editor/js/ProjectFolder.js` | Picker, IDB handle, read/write `project.json` |
| `editor/js/Menubar.File.js` | New / Save / Set Folder |
| `editor/js/Menubar.Status.js` | Folder name label |
| `editor/index.html` | Attach `editor.projectFolder`, autosave → folder |

## Project name

- Editable in the **status bar** (right) and under **Sidebar → Project → App → Title**.
- Stored in `project.json` as `project.title` / `project.name` and `metadata.title`.
- On **New**, defaults to the chosen **folder name**, or 「未命名项目」 / Untitled Project.
- Renaming does **not** rename the OS folder.

### Distinguishable VFX names

- On **New**, after folder pick you are prompted for a **特效项目名称**.
- Default = folder name; generic folders (`project` / `新建文件夹` / …) get a `_YYYYMMDD_HHMM` suffix.
- Shown in status bar, browser tab (`FreeFilmCut — …`), and as the default **.vfxpack** export name.
- File on disk stays `project.json` (title is inside JSON).

Media assets live under assets/; exports/ and docs/ stay at project root. See project-asset-layout.md.
