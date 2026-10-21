import json, sys
sys.path.insert(0, "D:/dsh/skill-merge/pipeline"); sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
import corpus
from config import Config
cfg = Config()
skills, load = corpus.load_corpus(["C:/Users/limengzhen/.dsh/skills"])
corpus.strip_boilerplate(skills, cfg)
out = {s.path: {"name": s.name, "description": s.description, "summary": s.summary, "body": s.body, "body_core": s.body_core} for s in skills}
json.dump(out, open("D:/dsh/skill-merge/node/parity/golden/ref_corpus_full.json", "w", encoding="utf-8"), ensure_ascii=False)
print("导出", len(out), "技能")