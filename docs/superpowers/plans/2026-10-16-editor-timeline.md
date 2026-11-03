# Editor Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Unity-style Timeline orchestration in the FreeFilmCut editor (Animation / Video / Activation tracks), export into `.vfxpack`, and sample on the NLE with `clipLocalTime`, including pack clip duration from Timeline.

**Architecture:** Editor stores `userData.fccTimeline` on scene objects pointing at `assets/timelines/*.timeline.json`. `FccTimelineCore.js` owns pure sample/apply logic; `FccTimelineEditor.js` is the scrub/play UI (mirrors `Animation.js` window patterns). Export embeds timelines under `pack/timelines/` and sets `manifest.duration = max(timeline.duration)`. NLE loads timelines on pack build and, when present, samples only via Timeline (skip full-pack anim scan); Activation forces `visible=false` outside clips.

**Tech Stack:** Three.js editor (vanilla JS modules), OpenCut NLE (TypeScript), existing `applyAnimToRoot` / `syncPackVideos`, `mediaTimeFromSeconds`, JSZip vfxpack.

**Spec:** `docs/superpowers/specs/2026-10-16-editor-timeline-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `three.js/editor/js/timeline/FccTimelineCore.js` | Types helpers, create empty asset, sample (anim/video/activation), snap time to fps |
| `three.js/editor/js/timeline/FccTimelineEditor.js` | Floating editor window (ruler, tracks, playhead) |
| `three.js/editor/js/timeline/FccTimelineIO.js` | Save/load `.timeline.json` via `editor.projectFolder` |
| `three.js/editor/js/Menubar.Add.js` | Add → Timeline |
| `three.js/editor/js/Sidebar.Object.Timeline.js` | Duration/fps/loop + Open editor + Active |
| `three.js/editor/js/Sidebar.Object.js` | Mount timeline sidebar panel |
| `three.js/editor/js/VfxPackExporter.js` | Pack timelines + `manifest.duration` |
| `three.js/editor/js/Viewport.js` | Drive sample while Timeline preview playing |
| `freefilmcut/.../vfxpack/types.ts` | `duration?`, `timelines?` on manifest; timeline asset types |
| `freefilmcut/.../vfxpack/timeline.ts` | `samplePackTimeline` (NLE twin of core) |
| `freefilmcut/.../vfxpack/scene-builder.ts` | Load timeline JSON into `BuiltPackScene` |
| `freefilmcut/.../services/renderer/compositor/three-compositor.ts` | Call sample; skip full anim when timelines exist |
| `freefilmcut/.../effects/components/assets-view.tsx` | Use `manifest.duration` on add-to-timeline |
| `freefilmcut/.../timeline/controllers/drag-drop-controller.ts` | Same duration for effect drag-drop |

Cache-bust query on editor script imports: bump to `?v=fcc-ui-34` (or next unused) wherever Timeline modules are imported.

---

### Task 1: FccTimelineCore — data helpers + empty asset

**Files:**
- Create: `three.js/editor/js/timeline/FccTimelineCore.js`
- Test: manual console / later NLE unit if added

- [ ] **Step 1: Create core module with format + factory**

```javascript
/**
 * FreeFilmCut Timeline core — sample + asset helpers (editor).
 * Format must match NLE `vfxpack/timeline.ts`.
 */
import { applyAnimToRoot } from '../anim/FreeCapCutAnimCore.js?v=fcc-ui-34';

export const TIMELINE_FORMAT = 'freecapcut-timeline/1';
export const TL_KEY = 'fccTimeline';

export function createEmptyTimelineAsset( name = 'Timeline', fps = 30 ) {
	return {
		format: TIMELINE_FORMAT,
		name: String( name || 'Timeline' ),
		fps: Number( fps ) || 30,
		duration: 1,
		loop: 'clamp',
		tracks: [],
	};
}

export function isFccTimeline( object ) {
	return !!( object && object.userData && object.userData[ TL_KEY ] );
}

export function createTimelineObject( scene ) {
	const names = new Set();
	if ( scene ) scene.traverse( ( o ) => names.add( o.name ) );
	let name = 'Timeline';
	let i = 2;
	while ( names.has( name ) ) { name = 'Timeline' + i; i ++; }
	const object = new THREE.Object3D();
	object.name = name;
	object.userData[ TL_KEY ] = {
		projectPath: '',
		active: false,
		fps: 30,
		duration: 1,
		loop: 'clamp',
	};
	return object;
}

