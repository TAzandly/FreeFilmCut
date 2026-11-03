from pathlib import Path
path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = path.read_text(encoding="utf-8")
bad = """	return resolvePackOutputToneMapping(payload);
}
}

function resolvePackOutputExposure("""
good = """	return resolvePackOutputToneMapping(payload);
}

function resolvePackOutputExposure("""
if bad not in text:
    # show nearby
    i = text.find("return resolvePackOutputToneMapping(payload);")
    print(repr(text[i:i+80]))
    raise SystemExit("bad pattern not found")
text = text.replace(bad, good, 1)
path.write_text(text, encoding="utf-8")
print("fixed extra brace")
# sanity: count braces around the two functions
start = text.find("function resolvePackOutputToneMapping")
end = text.find("class ThreeCompositor")
chunk = text[start:end]
print("chunk brace balance", chunk.count("{") - chunk.count("}"))
