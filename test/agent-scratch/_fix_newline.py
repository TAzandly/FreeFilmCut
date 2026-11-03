from pathlib import Path
p = Path(r"test/agent-scratch/_patch_ldr_bloom.py")
t = p.read_text(encoding="utf-8")
t = t.replace(', newline="\n"', "")
t = t.replace(", newline='\n'", "")
p.write_text(t, encoding="utf-8")
print("newline leftovers", t.count("newline="))