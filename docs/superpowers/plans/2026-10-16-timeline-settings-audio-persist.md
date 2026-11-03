# Timeline Settings, Video Audio & Project Persist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editable Timeline end/FPS (toolbar + sidebar), audible multi-track video during Play, and auto-flush Timeline assets on project save so reopen restores tracks.

**Architecture:** Stop auto-expanding `asset.duration` from clip ends; mirror duration/fps on `userData.fccTimeline` and `__fccTimelineAsset`. Timeline master clock drives each VideoPlayer via extended `seekVideoPlayer` (`play` + audio route when playing and inside clip; `pause` otherwise). Project save calls new `flushTimelinesToProject` (same pattern as `flushFccVideosToProject`) before `saveProjectJson`.

**Tech Stack:** Vanilla JS Three.js editor (`FccTimelineEditor`, `FccTimelineCore`, `FccTimelineIO`, `Menubar.File`, `Sidebar.Object.Timeline`, `FccAudio`).

**Spec:** `docs/superpowers/specs/2026-10-16-timeline-settings-audio-persist-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `three.js/editor/js/timeline/FccTimelineEditor.js` | Toolbar End/FPS; stop duration auto-expand; pass `timelinePlaying` into sample; pause videos on stop |
| `three.js/editor/js/timeline/FccTimelineCore.js` | Video sample: in-clip seek with `playing`; out-of-clip pause |
| `three.js/editor/js/timeline/FccTimelineIO.js` | Add `flushTimelinesToProject(editor)` |
| `three.js/editor/js/Sidebar.Object.Timeline.js` | Sync `__fccTimelineAsset` + live editor asset on write |
| `three.js/editor/js/Menubar.File.js` | Call flush before every project JSON save that already flushes anims/videos |
| `three.js/editor/index.html` | Cache-bust touched modules to `?v=fcc-ui-36` |

---

### Task 1: Stop auto-expand duration + toolbar End/FPS

**Files:**
- Modify: `three.js/editor/js/timeline/FccTimelineEditor.js`
- Modify: `three.js/editor/index.html` (import `?v=fcc-ui-36`)

- [ ] **Step 1: Change `commitAssetEdit` so it does not raise duration from content**

Replace:

```javascript
asset.duration = Math.max( Number( asset.duration ) || 0, computeContentDuration( asset ) );
if ( object.userData[ TL_KEY ] ) object.userData[ TL_KEY ].duration = asset.duration;
```

With:

```javascript
asset.duration = Math.max( 0.01, Number( asset.duration ) || 0.01 );
if ( object.userData[ TL_KEY ] ) {

	object.userData[ TL_KEY ].duration = asset.duration;
	object.userData[ TL_KEY ].fps = asset.fps;
	object.userData[ TL_KEY ].loop = asset.loop;

}
```

- [ ] **Step 2: Remove duration auto-expand in `addAnimationTrack` / `addVideoTrack` / `addActivationTrack`**

Delete lines like:

```javascript
asset.duration = Math.max( asset.duration, computeContentDuration( asset ) );
object.userData[ TL_KEY ].duration = asset.duration;
```

Keep `object.__fccTimelineAsset = asset` and `rebuildTracksUI` / `commitAssetEdit(true)` as today. Prefer calling `commitAssetEdit(true)` once after mutating tracks instead of duplicating duration writes.

- [ ] **Step 3: Add toolbar End + FPS controls after `timeText`**

After creating `timeText`, insert:

```javascript
const endLabel = document.createElement( 'span' );
endLabel.textContent = T( '\u7ed3\u675f', 'End' );
endLabel.style.cssText = 'margin-left:10px;color:#aaa;';
controls.appendChild( endLabel );

const endNum = new UINumber( 1 ).setWidth( '56px' ).setRange( 0.01, 100000 ).setPrecision( 2 ).setStep( 0.1 );
controls.appendChild( endNum.dom );

const fpsLabel = document.createElement( 'span' );
fpsLabel.textContent = 'FPS';
fpsLabel.style.cssText = 'margin-left:6px;color:#aaa;';
controls.appendChild( fpsLabel );

