from pathlib import Path
import re
s = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
m = re.search(r"wipeHead = new UIText\( zh \? '(.*?)' :", s)
print("wipeHead zh:", m.group(1).encode("unicode_escape").decode() if m else None)
m2 = re.search(r"addNum\( params, zh \? '(.*?)' : 'Edge intensity'", s)
print("edge zh:", m2.group(1).encode("unicode_escape").decode() if m2 else None)
m3 = re.search(r"addNum\( params, zh \? '(.*?)' : 'Edge width'", s)
print("width zh:", m3.group(1).encode("unicode_escape").decode() if m3 else None)
# Expected: \u626b\u5149 ... \u7247\u5143+\u5203\u5149
