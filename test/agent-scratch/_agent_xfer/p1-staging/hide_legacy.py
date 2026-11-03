from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
t = p.read_text(encoding="utf-8")
# After rebuildFlowerPanel definition area is separate; in refresh after rebuildFlowerPanel, hide legacy outline/shadow when flower on
old = "\t\t\trebuildFlowerPanel();\n\n\t\t} else {"
# find exact
if "rebuildFlowerPanel();" not in t:
    print("NO rebuild call")
else:
    # Add helper to toggle legacy rows - need references to outline/shadow rows
    # Simpler: after rebuildFlowerPanel in refresh, set display on known rows
    pass

# Check variable names for outline rows exist in outer scope
for name in ["outlineEnRow", "outlineRow", "shadowEnRow", "shadowOffRow", "shadowBlurRow"]:
    print(name, name in t)

# Patch refresh to hide legacy when flowerStyle set
needle = "\t\t\trebuildFlowerPanel();"
if needle in t and "outlineEnRow.setDisplay" not in t:
    t = t.replace(needle, """\t\t\trebuildFlowerPanel();
\t\t\tconst flowerOn = !!( ui.flowerStyle && typeof ui.flowerStyle === 'object' );
\t\t\tconst legacyDisp = flowerOn ? 'none' : '';
\t\t\toutlineEnRow.setDisplay( legacyDisp );
\t\t\toutlineRow.setDisplay( legacyDisp );
\t\t\tshadowEnRow.setDisplay( legacyDisp );
\t\t\tshadowOffRow.setDisplay( legacyDisp );
\t\t\tshadowBlurRow.setDisplay( legacyDisp );
""")
    p.write_bytes(t.replace("\r\n","\n").encode("utf-8"))
    print("legacy hide when flower on")
else:
    print("skip hide", needle in t)
