"""生成 Node 迁移的对齐参考数据（固定 seed）。"""
import json, os, sys
sys.path.insert(0, "D:/dsh/skill-merge/pipeline")
sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
import corpus, prefilter, candidates, lexical
from config import Config
cfg = Config()
cfg.seed_mode = "fixed"
cfg.round_count = 1
skills, load = corpus.load_corpus(["D:/dsh/skill-merge/node/parity/fixtures/corpus"])
bp = corpus.strip_boilerplate(skills, cfg)
kept, dropped, pre = prefilter.prefilter(skills, cfg)
pairs, cand = candidates.generate_candidates(kept, cfg)
passed, scored, lex = lexical.lexical_gate(kept, pairs, cfg)
by_path = {s.path: s for s in kept}
out = {
  "load": load, "boilerplate": bp, "prefilter": pre,
  "candidates_stats": {k: v for k, v in cand.items() if k != "rounds_detail"},
  "rounds_detail": cand.get("rounds_detail"),
  "lexical_stats": lex,
  "skills": [{"path": s.path, "name": s.name, "description": s.description,
              "summary": s.summary, "body_core": s.body_core, "body": s.body} for s in kept],
  "dropped": dropped,
  "candidates": [{"a_path": p[0], "b_path": p[1], "jaccard_summary": v["jaccard_summary"], "jaccard_body": v["jaccard_body"], "nets": v["nets"], "rounds": v["rounds"]} for p, v in pairs.items()],
  "passed": [{"a": r["a"], "b": r["b"], "a_path": r["a_path"], "b_path": r["b_path"], "jaccard_summary": r["jaccard_summary"], "jaccard_body": r["jaccard_body"]} for r in passed],
}
json.dump(out, open("D:/dsh/skill-merge/node/parity/golden/ref_stages.json", "w", encoding="utf-8"), ensure_ascii=False)
# tokenizer 参考
from tokenizers import Tokenizer
tk = Tokenizer.from_file("D:/dsh/skill-merge/models/potion-multilingual-128M-int8/tokenizer.json")
texts = []
for s in kept[:8]:
    texts.append(s.summary)
    texts.append((s.body_core or s.body)[:600])
texts += ["Hello, world! 这是一个测试（含标点）：ok.", "unterminated test 1234 -- a/b=c", "两个  连续空格  与\t制表符", "NFKC: ① ㈱ Ⅻ ㎞ ½"]
ref_tok = [{"text": t, "ids": tk.encode(t).ids} for t in texts]
json.dump(ref_tok, open("D:/dsh/skill-merge/node/parity/golden/ref_tokenizer.json", "w", encoding="utf-8"), ensure_ascii=False)
# minhash 参考：前 3 个技能在 seed=1 下的签名
sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
from datasketch import MinHash
from textutil import token_set
sigs = []
for s in kept[:3]:
    m = MinHash(num_perm=128, seed=1)
    for it in token_set(s.summary):
        m.update(it.encode("utf-8"))
    sigs.append({"name": s.name, "values": [int(x) for x in m.hashvalues]})
json.dump(sigs, open("D:/dsh/skill-merge/node/parity/golden/ref_minhash.json", "w", encoding="utf-8"), ensure_ascii=False)
print("skills:", len(kept), "| candidates:", len(pairs), "| passed:", len(passed), "| tok texts:", len(ref_tok))