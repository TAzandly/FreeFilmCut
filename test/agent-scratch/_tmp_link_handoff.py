hp = r"D:\GrokbotWork\FreeFilmCut\docs\AGENT_HANDOFF.md"
h = open(hp, encoding="utf-8").read()
needle = "textanim-progress-2026-10.md"
if needle in h:
    print("handoff already linked")
else:
    lines = h.splitlines(True)
    note = "\n> 文字动画进度（2026-10，待下月重构）：见 [textanim-progress-2026-10.md](./textanim-progress-2026-10.md)\n"
    if lines and lines[0].startswith("#"):
        new = "".join([lines[0], note] + lines[1:])
    else:
        new = note + h
    with open(hp, "w", encoding="utf-8", newline="\n") as f:
        f.write(new)
    print("linked in AGENT_HANDOFF")