const fpsSelect = document.createElement( 'select' );
fpsSelect.style.cssText = 'background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;';
for ( const f of [ '24', '25', '30' ] ) {

	const o = document.createElement( 'option' );
	o.value = f;
	o.textContent = f;
	fpsSelect.appendChild( o );

}
controls.appendChild( fpsSelect );

function applyDurationFpsFromUI() {

	if ( ! object || ! asset ) return;
	asset.duration = Math.max( 0.01, endNum.getValue() );
	asset.fps = parseInt( fpsSelect.value, 10 ) || 30;
	const ud = object.userData[ TL_KEY ];
	if ( ud ) {

		ud.duration = asset.duration;
		ud.fps = asset.fps;

	}
	const dur = asset.duration;
	if ( playTime > dur ) playTime = dur;
	object.__fccTimelineAsset = asset;
	if ( editor.timelinePreviewOwnsAnim ) applySample();
	updateUI();
	relayoutClipLanes();
	if ( editor.signals && editor.signals.objectChanged ) editor.signals.objectChanged.dispatch( object );

}

endNum.onChange( applyDurationFpsFromUI );
fpsSelect.addEventListener( 'change', applyDurationFpsFromUI );
```

- [ ] **Step 4: Sync toolbar from asset in `updateUI`**

Inside `updateUI`, when `asset` exists and not mid-edit of the number (optional: always set when panel visible):

```javascript
if ( asset && panelVisible ) {

	endNum.setValue( Number( asset.duration ) || 1 );
	const f = String( asset.fps || 30 );
	if ( fpsSelect.value !== f ) fpsSelect.value = ( f === '24' || f === '25' || f === '30' ) ? f : '30';

}
```

- [ ] **Step 5: Bump cache**

In `three.js/editor/index.html`, set `FccTimelineEditor.js?v=fcc-ui-36`. Also bump `FccTimelineCore` / `FccTimelineIO` imports inside the editor file to `?v=fcc-ui-36` when those files change in later tasks.

- [ ] **Step 6: Manual check**

Open Timeline → set End shorter than a clip → Play stops at End; ruler matches. Change FPS → frame labels / snap use new fps.

- [ ] **Step 7: Commit** (three.js `dev`, only if user asked / agent session allows)

```bash
git -C three.js add editor/js/timeline/FccTimelineEditor.js editor/index.html
git -C three.js commit -m "feat(timeline): editable end/fps without auto-expand duration"
```

---

### Task 2: Sidebar syncs live asset

**Files:**
- Modify: `three.js/editor/js/Sidebar.Object.Timeline.js`
- Bump its import of `FccTimelineCore` to `?v=fcc-ui-36` if needed

- [ ] **Step 1: Extend `writeUD` to update `__fccTimelineAsset` and open editor**

```javascript
function writeUD() {

	if ( ! isFccTimeline( object ) ) return;
	const ud = object.userData[ TL_KEY ];
	ud.duration = durNum.getValue();
	ud.fps = parseInt( fpsSelect.getValue(), 10 ) || 30;
	ud.loop = loopSelect.getValue() === 'loop' ? 'loop' : 'clamp';
	ud.active = activeBox.getValue() === true;
	// ... existing active / activeFccTimeline logic ...

	const live = object.__fccTimelineAsset;
	if ( live ) {

		live.duration = ud.duration;
		live.fps = ud.fps;
		live.loop = ud.loop;

	}
	const ed = editor.fccTimelineEditor;
	if ( ed && typeof ed.syncSettingsFromObject === 'function' ) {

		ed.syncSettingsFromObject( object );

	}
	signals.objectChanged.dispatch( object );

}
```

- [ ] **Step 2: Expose `syncSettingsFromObject` on `editor.fccTimelineEditor`**

In `FccTimelineEditor.js`, near `openFor`:

```javascript
function syncSettingsFromObject( obj ) {

	if ( ! obj || obj !== object || ! asset ) return;
	const ud = obj.userData[ TL_KEY ];
	if ( ! ud ) return;
	if ( Number( ud.duration ) > 0 ) asset.duration = Number( ud.duration );
	if ( Number( ud.fps ) > 0 ) asset.fps = Number( ud.fps );
	if ( ud.loop === 'loop' || ud.loop === 'clamp' ) asset.loop = ud.loop;
	if ( playTime > asset.duration ) playTime = asset.duration;
	updateUI();
	relayoutClipLanes();

}

