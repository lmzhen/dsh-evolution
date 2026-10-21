import json, os, sys, time
sys.path.insert(0, "D:/dsh/skill-merge/pipeline"); sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import corpus, prefilter, candidates, lexical, semantic, rerank, judge
from config import Config
def phase(label, fn):
    t0 = time.time()
    r = fn()
    ms = (time.time() - t0) * 1000
    print("  %-30s %6d ms" % (label, int(ms)))
    return r
cfg = Config(); cfg.seed_mode = "fixed"; cfg.round_count = 1
cfg.embed_backend = "local"; cfg.rank_mode = "vec"
skills = phase("① loadCorpus", lambda: corpus.load_corpus(["C:/Users/limengzhen/.dsh/skills"])[0])
phase("   stripBoilerplate", lambda: corpus.strip_boilerplate(skills, cfg))
kept = phase("① prefilter", lambda: prefilter.prefilter(skills, cfg)[0])
pairs = phase("② generateCandidates", lambda: candidates.generate_candidates(kept, cfg)[0])
passed = phase("③ lexicalGate", lambda: lexical.lexical_gate(kept, pairs, cfg)[0])
by_path = {s.path: s for s in kept}
hit = phase("④ semanticSelect", lambda: semantic.semantic_select(passed, by_path, cfg)[0])
cfg.rank_checkpoint = ""
picked = phase("④.5 rerank(vec)", lambda: rerank.rerank(hit, by_path, cfg)[0])
verdicts = phase("⑤ judge(stub)", lambda: judge.judge_cascade(picked, by_path, cfg, "D:/dsh/skill-merge/out/py_profile_prompts")[0])
print("  ④ 输出 %d | ⑤ %d" % (len(hit), len(verdicts)))