import json, sys
sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
from tokenizers import Tokenizer
import tokenizers
tk = Tokenizer.from_file("D:/dsh/skill-merge/models/potion-multilingual-128M-int8/tokenizer.json")
ref = json.load(open("D:/dsh/skill-merge/node/parity/ref_tokenizer.json", encoding="utf-8"))
out = []
for r in ref:
    t = r["text"]
    n = tk.normalizer.normalize_str(t)
    enc = tk.encode(t)
    out.append({"i": len(out), "text": t, "normalized": n, "ids": enc.ids, "tokens": enc.tokens})
json.dump(out, open("D:/dsh/skill-merge/node/parity/ref_norm_full.json", "w", encoding="utf-8"), ensure_ascii=False)
print("ok", len(out), "| 样例 token id 123431 =", repr(tk.id_to_token(123431)), "| 159079 =", repr(tk.id_to_token(159079)))