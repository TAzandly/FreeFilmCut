from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\types.ts")
t = p.read_text(encoding="utf-8")
# find outline/shadow in ui type
idx = t.find("outline?:")
print("outline at", idx)
print(t[idx:idx+400] if idx>=0 else "none")
if "flowerStyle" not in t and idx > 0:
    old = """\t\tshadow?: {
\t\t\tenabled?: boolean;
\t\t\toffsetX?: number;
\t\t\toffsetY?: number;
\t\t\tblur?: number;
\t\t\tcolor?: string;
\t\t\topacity?: number;
\t\t};
"""
    # may use different formatting - search
    if "flowerStyle" not in t:
        # insert after shadow block near text
        import re
        m = re.search(r"shadow\?: \{[^}]+\};", t)
        if m:
            insert_at = m.end()
            t = t[:insert_at] + "\n\t\tflowerStyle?: unknown;" + t[insert_at:]
            p.write_bytes(t.replace("\r\n","\n").encode("utf-8"))
            print("types.ts flowerStyle added")
        else:
            print("shadow block not matched")
else:
    print("skip types", "flowerStyle" in t)
