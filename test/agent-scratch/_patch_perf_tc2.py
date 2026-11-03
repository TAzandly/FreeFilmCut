# -*- coding: utf-8 -*-
from pathlib import Path
et = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\components\editable-timecode.tsx")
t = et.read_text(encoding="utf-8")
old = '''	const [isEditing, setIsEditing] = useState(!!startInEditMode);
	const [inputValue, setInputValue] = useState("");
	const [hasError, setHasError] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const enterPressedRef = useRef(false);
	const formattedTime = formatTimecode({ time, format, rate: fps }) ?? "";'''
new = '''	const formattedTime = formatTimecode({ time, format, rate: fps }) ?? "";
	const [isEditing, setIsEditing] = useState(!!startInEditMode);
	const [inputValue, setInputValue] = useState(() =>
		startInEditMode ? (formatTimecode({ time, format, rate: fps }) ?? "") : "",
	);
	const [hasError, setHasError] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const enterPressedRef = useRef(false);'''
if old not in t:
    raise SystemExit("block to fix init not found")
t = t.replace(old, new)
et.write_text(t, encoding="utf-8")
print("seeded inputValue")
