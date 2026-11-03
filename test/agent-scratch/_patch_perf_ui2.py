# -*- coding: utf-8 -*-
from pathlib import Path

toolbar = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\preview\components\toolbar.tsx")
t = toolbar.read_text(encoding="utf-8")

# Replace TimecodeDisplay with cleaner version
import re
m = re.search(r"function TimecodeDisplay\(\) \{.*?\n\}", t, re.S)
if not m:
    raise SystemExit("TimecodeDisplay not found")

new = '''function TimecodeDisplay() {
	const editor = useEditor();
	const totalDuration = useEditor((e) => e.timeline.getTotalDuration());
	const fps = useEditor((e) => e.project.getActive().settings.fps);
	// React state only on seek/pause interactions. Play ticks update the span via
	// DOM so we do not commit react-dom every rAF (dev Violations ~100ms+).
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	const [editing, setEditing] = useState(false);
	const liveRef = useRef<HTMLButtonElement | null>(null);
	const fpsRef = useRef(fps);
	fpsRef.current = fps;

	useEffect(() => {
		const writeLive = (time: MediaTime) => {
			const el = liveRef.current;
			if (!el || editing) return;
			const next =
				formatTimecode({
					time,
					format: "HH:MM:SS:FF",
					rate: fpsRef.current,
				}) ?? "";
			if (el.textContent !== next) el.textContent = next;
		};
		writeLive(editor.playback.getCurrentTime());
		const onUpdate = (time: MediaTime) => writeLive(time);
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
	}, [editor.playback, editing]);

	if (editing) {
		return (
			<div className="flex items-center">
				<EditableTimecode
					time={currentTime}
					duration={totalDuration}
					format="HH:MM:SS:FF"
					fps={fps}
					onTimeChange={({ time }) => {
						editor.playback.seek({ time });
						setCurrentTime(time);
						setEditing(false);
					}}
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
	}

	return (
		<div className="flex items-center">
			<button
				type="button"
				ref={liveRef}
				className="text-center font-mono text-xs min-w-[7.5rem] hover:text-foreground text-foreground"
				onClick={() => {
					const now = editor.playback.getCurrentTime();
					setCurrentTime(now);
					setEditing(true);
				}}
				aria-label="Edit timecode"
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

t = t[:m.start()] + new + t[m.end():]
if 'useRef' not in t.split('from "react"')[0] and 'useRef' not in t.split("from 'react'")[0]:
    t = t.replace(
        'import { useState, useEffect } from "react";',
        'import { useState, useEffect, useRef } from "react";',
    )
    t = t.replace(
        'import { useState, useEffect, useRef } from "react";',
        'import { useState, useEffect, useRef } from "react";',
    )
# ensure useRef imported
if "useRef" not in t.split("\n")[0:15].__str__() if False else True:
    pass
if 'useRef' not in t:
    raise SystemExit("useRef missing from file unexpectedly")
# Fix import line properly
for old_imp in [
    'import { useState, useEffect } from "react";',
    'import { useState, useEffect, useRef } from "react";',
]:
    if old_imp in t and 'useRef' not in old_imp:
        t = t.replace(old_imp, 'import { useState, useEffect, useRef } from "react";')
        break
else:
    if 'import { useState, useEffect, useRef } from "react";' not in t:
        # try already patched partially
        if 'useRef' not in t.split('from "react"')[0]:
            t = t.replace('from "react"', 'from "react"')  # no-op
            # force
            t = t.replace(
                'import { useState, useEffect } from "react";',
                'import { useState, useEffect, useRef } from "react";',
            )

toolbar.write_text(t, encoding="utf-8")
print("toolbar rewritten")
print("import line:", [ln for ln in t.splitlines() if 'from "react"' in ln][:1])

# Remove unused unionTextLayerAabb from compositor import
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
c = comp.read_text(encoding="utf-8")
c2 = c.replace("\n\tunionTextLayerAabb,", "")
if c2 != c:
    comp.write_text(c2, encoding="utf-8")
    print("removed unused unionTextLayerAabb import")
else:
    print("unionTextLayerAabb import already gone or different")
