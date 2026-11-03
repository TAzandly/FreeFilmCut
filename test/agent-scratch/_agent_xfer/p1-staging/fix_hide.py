from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
t = p.read_text(encoding="utf-8")

bad = """\t\t\t\trebuildFlowerPanel();
\t\t\tconst flowerOn = !!( ui.flowerStyle && typeof ui.flowerStyle === 'object' );
\t\t\tconst legacyDisp = flowerOn ? 'none' : '';
\t\t\toutlineEnRow.setDisplay( legacyDisp );
\t\t\toutlineRow.setDisplay( legacyDisp );
\t\t\tshadowEnRow.setDisplay( legacyDisp );
\t\t\tshadowOffRow.setDisplay( legacyDisp );
\t\t\tshadowBlurRow.setDisplay( legacyDisp );


\t\t\t} );"""

good = """\t\t\t\trebuildFlowerPanel();

\t\t\t} );"""

count = t.count(bad)
print("bad count", count)
if count >= 1:
    # Only replace the first occurrence (inside clear btn); keep refresh one
    t = t.replace(bad, good, 1)
    p.write_bytes(t.replace("\r\n","\n").encode("utf-8"))
    print("fixed bad insert")
else:
    # try alternate whitespace
    print("trying alt")
    idx = t.find("outlineEnRow.setDisplay")
    print(repr(t[idx-120:idx+280]))

# verify remaining
t2 = p.read_text(encoding="utf-8")
idxs = []
start = 0
while True:
    i = t2.find("outlineEnRow.setDisplay", start)
    if i < 0: break
    idxs.append(i)
    start = i + 1
print("remaining hide sites", len(idxs))
for i,line in enumerate(t2.splitlines()):
    if "outlineEnRow.setDisplay" in line or ( "rebuildFlowerPanel();" in line):
        print(i+1, line.strip()[:80])
