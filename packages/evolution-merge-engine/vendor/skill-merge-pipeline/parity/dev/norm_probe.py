import json, sys
sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
from tokenizers import Tokenizer
tk = Tokenizer.from_file("D:/dsh/skill-merge/models/potion-multilingual-128M-int8/tokenizer.json")
ref = json.load(open("D:/dsh/skill-merge/node/parity/ref_tokenizer.json", encoding="utf-8"))
out = []
for r in ref:
    t = r["text"]
    n = tk.normalizer.normalize_str(t)
    enc = tk.encode(t)
    out.append({"text": t[:80], "normalized": n[:400], "ids": r["ids"], "tokens": enc.tokens[:40]})
json.dump(out, open("D:/dsh/skill-merge/node/parity/ref_norm.json", "w", encoding="utf-8"), ensure_ascii=False)
print("导出归一化参考", len(out))