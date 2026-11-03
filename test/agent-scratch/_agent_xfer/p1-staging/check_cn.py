from pathlib import Path
t = Path(r'D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js').read_text(encoding='utf-8')
checks = ['花字','描边','投影','启用','渐变','纯色','从基础生成','内投影','不透明度','面填充','文本','字号']
for s in checks:
    print(s, 'OK' if s in t else 'MISSING')
i = t.find('FlowerStyle Effect')
print('snippet', repr(t[i:i+120]))