import sys, json
sys.path.insert(0, "D:/dsh/skill-merge/pipeline"); sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
import corpus, extract
from config import Config
from stream_static import StreamedStatic
cfg = Config()
skills, _ = corpus.load_corpus(["C:/Users/limengzhen/.dsh/skills"])
corpus.strip_boilerplate(skills, cfg)
target = [s for s in skills if s.name == "flyai"][0]
m = StreamedStatic("D:/dsh/skill-merge/models/potion-multilingual-128M-int8")
v = m.encode(target.body_core)
json.dump({"body_len": len(target.body), "body_core_len": len(target.body_core), "vec": [float(x) for x in v],
           "head_len": len(extract.head_extract(target)), "head_md5": __import__("hashlib").md5(extract.head_extract(target).encode()).hexdigest()},
          open("D:/dsh/skill-merge/node/parity/ref_crlf_impact.json", "w"))
print("  Python flyai: body=%d body_core=%d head=%d" % (len(target.body), len(target.body_core), len(extract.head_extract(target))))