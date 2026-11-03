# -*- coding: utf-8 -*-
from pathlib import Path

et = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\components\editable-timecode.tsx")
t = et.read_text(encoding="utf-8")

# Add startInEditMode prop
old_iface = """interface EditableTimecodeProps {
	time: MediaTime;
	duration: MediaTime;
	format?: TimeCodeFormat;
	fps: FrameRate;
	onTimeChange?: ({ time }: { time: MediaTime }) => void;
	className?: string;
	disabled?: boolean;
}"""
new_iface = """interface EditableTimecodeProps {
	time: MediaTime;
	duration: MediaTime;
	format?: TimeCodeFormat;
	fps: FrameRate;
	onTimeChange?: ({ time }: { time: MediaTime }) => void;
	className?: string;
	disabled?: boolean;
	/** Enter edit mode on mount (preview toolbar play-path). */
	startInEditMode?: boolean;
}"""
if old_iface not in t:
    raise SystemExit("iface missing")
t = t.replace(old_iface, new_iface)

old_fn = """export function EditableTimecode({
	time,
	duration,
	format = "HH:MM:SS:FF",
	fps,
	onTimeChange,
	className,
	disabled = false,
}: EditableTimecodeProps) {
	const [isEditing, setIsEditing] = useState(false);"""
new_fn = """export function EditableTimecode({
	time,
	duration,
	format = "HH:MM:SS:FF",
	fps,
	onTimeChange,
	className,
	disabled = false,
	startInEditMode = false,
}: EditableTimecodeProps) {
	const [isEditing, setIsEditing] = useState(!!startInEditMode);"""
if old_fn not in t:
    raise SystemExit("fn missing")
t = t.replace(old_fn, new_fn)

# After state init, if startInEditMode seed inputValue - find formattedTime and add effect
if "startInEditMode && !" not in t:
    needle = """	const formattedTime = formatTimecode({ time, format, rate: fps }) ?? \"\";

	const startEditing = () => {"""
    insert = """	const formattedTime = formatTimecode({ time, format, rate: fps }) ?? \"\";

	useEffect(() => {
		if (!startInEditMode || disabled) return;
		setIsEditing(true);
		setInputValue(formatTimecode({ time, format, rate: fps }) ?? \"\");
		setHasError(false);
		enterPressedRef.current = false;
		queueMicrotask(() => inputRef.current?.select());
	}, [startInEditMode]); // eslint-disable-line react-hooks/exhaustive-deps -- mount/enter only

	const startEditing = () => {"""
    if needle not in t:
        raise SystemExit("formattedTime needle missing")
    t = t.replace(needle, insert)

# cancelEditing should also notify parent - toolbar uses onTimeChange. Add onCancelEdit?
# For toolbar, cancelEditing leaves editing=true parent. Patch cancel to call onTimeChange with same time? 
# Better: add onEditEnd callback. Simpler: toolbar watches - when EditableTimecode cancels, parent stuck.
# Patch cancelEditing and applyEdit - parent TimecodeDisplay sets editing false only on onTimeChange.
# On blur cancel, need parent to exit. Add onEditCancel?: () => void

old_cancel = """	const cancelEditing = () => {
		setIsEditing(false);
		setInputValue(\"\");
		setHasError(false);
		enterPressedRef.current = false;
	};"""
new_cancel = """	const cancelEditing = () => {
		setIsEditing(false);
		setInputValue(\"\");
		setHasError(false);
		enterPressedRef.current = false;
		onEditCancel?.();
	};"""
# add prop
t = t.replace(
    "startInEditMode?: boolean;\n}",
    "startInEditMode?: boolean;\n\tonEditCancel?: () => void;\n}",
)
t = t.replace(
    "startInEditMode = false,\n}: EditableTimecodeProps)",
    "startInEditMode = false,\n\tonEditCancel,\n}: EditableTimecodeProps)",
)
if old_cancel not in t:
    raise SystemExit("cancel missing")
t = t.replace(old_cancel, new_cancel)

et.write_text(t, encoding="utf-8")
print("patched editable-timecode")

# Update toolbar to pass startInEditMode and onEditCancel
tb = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\preview\components\toolbar.tsx")
tt = tb.read_text(encoding="utf-8")
tt2 = tt.replace(
    """				<EditableTimecode
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
				/>""",
    """				<EditableTimecode
					time={currentTime}
					duration={totalDuration}
					format="HH:MM:SS:FF"
					fps={fps}
					startInEditMode
					onEditCancel={() => setEditing(false)}
					onTimeChange={({ time }) => {
						editor.playback.seek({ time });
						setCurrentTime(time);
						setEditing(false);
					}}
					className="text-center"
				/>""",
)
if tt2 == tt:
    raise SystemExit("toolbar EditableTimecode block not found")
tb.write_text(tt2, encoding="utf-8")
print("toolbar edit props ok")
