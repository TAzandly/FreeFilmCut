from pathlib import Path
import re
for f in [
 Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/text-template-media.ts"),
 Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/pack-video.ts"),
 Path(r"D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/apply-text-template.ts"),
]:
  s = f.read_text(encoding="utf-8")
  # Count occurrences of replace(/\\/g  (two backslashes in file)
  good = len(re.findall(r'replace\(/\\\\\/g', s))  # in pattern: \\\\ = two backslashes in file? 
  # In Python raw-ish: r'replace\(/\\\\/g' means look for replace(/\\/g in file (2 backslashes)
  good = s.count('replace(/\\\\/g')  # Python str: \\\\ is 2 chars \\ 
  # Actually in normal Python string 'replace(/\\\\/g') is replace(/\\/g - YES 2 backslashes
  bad = s.count('replace(/\\/g')  # one backslash - but wait 'replace(/\\/g') is replace(/\/g which is 1 backslash
  # Careful: 'replace(/\\/g')  -> replace(/\/g  (backslash-forwardslash)
  # 'replace(/\\\\/g') -> replace(/\\/g (backslash-backslash-forwardslash)
  print(f.name, "good_/\\\\\/g", s.count("replace(/\\\\/g"), "single_bs_pattern", len(re.findall(r"replace\(/\\/g", s)))