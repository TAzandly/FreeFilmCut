# -*- coding: utf-8 -*-
from pathlib import Path

# --- toolbar TimecodeDisplay: DOM text update, no React setState per tick ---
toolbar = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\preview\components\toolbar.tsx")
t = toolbar.read_text(encoding="utf-8")

old = '''function TimecodeDisplay() {
	const editor = useEditor();
	const totalDuration = useEditor((e) => e.timeline.getTotalDuration());
	const fps = useEditor((e) => e.project.getActive().settings.fps);
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);

	useEffect(() => {
		const unsubscribeUpdate = editor.playback.onUpdate(setCurrentTime);
		const unsubscribeSeek = editor.playback.onSeek(setCurrentTime);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [editor.playback]);

	return (
		<div className="flex items-center">
			<EditableTimecode
				time={currentTime}
				duration={totalDuration}
				format="HH:MM:SS:FF"
				fps={fps}
				onTimeChange={({ time }) => editor.playback.seek({ time })}
				className="text-center"
			/>
			<span className="text-muted-foreground px-2 font-mono text-xs">/</span>
			<span className="text-muted-foreground font-mono text-xs">
				{formatTimecode({
					time: totalDuration,
					format: "HH:MM:SS:FF",
					rate: fps,
				})}
			</span>
		</div>
	);
}'''

new = '''function TimecodeDisplay() {
	const editor = useEditor();
	const totalDuration = useEditor((e) => e.timeline.getTotalDuration());
	const fps = useEditor((e) => e.project.getActive().settings.fps);
	// Seek / pause still use React state so EditableTimecode stays controlled.
	// During play, write the formatted string via DOM — setState every rAF was
	// showing up as 100ms+ react-dom-client.development.js Violations.
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	const liveRef = useRef<HTMLSpanElement | null>(null);
	const fpsRef = useRef(fps);
	fpsRef.current = fps;

	useEffect(() => {
		const writeLive = (time: MediaTime) => {
			const el = liveRef.current;
			if (!el) return;
			const next =
				formatTimecode({
					time,
					format: "HH:MM:SS:FF",
					rate: fpsRef.current,
				}) ?? "";
			if (el.textContent !== next) el.textContent = next;
		};
		writeLive(editor.playback.getCurrentTime());
		const onUpdate = (time: MediaTime) => {
			writeLive(time);
		};
		const onSeek = (time: MediaTime) => {
			setCurrentTime(time);
			writeLive(time);
		};
		const unsubscribeUpdate = editor.playback.onUpdate(onUpdate);
		const unsubscribeSeek = editor.playback.onSeek(onSeek);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [editor.playback]);

	return (
		<div className="flex items-center">
			{/* Hidden controlled editor for click-to-edit; live span mirrors playhead. */}
			<div className="relative text-center font-mono text-xs">
				<span ref={liveRef} className="inline-block min-w-[7.5rem]" />
				<div className="absolute inset-0 opacity-0">
					<EditableTimecode
						time={currentTime}
						duration={totalDuration}
						format="HH:MM:SS:FF"
						fps={fps}
						onTimeChange={({ time }) => editor.playback.seek({ time })}
						className="text-center"
					/>
				</div>
			</div>
			<span className="text-muted-foreground px-2 font-mono text-xs">/</span>
			<span className="text-muted-foreground font-mono text-xs">
				{formatTimecode({
					time: totalDuration,
					format: "HH:MM:SS:FF",
					rate: fps,
				})}
			</span>
		</div>
	);
}'''

if old not in t:
    raise SystemExit("TimecodeDisplay block not found")
# Ensure useRef import
if "useRef" not in t.split("from \"react\"")[0]:
    t = t.replace(
        'import { useState, useEffect } from "react";',
        'import { useState, useEffect, useRef } from "react";',
    )
t = t.replace(old, new)
toolbar.write_text(t, encoding="utf-8")
print("patched toolbar.tsx")

# --- opacity early-out ---
runtime = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\textanim\TextAnimRuntime.js")
r = runtime.read_text(encoding="utf-8")
old_op = '''function applyOpacityToCharGroup( charGroup, op ) {

	const a = Math.max( 0, Math.min( 1, op ) );
	charGroup.visible = a > 0.001;
	if ( ! charGroup.visible ) return;

	charGroup.traverse( ( o ) => {
'''
new_op = '''function applyOpacityToCharGroup( charGroup, op ) {

	const a = Math.max( 0, Math.min( 1, op ) );
	const prev = charGroup.userData.__fccAnimLastOp;
	if ( prev != null && Math.abs( prev - a ) < 0.002 && ( a > 0.001 ) === !! charGroup.visible ) {
		return;
	}
	charGroup.userData.__fccAnimLastOp = a;
	charGroup.visible = a > 0.001;
	if ( ! charGroup.visible ) return;

	charGroup.traverse( ( o ) => {
'''
if old_op not in r:
    raise SystemExit("applyOpacityToCharGroup missing")
r = r.replace(old_op, new_op)
runtime.write_text(r, encoding="utf-8")
print("patched TextAnimRuntime.js opacity early-out")