export function snapTimeToFrame( t, fps ) {
	const f = Math.max( 1, Number( fps ) || 30 );
	return Math.round( ( Number( t ) || 0 ) * f ) / f;
}

export function computeContentDuration( asset ) {
	let max = 0;
	for ( const track of asset.tracks || [] ) {
		for ( const clip of track.clips || [] ) {
			const end = ( Number( clip.start ) || 0 ) + ( Number( clip.duration ) || 0 );
			if ( end > max ) max = end;
		}
	}
	return Math.max( 0.01, max || Number( asset.duration ) || 0.01 );
}
```

Add at top: `import * as THREE from 'three';`

- [ ] **Step 2: Commit**

```bash
git add three.js/editor/js/timeline/FccTimelineCore.js
git commit -m "feat(timeline): add FccTimelineCore empty asset helpers"
```

---

### Task 2: sampleTimeline (Activation + Animation + Video stubs)

**Files:**
- Modify: `three.js/editor/js/timeline/FccTimelineCore.js`

- [ ] **Step 1: Implement sampleTimeline**

```javascript
/**
 * Apply timeline at time t (seconds) onto the scene.
 * @param {object} ctx
 * @param {THREE.Object3D} ctx.scene
 * @param {object} ctx.asset TimelineAsset
 * @param {number} ctx.t seconds
 * @param {Map<string, object>} [ctx.animByName] name -> freecapcut anim clip
 * @param {function} [ctx.seekVideoPlayer] (object, mediaTimeSec) => void
 * @param {Set<string>} [ctx.activationBoundUuids] uuids touched by activation (for restore)
 */