editor.fccTimelineEditor = { openFor, sampleIfPlaying, isPlaying: () => playing, syncSettingsFromObject };
```

- [ ] **Step 3: Manual check** — change Duration in sidebar while Timeline window open → End field and ruler update.

---

### Task 3: Multi-track video play + audio

**Files:**
- Modify: `three.js/editor/js/timeline/FccTimelineEditor.js` (`seekVideoPlayer`, `applySample`, `pause`, `stop`)
- Modify: `three.js/editor/js/timeline/FccTimelineCore.js` (video loop out-of-clip pause)

- [ ] **Step 1: Import audio resume in editor**

```javascript
import { resumeAndRouteVideos } from '../media/FccAudio.js?v=fcc-ui-30';
```

- [ ] **Step 2: Replace `seekVideoPlayer`**

```javascript
function seekVideoPlayer( object, mediaTimeSec, opts ) {

	const video = object && object.__fccVideo;
	if ( ! video ) return;
	const wantPlay = !!( opts && opts.playing );
	if ( mediaTimeSec == null || ! Number.isFinite( Number( mediaTimeSec ) ) ) {

		if ( ! video.paused ) video.pause();
		return;

	}
	let t = Number( mediaTimeSec ) || 0;
	const d = Number( video.duration );
	if ( Number.isFinite( d ) && d > 0 ) {

		if ( opts && opts.loop ) t = ( ( t % d ) + d ) % d;
		else t = Math.max( 0, Math.min( d - 0.001, t ) );

	}
	const drift = Math.abs( ( video.currentTime || 0 ) - t );
	const thresh = 1 / 60;
	if ( drift > thresh ) {

		try { video.currentTime = t; } catch ( e ) { /* ignore seek errors */ }

	}
	if ( wantPlay ) {

		if ( video.paused ) video.play().catch( () => {} );

	} else if ( ! video.paused ) {

		video.pause();

	}

}
```

- [ ] **Step 3: Update `sampleTimeline` video section in `FccTimelineCore.js`**

Replace the video tracks loop body so out-of-clip pauses, and pass `playing`:

```javascript
// Video tracks
for ( const track of asset.tracks || [] ) {

	if ( track.muted || track.type !== 'video' ) continue;
	const uuid = track.bindingUuid || track.videoPlayerUuid;
	if ( ! uuid || ! seekVideo ) continue;
	const obj = scene.getObjectByProperty( 'uuid', uuid );
	if ( ! obj ) continue;
	let mediaT = null;
	let mediaLoop = false;
	for ( const clip of track.clips || [] ) {

		const start = Number( clip.start ) || 0;
		const cdur = Number( clip.duration ) || 0;
		if ( t < start || t >= start + cdur ) continue;
		mediaT = ( t - start ) + ( Number( clip.mediaOffset ) || 0 );
		mediaLoop = !! clip.loop;

	}
	if ( mediaT !== null ) {

		seekVideo( obj, mediaT, { loop: mediaLoop, playing: !! ctx.timelinePlaying } );

	} else {

		seekVideo( obj, null, { playing: false } );

	}

}
```

- [ ] **Step 4: Pass `timelinePlaying` from `applySample`**

```javascript
sampleTimeline( {
	scene: editor.scene,
	asset,
	t: playTime,
	animByName: buildAnimByName( editor ),
	seekVideoPlayer,
	activationBoundUuids: editor._fccTimelineActivationBound || null,
	timelinePlaying: playing,
} );
if ( playing ) resumeAndRouteVideos( editor );
```

- [ ] **Step 5: On `pause` / `stop`, force video pause**

After setting `playing = false` in `pause` and `stop`, call `applySample()` once (stop already avoids re-sample for visibility — for stop, explicitly pause bound videos):

```javascript
function pauseAllTimelineVideos() {

	if ( ! asset || ! editor.scene ) return;
	for ( const track of asset.tracks || [] ) {

		if ( track.type !== 'video' ) continue;
		const uuid = track.bindingUuid || track.videoPlayerUuid;
		if ( ! uuid ) continue;
		const obj = editor.scene.getObjectByProperty( 'uuid', uuid );
		seekVideoPlayer( obj, null, { playing: false } );

	}

}
```

Call `pauseAllTimelineVideos()` from `pause()` and `stop()`.

- [ ] **Step 6: Manual smoke**

1. Two VideoPlayers with audio, two video tracks, overlapping or sequential clips.
2. Timeline Play → both audible when inside their clips; mute one track → that track silent.
3. Pause / Stop → silence.
4. Scrub → picture updates; audio not required.

---

### Task 4: `flushTimelinesToProject` + wire File Save

**Files:**
- Modify: `three.js/editor/js/timeline/FccTimelineIO.js`
- Modify: `three.js/editor/js/Menubar.File.js`
- Modify: `three.js/editor/js/timeline/FccTimelineEditor.js` imports to `?v=fcc-ui-36`

- [ ] **Step 1: Add flush helper to `FccTimelineIO.js`**

```javascript
export async function flushTimelinesToProject( editor ) {

	const pf = editor && editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) {

		return { saved: 0 };

	}
	const scene = editor.scene;
	if ( ! scene ) return { saved: 0 };
	let saved = 0;
	const list = [];
	scene.traverse( ( o ) => {

		if ( o.userData && o.userData[ TL_KEY ] ) list.push( o );

	} );
	for ( const object of list ) {

		const asset = object.__fccTimelineAsset;
		if ( ! asset || ! asset.tracks ) continue;
		try {

			await saveTimelineAsset( editor, object, asset );
			saved ++;

		} catch ( e ) {

			console.warn( '[FreeFilmCut] flush timeline', object.name, e );

		}

	}
	return { saved };

}
```

Export it alongside `saveTimelineAsset` / `loadTimelineAsset`. Bump Core import in IO file to `?v=fcc-ui-36`.

- [ ] **Step 2: Import and call in `Menubar.File.js`**

```javascript
import { flushTimelinesToProject } from './timeline/FccTimelineIO.js?v=fcc-ui-36';
```

In **both** places that already flush anims/videos before `saveProjectJson` (bind-folder path ~line 116 and `saveToFolder` ~line 520), add:

```javascript
try {

	const flushedTl = await flushTimelinesToProject( editor );
	if ( flushedTl && flushedTl.saved ) {

		console.log( '[FreeFilmCut] flushed', flushedTl.saved, 'timeline file(s)' );

	}

} catch ( e ) {

	console.warn( '[FreeFilmCut] flush timelines before save failed', e );

}
```

Place after video flush, before `editor.toJSON()` / `saveProjectJson`.

- [ ] **Step 3: Ensure edits keep `__fccTimelineAsset` warm**

Already set in `commitAssetEdit` / `openFor`. After `openFor` load, asset is on the object. No change if user edits only while panel open.

- [ ] **Step 4: Manual persistence smoke**

1. Bind project folder; add Timeline tracks/clips; **do not** click Timeline window Save.
2. File → Save.
3. Confirm `assets/timelines/*.timeline.json` exists under the project folder.
4. Reload editor / reopen project → Open Timeline → tracks/clips present.

---

### Task 5: Cache-bust + acceptance checklist

**Files:**
- Modify: `three.js/editor/index.html` and any sidebar import of Timeline modules

- [ ] Set all touched Timeline-related imports to `?v=fcc-ui-36`.
- [ ] Run acceptance from spec:

- [ ] End/FPS in window + sidebar stay in sync.
- [ ] End shorter than content: play clamps; later clips ignored.
- [ ] Play: multi video audible; Pause/Stop silent.
- [ ] Save project → reopen → Timeline data restored.

- [ ] Commit (if requested):

```bash
git -C three.js add editor/js/timeline/FccTimelineEditor.js editor/js/timeline/FccTimelineCore.js editor/js/timeline/FccTimelineIO.js editor/js/Sidebar.Object.Timeline.js editor/js/Menubar.File.js editor/index.html
git -C three.js commit -m "feat(timeline): settings UI, video audio on play, flush on project save"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Toolbar + sidebar End/FPS shared | 1, 2 |
| Duration may be shorter than content | 1 |
| No auto-expand on clip edit | 1 |
| Multi-track video audio on Play | 3 |
| Pause/Stop/scrub silent or seek-only | 3 |
| Flush `assets/timelines` on project save | 4 |
| Load via `projectPath` | existing + 4 |
| Cache bust | 1, 5 |
