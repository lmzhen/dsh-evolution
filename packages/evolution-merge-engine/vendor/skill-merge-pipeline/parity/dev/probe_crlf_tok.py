import sys, json
sys.path.insert(0, "D:/dsh/skill-merge/pipeline"); sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
import corpus
from config import Config
from tokenizers import Tokenizer
tk = Tokenizer.from_file("D:/dsh/skill-merge/models/potion-multilingual-128M-int8/tokenizer.json")
cfg = Config()
skills, _ = corpus.load_corpus(["C:/Users/limengzhen/.dsh/skills"])
corpus.strip_boilerplate(skills, cfg)
s = [x for x in skills if x.name == "flyai"][0]
ids = tk.encode(s.body_core).ids
json.dump({"keys": list(skills[0].__dict__.keys()), "body_crlf": s.body.count("\r"), "ids_len": len(ids), "ids_head": ids[:12]}, open("D:/dsh/skill-merge/node/parity/ref_crlf_tok.json", "w"))
print("  Python flyai: body含CR=" + str(s.body.count("\r")) + " body_core_len=" + str(len(s.body_core)) + " ids=" + str(len(ids)))