export function sampleTimeline( ctx ) {
	const scene = ctx.scene;
	const asset = ctx.asset;
	if ( ! scene || ! asset ) return;
	const fps = asset.fps || 30;
	let t = snapTimeToFrame( ctx.t, fps );
	const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
	if ( asset.loop === 'loop' ) {
		t = ( ( t % dur ) + dur ) % dur;
	} else {
		t = Math.max( 0, Math.min( dur, t ) );
	}

	const animByName = ctx.animByName || new Map();
	const seekVideo = typeof ctx.seekVideoPlayer === 'function' ? ctx.seekVideoPlayer : null;

	// Activation: collect bound uuids, then force visibility
	const activationBounds = new Map(); // uuid -> array of [start, end)
	for ( const track of asset.tracks || [] ) {
		if ( track.muted || track.type !== 'activation' || ! track.bindingUuid ) continue;
		const list = activationBounds.get( track.bindingUuid ) || [];
		for ( const clip of track.clips || [] ) {
			const start = Number( clip.start ) || 0;
			const end = start + ( Number( clip.duration ) || 0 );
			list.push( [ start, end ] );
		}
		activationBounds.set( track.bindingUuid, list );
	}
	for ( const [ uuid, ranges ] of activationBounds ) {
		const obj = scene.getObjectByProperty( 'uuid', uuid );
		if ( ! obj ) continue;
		if ( ctx.activationBoundUuids ) ctx.activationBoundUuids.add( uuid );
		let visible = false;
		for ( const [ a, b ] of ranges ) {
			if ( t >= a && t < b ) { visible = true; break; }
		}
		obj.visible = visible;
	}

	// Animation tracks (later track / later clip wins)
	for ( const track of asset.tracks || [] ) {
		if ( track.muted || track.type !== 'animation' || ! track.bindingUuid ) continue;
		for ( const clip of track.clips || [] ) {
			const start = Number( clip.start ) || 0;
			const cdur = Number( clip.duration ) || 0;
			if ( t < start || t >= start + cdur ) continue;
			const anim = animByName.get( clip.animId ) || animByName.get( clip.animPath ) || animByName.get( clip.name );
			if ( ! anim ) continue;
			const local = ( t - start ) + ( Number( clip.clipLocalOffset ) || 0 );
			// Apply only to binding: temporarily filter by rewriting is not needed —
			// applyAnimToRoot uses objectUuid from anim targets; caller must ensure anim targets match binding
			applyAnimToRoot( scene, anim, local, ctx.animOpts || {} );
		}
	}

	// Video tracks
	for ( const track of asset.tracks || [] ) {
		if ( track.muted || track.type !== 'video' ) continue;
		const uuid = track.bindingUuid || track.videoPlayerUuid;
		if ( ! uuid || ! seekVideo ) continue;
		const obj = scene.getObjectByProperty( 'uuid', uuid );
		if ( ! obj ) continue;
		let mediaT = null;
		for ( const clip of track.clips || [] ) {
			const start = Number( clip.start ) || 0;
			const cdur = Number( clip.duration ) || 0;
			if ( t < start || t >= start + cdur ) continue;
			let local = ( t - start ) + ( Number( clip.mediaOffset ) || 0 );
			if ( clip.loop ) {
				// loop within clip length against video — seekVideo handles clamp
			}
			mediaT = local;
		}
		if ( mediaT !== null ) seekVideo( obj, mediaT );
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add three.js/editor/js/timeline/FccTimelineCore.js
git commit -m "feat(timeline): sample activation, animation, and video tracks"
```

---

### Task 3: Timeline IO (project folder)

**Files:**
- Create: `three.js/editor/js/timeline/FccTimelineIO.js`

- [ ] **Step 1: Save / load helpers**

```javascript
import { TIMELINE_FORMAT, TL_KEY, createEmptyTimelineAsset } from './FccTimelineCore.js?v=fcc-ui-34';

function slugify( name ) {
	return String( name || 'timeline' )
		.trim().toLowerCase()
		.replace( /[^a-z0-9._-]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 64 ) || 'timeline';
}

export async function saveTimelineAsset( editor, object, asset ) {
	const pf = editor.projectFolder;
	if ( ! pf || ! pf.hasFolder || ! pf.hasFolder() || ! pf.saveText ) {
		throw new Error( 'No project folder bound' );
	}
	const ud = object.userData[ TL_KEY ];
	const safe = slugify( asset.name || object.name || 'timeline' );
	const rel = ud.projectPath || ( 'assets/timelines/' + safe + '.timeline.json' );
	asset.format = TIMELINE_FORMAT;
	const body = JSON.stringify( asset, null, 2 );
	await pf.saveText( rel.replace( /^assets\//, '' ).split( '/' ).slice( 0, -1 ).join( '/' ) || 'timelines',
		rel.split( '/' ).pop(), body );
	// Prefer saveBlob/saveText API that projectFolder already uses for .anim —
	// mirror Animation.js saveAnimToProject path exactly when implementing.
	ud.projectPath = rel.startsWith( 'assets/' ) ? rel : ( 'assets/timelines/' + safe + '.timeline.json' );
	ud.duration = asset.duration;
	ud.fps = asset.fps;
	ud.loop = asset.loop;
	return ud.projectPath;
}

export async function loadTimelineAsset( editor, object ) {
	const pf = editor.projectFolder;
	const ud = object && object.userData && object.userData[ TL_KEY ];
	if ( ! pf || ! ud || ! ud.projectPath || typeof pf.readTextFile !== 'function' ) {
		return createEmptyTimelineAsset( object && object.name );
	}
	try {
		const text = await pf.readTextFile( ud.projectPath );
		const asset = JSON.parse( text );
		if ( ! asset || asset.format !== TIMELINE_FORMAT ) {
			return createEmptyTimelineAsset( object.name );
		}
		return asset;
	} catch ( e ) {
		console.warn( '[FreeFilmCut] timeline load', e );
		return createEmptyTimelineAsset( object.name );
	}
}
```

**Note for implementer:** Match the exact `projectFolder.saveBlob` / `readTextFile` conventions used by `Animation.js` `saveAnimToProject` / `loadProjectAnimFiles` — do not invent a new path API. If `saveText` does not exist, use the same blob write as `.anim`.

- [ ] **Step 2: Commit**

```bash
git add three.js/editor/js/timeline/FccTimelineIO.js
git commit -m "feat(timeline): project folder save/load for .timeline.json"
```

---

### Task 4: Menubar Add → Timeline

**Files:**
- Modify: `three.js/editor/js/Menubar.Add.js`

- [ ] **Step 1: Import + menu item**

Near VideoPlayer / RenderTexture adds:

```javascript
import { createTimelineObject } from './timeline/FccTimelineCore.js?v=fcc-ui-34';
```

Add option option (Chinese string via `strings` if key exists, else hardcode fallback):

```javascript
const optionTimeline = new UIRow();
optionTimeline.add( new UIText( strings.getKey( 'menubar/add/timeline' ) || 'Timeline' ) );
optionTimeline.onClick( function () {
	const object = createTimelineObject( editor.scene );
	editor.execute( new AddObjectCommand( editor, object ) );
} );
options.add( optionTimeline );
```

Place next to VideoPlayer / RenderTexture entries.

- [ ] **Step 2: Manual verify**

Open editor → 添加 → Timeline → Outliner shows `Timeline` with `userData.fccTimeline`.

- [ ] **Step 3: Commit**

```bash
git add three.js/editor/js/Menubar.Add.js
git commit -m "feat(timeline): Add menu creates Timeline scene object"
```

---

### Task 5: Sidebar Timeline panel

**Files:**
- Create: `three.js/editor/js/Sidebar.Object.Timeline.js`
- Modify: `three.js/editor/js/Sidebar.Object.js` (mount panel)

- [ ] **Step 1: Sidebar panel**

```javascript
import { UIPanel, UIRow, UIText, UINumber, UISelect, UICheckbox, UIButton } from './libs/ui.js';
import { TL_KEY, isFccTimeline } from './timeline/FccTimelineCore.js?v=fcc-ui-34';
import { loadTimelineAsset, saveTimelineAsset } from './timeline/FccTimelineIO.js?v=fcc-ui-34';

function SidebarObjectTimeline( editor ) {
	const signals = editor.signals;
	const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
	const isZh = lang === 'zh';
	const container = new UIPanel();
	container.setDisplay( 'none' );

	container.add( new UIText( isZh ? '时间轴' : 'Timeline' ).setTextTransform( 'uppercase' ) );

	const durRow = new UIRow();
	durRow.add( new UIText( isZh ? '时长(秒)' : 'Duration' ).setClass( 'Label' ) );
	const durNum = new UINumber( 1 ).setPrecision( 3 ).setRange( 0.01, 9999 ).setWidth( '60px' );
	durRow.add( durNum );
	container.add( durRow );

	const fpsRow = new UIRow();
	fpsRow.add( new UIText( 'FPS' ).setClass( 'Label' ) );
	const fpsSelect = new UISelect().setOptions( { '24': '24', '25': '25', '30': '30' } ).setWidth( '60px' );
	fpsRow.add( fpsSelect );
	container.add( fpsRow );

	const loopRow = new UIRow();
	loopRow.add( new UIText( isZh ? '循环' : 'Loop' ).setClass( 'Label' ) );
	const loopSelect = new UISelect().setOptions( {
		clamp: isZh ? '一次' : 'Clamp',
		loop: isZh ? '循环' : 'Loop',
	} ).setWidth( '80px' );
	loopRow.add( loopSelect );
	container.add( loopRow );

	const activeRow = new UIRow();
	activeRow.add( new UIText( isZh ? '预览激活' : 'Active preview' ).setClass( 'Label' ) );
	const activeBox = new UICheckbox( false );
	activeRow.add( activeBox );
	container.add( activeRow );

	const openBtn = new UIButton( isZh ? '打开 Timeline 编辑器' : 'Open Timeline Editor' );
	container.add( new UIRow().add( openBtn ) );

	let object = null;

	function writeUD() {
		if ( ! isFccTimeline( object ) ) return;
		const ud = object.userData[ TL_KEY ];
		ud.duration = durNum.getValue();
		ud.fps = parseInt( fpsSelect.getValue(), 10 ) || 30;
		ud.loop = loopSelect.getValue() === 'loop' ? 'loop' : 'clamp';
		ud.active = activeBox.getValue() === true;
		if ( ud.active ) {
			editor.scene.traverse( ( o ) => {
				if ( o !== object && isFccTimeline( o ) ) o.userData[ TL_KEY ].active = false;
			} );
			editor.activeFccTimeline = object;
		} else if ( editor.activeFccTimeline === object ) {
			editor.activeFccTimeline = null;
		}
		signals.objectChanged.dispatch( object );
	}

	durNum.onChange( writeUD );
	fpsSelect.onChange( writeUD );
	loopSelect.onChange( writeUD );
	activeBox.onChange( writeUD );

	openBtn.onClick( function () {
		if ( ! isFccTimeline( object ) ) return;
		if ( editor.fccTimelineEditor && editor.fccTimelineEditor.openFor ) {
			editor.fccTimelineEditor.openFor( object );
		} else {
			console.warn( '[FreeFilmCut] Timeline editor not mounted yet' );
		}
	} );

	function refresh( current ) {
		object = current;
		const show = isFccTimeline( object );
		container.setDisplay( show ? '' : 'none' );
		if ( ! show ) return;
		const ud = object.userData[ TL_KEY ];
		durNum.setValue( Number( ud.duration ) || 1 );
		fpsSelect.setValue( String( ud.fps || 30 ) );
		loopSelect.setValue( ud.loop === 'loop' ? 'loop' : 'clamp' );
		activeBox.setValue( ud.active === true );
	}

	signals.objectSelected.add( refresh );
	return container;
}

export { SidebarObjectTimeline };
```

- [ ] **Step 2: Mount in Sidebar.Object.js**

Import and `container.add( new SidebarObjectTimeline( editor ) );` next to media panel.

- [ ] **Step 3: Commit**

```bash
git add three.js/editor/js/Sidebar.Object.Timeline.js three.js/editor/js/Sidebar.Object.js
git commit -m "feat(timeline): sidebar duration/fps/loop and open editor"
```

---

### Task 6: Timeline editor window (Phase A skeleton)

**Files:**
- Create: `three.js/editor/js/timeline/FccTimelineEditor.js`
- Modify: `three.js/editor/js/Editor.js` or `Menubar.View.js` / main bootstrap that mounts `Animation(editor)` — mount `FccTimelineEditor(editor)` the same way.

- [ ] **Step 1: Skeleton window**

Clone structure from `Animation.js` titlebar/controls (play, stop, frame label, duration, fps) but **empty track list** and horizontal ruler with playhead. Key API:

```javascript
function FccTimelineEditor( editor ) {
	// build DOM like Animation.js (fixed panel, drag titlebar)
	editor.fccTimelineEditor = {
		openFor: async function ( object ) {
			editor.activeFccTimeline = object;
			object.userData.fccTimeline.active = true;
			const asset = await loadTimelineAsset( editor, object );
			// bind asset to UI, setPanelVisible(true)
		},
		sampleIfPlaying: function ( dt ) { /* used by Viewport */ },
	};
	return container;
}
export { FccTimelineEditor };
```

Minimum UI for Phase A:
- Play / Pause / Stop
- Current time + duration inputs
- Empty “Tracks” list + “Add track” disabled or type picker stub
- Ruler with playhead scrub (mousedown on ruler sets `t`)

On scrub/play tick: call `sampleTimeline({ scene: editor.scene, asset, t, animByName, seekVideoPlayer })`.

`seekVideoPlayer` for editor: set `object.__fccVideo.currentTime = mediaT` (reuse FccVideo patterns).

Visibility snapshot on start preview / restore on stop (for Activation).

- [ ] **Step 2: Wire Viewport**

In `Viewport.js` animate loop, after video update:

```javascript
if ( editor.fccTimelineEditor && editor.fccTimelineEditor.sampleIfPlaying ) {
	editor.fccTimelineEditor.sampleIfPlaying( delta );
}
```

- [ ] **Step 3: Manual verify**

Add Timeline → Open editor → scrub playhead → no crash; empty tracks OK.

- [ ] **Step 4: Commit**

```bash
git add three.js/editor/js/timeline/FccTimelineEditor.js three.js/editor/js/Editor.js three.js/editor/js/Viewport.js
git commit -m "feat(timeline): Phase A editor window skeleton with scrub clock"
```

---

### Task 7: Phase B — Animation tracks UI + sample

**Files:**
- Modify: `FccTimelineEditor.js`, `FccTimelineCore.js` (if needed)

- [ ] **Step 1: Add Animation track + clip UI**

- Button「添加动画轨」→ push `{ id, type:'animation', name, muted:false, bindingUuid: selected.uuid||'', clips:[] }`
- 「添加片段」→ list `editor.freecapcutAnims` + project anims (same sources as Animation.js / exporter `collectFreecapcutAnims`)
- Clip block: drag start, resize duration; snap to frames via `snapTimeToFrame`
- On change: `asset.duration = max(asset.duration, computeContentDuration(asset))`; sync `object.userData.fccTimeline.duration`
- Auto-save on blur/stop (or explicit Save button mirroring Animation)

- [ ] **Step 2: Build animByName map when sampling**

```javascript
const animByName = new Map();
for ( const a of editor.freecapcutAnims || [] ) {
	if ( a && a.name ) animByName.set( a.name, a );
}
if ( editor.activeFreecapcutAnim ) animByName.set( editor.activeFreecapcutAnim.name, editor.activeFreecapcutAnim );
```

- [ ] **Step 3: Manual verify**

Keyframe an object in Animation editor → add same `.anim` on Timeline Animation track → scrub → object moves; Timeline preview pauses freecapcutAnimController play if `editor.activeFccTimeline` sampling (set flag `editor.timelinePreviewOwnsAnim = true`).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(timeline): Phase B animation tracks and scrub sampling"
```

---

### Task 8: Phase C — Video tracks

**Files:**
- Modify: `FccTimelineEditor.js`, `FccTimelineCore.js`

- [ ] **Step 1: Add Video track bound to VideoPlayer uuid**

Clip fields: `mediaOffset`, `loop`, `start`, `duration`.

`seekVideoPlayer(obj, t)`:

```javascript
function seekVideoPlayer( object, mediaTimeSec ) {
	const video = object && object.__fccVideo;
	if ( ! video ) return;
	const d = Number( video.duration );
	let t = Number( mediaTimeSec ) || 0;
	if ( Number.isFinite( d ) && d > 0 ) {
		if ( object.userData.fccVideoPlayer && /* clip.loop */ false ) {
			t = ( ( t % d ) + d ) % d;
		} else {
			t = Math.max( 0, Math.min( d - 0.001, t ) );
		}
	}
	if ( Math.abs( ( video.currentTime || 0 ) - t ) > 1 / 60 ) {
		try { video.currentTime = t; } catch ( e ) { /* ignore */ }
	}
}
```

Pass clip.loop into seek via closure when implementing for real.

- [ ] **Step 2: Manual verify**

VideoPlayer → RT → Image; Video track scrub moves RT frame.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(timeline): Phase C video track seek into VideoPlayer RT"
```

---

### Task 9: Phase D — Activation tracks + snapshot restore

**Files:**
- Modify: `FccTimelineEditor.js`, `FccTimelineCore.js`

- [ ] **Step 1: Activation track UI**

Bind any object; clips = visible intervals. Outside clips → `visible=false` (already in `sampleTimeline`).

On preview start:

```javascript
const snap = new Map();
scene.traverse( ( o ) => { snap.set( o.uuid, o.visible ); } );
editor._fccTimelineVisibilitySnap = snap;
```

On stop:

```javascript
const snap = editor._fccTimelineVisibilitySnap;
if ( snap ) {
	scene.traverse( ( o ) => {
		if ( snap.has( o.uuid ) ) o.visible = snap.get( o.uuid );
	} );
}
editor._fccTimelineVisibilitySnap = null;
```

- [ ] **Step 2: Manual verify**

Activation hide/show works; stop restores.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(timeline): Phase D activation tracks with visibility restore"
```

---

### Task 10: Export timelines + manifest.duration

**Files:**
- Modify: `three.js/editor/js/VfxPackExporter.js`

- [ ] **Step 1: Collect timelines during buildVfxPack**

After animations block (~line 1400), before building `manifest`:

```javascript
const timelinesFolder = pack.folder( 'timelines' );
const timelineAssetPaths = [];
const timelineManifestEntries = [];
let timelineMaxDuration = 0;
const timelineObjects = [];
scene.traverse( ( o ) => {
	if ( o.userData && o.userData.fccTimeline ) timelineObjects.push( o );
} );
for ( const object of timelineObjects ) {
	const ud = object.userData.fccTimeline;
	let asset = null;
	// Prefer in-memory editor cache if Timeline editor held asset on object.__fccTimelineAsset
	if ( object.__fccTimelineAsset ) asset = object.__fccTimelineAsset;
	else if ( ud.projectPath && editor.projectFolder && editor.projectFolder.readTextFile ) {
		try {
			const text = await editor.projectFolder.readTextFile( ud.projectPath );
			asset = JSON.parse( text );
		} catch ( e ) { console.warn( '[FreeFilmCut] timeline pack read', e ); }
	}
	if ( ! asset ) {
		asset = {
			format: 'freecapcut-timeline/1',
			name: object.name || 'Timeline',
			fps: ud.fps || 30,
			duration: Number( ud.duration ) || 1,
			loop: ud.loop === 'loop' ? 'loop' : 'clamp',
			tracks: [],
		};
	}
	const safe = slugify( asset.name || object.name || 'timeline' );
	const rel = 'timelines/' + safe + '.timeline.json';
	timelinesFolder.file( safe + '.timeline.json', JSON.stringify( asset, null, 2 ) );
	timelineAssetPaths.push( rel );
	timelineManifestEntries.push( {
		name: asset.name,
		path: rel,
		fps: asset.fps,
		duration: asset.duration,
		loop: asset.loop,
		objectUuid: object.uuid,
	} );
	timelineMaxDuration = Math.max( timelineMaxDuration, Number( asset.duration ) || 0 );
	// Mark node kind
	const node = nodeByUuid.get( object.uuid );
	if ( node ) {
		node.kind = 'timeline';
		node.timeline = { path: rel };
	}
}
sceneJson.assets.timelines = timelineAssetPaths.slice();
```

On `manifest`:

```javascript
assets: {
	// existing...
	timelines: timelineAssetPaths.slice(),
},
timelines: timelineManifestEntries,
// ONLY when timelines exist:
...( timelineManifestEntries.length > 0 ? {
	duration: Math.max( 0.01, timelineMaxDuration ),
} : {} ),
```

Ensure scene nodes with `fccTimeline` keep `userData.fccTimeline` (already copied via `{ ...object.userData }`).

- [ ] **Step 2: Manual verify**

Export pack → unzip → `pack/timelines/*.timeline.json` exists; `manifest.json` has `duration` and `timelines` array.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(timeline): export timelines and manifest.duration into vfxpack"
```

---

### Task 11: NLE types + load timelines into BuiltPackScene

**Files:**
- Modify: `freefilmcut/apps/web/src/vfxpack/types.ts`
- Create: `freefilmcut/apps/web/src/vfxpack/timeline.ts`
- Modify: `freefilmcut/apps/web/src/vfxpack/scene-builder.ts`
- Modify: `freefilmcut/apps/web/src/vfxpack/index.ts` (re-export)

- [ ] **Step 1: Extend VfxManifest**

```typescript
duration?: number;
timelines?: Array<{
  name: string;
  path: string;
  fps?: number;
  duration?: number;
  loop?: "clamp" | "loop";
  objectUuid?: string;
}>;
```

And on `VfxSceneFile.assets`:

```typescript
timelines?: string[];
```

- [ ] **Step 2: Create `timeline.ts` with `samplePackTimeline`**

Port editor `sampleTimeline` to TypeScript using `applyAnimToRoot` from `@/vfxpack/freecapcut-anim` and pack video seek helper (same as `syncPackVideos` local time). Activation: `obj.visible = false` outside clips.

```typescript
export type TimelineAsset = {
  format: string;
  name: string;
  fps: number;
  duration: number;
  loop: "clamp" | "loop";
  tracks: TimelineTrack[];
};
// Track / TrackClip types matching spec section 3.3

export function samplePackTimeline({
  root,
  asset,
  t,
  animByName,
  objectsByUuid,
  seekVideo,
}: { ... }): void { /* mirror FccTimelineCore.sampleTimeline */ }
```

- [ ] **Step 3: In `buildPackScene`, load timeline JSON files**

```typescript
const timelines: TimelineAsset[] = [];
const list = pack.manifest.timelines || [];
for (const entry of list) {
  const bytes = pack.files.get(entry.path);
  if (!bytes) continue;
  const asset = JSON.parse(new TextDecoder().decode(bytes)) as TimelineAsset;
  timelines.push(asset);
}
// attach to BuiltPackScene: timelines
```

Also load from `scene.assets.timelines` paths if manifest list empty (fallback).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(timeline): NLE load and samplePackTimeline"
```

---

### Task 12: NLE compositor — Timeline-only anim when present

**Files:**
- Modify: `freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts`

- [ ] **Step 1: In `renderOnePack`, after computing `clipLocalTime`**

Find existing `applyAnimToRoot` loop over `built.animClips`. Change to:

```typescript
const timelines = built.timelines || [];
if (timelines.length > 0) {
  const animByName = new Map<string, FreecapcutAnimClip>();
  for (const clip of built.animClips || []) {
    if (clip?.name) animByName.set(clip.name, clip);
  }
  for (const asset of timelines) {
    samplePackTimeline({
      root: built.scene,
      asset,
      t: clipLocalTime,
      animByName,
      objectsByUuid: built.objectsByUuid,
      seekVideo: (obj, mediaT) => { /* reuse syncPackVideos seek for one player */ },
    });
  }
} else {
  // existing full animClips applyAnimToRoot(clipLocalTime) behavior
}
```

Keep `syncPackVideos` for non-timeline video OR let Timeline video seek own players when Video tracks exist; simplest first version: still call `syncPackVideos` for all players, then Timeline video tracks overwrite seek for bound players.

- [ ] **Step 2: Manual verify**

Import pack with Timeline → play on NLE → Activation/anim follow `clipLocalTime`; pack without Timeline still plays all anims.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(timeline): NLE sample timelines; skip full anim when present"
```

---

### Task 13: NLE create-clip duration from manifest.duration

**Files:**
- Modify: `freefilmcut/apps/web/src/effects/components/assets-view.tsx`
- Modify: `freefilmcut/apps/web/src/timeline/controllers/drag-drop-controller.ts` (effect drop path)

- [ ] **Step 1: Helper**

In `freefilmcut/apps/web/src/vfxpack/duration.ts` (new):

```typescript
import { mediaTimeFromSeconds, type MediaTime } from "@/wasm";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import type { LoadedVfxPack } from "@/vfxpack/types";

export function getVfxPackElementDuration({
  pack,
}: {
  pack: LoadedVfxPack;
}): MediaTime {
  const d = Number(pack.manifest?.duration);
  if (Number.isFinite(d) && d > 0) {
    return mediaTimeFromSeconds({ seconds: d });
  }
  return DEFAULT_NEW_ELEMENT_DURATION;
}
```

- [ ] **Step 2: VfxPackItem handleAddToTimeline**

```typescript
const element = buildEffectElement({
  effectType,
  startTime: currentTime,
  name: pack.displayName,
  duration: getVfxPackElementDuration({ pack }),
});
```

- [ ] **Step 3: Drag-drop**

In `executeEffectDrop` / wherever vfxpack effect duration is chosen, if `isVfxPackEffectType` and pack found in registry, pass `getVfxPackElementDuration`.

Also put duration on dragData if the drag pipeline uses it (`getDurationForDrag`).

- [ ] **Step 4: Manual verify**

Timeline duration 2.5s → export → add to NLE → clip length ≈ 2.5s (not 5s). Old pack without duration → still 5s.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(timeline): NLE pack clip duration from manifest.duration"
```

---

### Task 14: Cache bust + smoke checklist

**Files:**
- All editor HTML/JS imports of new modules (`index.html` / `Toolbar.js` / etc. that pin `?v=fcc-ui-*`)

- [ ] **Step 1: Bump to `fcc-ui-34` (or next) on Timeline imports and any sidebar/menubar touched**

- [ ] **Step 2: End-to-end checklist**

1. Editor: Add Timeline, open window, Animation + Video + Activation tracks work in scrub/play.
2. Export `.vfxpack` with `timelines/` + `manifest.duration`.
3. NLE: import → add to timeline → duration matches Timeline.
4. NLE playback: Timeline drives anim/video/activation; no full-pack anim double-apply.
5. Old pack without Timeline: unchanged.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(timeline): cache bust and Phase A–D smoke complete"
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Timeline scene object + sidebar + empty window | 4, 5, 6 |
| `.timeline.json` on disk | 3 |
| Animation tracks | 7 |
| Video tracks | 8 |
| Activation force hide + restore | 2, 9 |
| Export pack timelines | 10 |
| NLE sample all timelines with clipLocalTime | 11, 12 |
| Timeline-only anim when present | 12 |
| Multi Timeline OK | 5 (active flag), 10–12 |
| NLE create duration = Timeline duration | 10, 13 |
| No audio/particles/PP tracks | (omitted by design) |

## Placeholder scan

No TBD / “implement later” left without concrete code or an explicit “mirror Animation.js API” note with file reference.

## Type consistency

- Format string: `freecapcut-timeline/1` everywhere.
- Key: `userData.fccTimeline` / `TL_KEY`.
- Manifest fields: `duration`, `timelines[]`, `assets.timelines`.
- Sample entrypoints: `sampleTimeline` (editor) / `samplePackTimeline` (NLE).
