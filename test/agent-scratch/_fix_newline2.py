from pathlib import Path
import re
p = Path(r"test/agent-scratch/_patch_ldr_bloom.py")
t = p.read_text(encoding="utf-8")
t2 = re.sub(r', newline="[^"]*"', "", t)
p.write_text(t2, encoding="utf-8")
print("done", "newline=" in t2)
