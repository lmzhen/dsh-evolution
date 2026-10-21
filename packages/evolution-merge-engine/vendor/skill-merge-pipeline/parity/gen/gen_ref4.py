import json, sys
sys.path.insert(0, "D:/dsh/skill-merge/pipeline")
sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
import corpus, prefilter, candidates, lexical
import semantic, rerank
from config import Config
cfg = Config()
cfg.seed_mode = "fixed"; cfg.round_count = 1
cfg.embed_backend = "local"
skills, _ = corpus.load_corpus(["D:/dsh/skill-merge/node/parity/fixtures/corpus"])
corpus.strip_boilerplate(skills, cfg)
kept, _, _ = prefilter.prefilter(skills, cfg)
pairs, _ = candidates.generate_candidates(kept, cfg)
passed, _, _ = lexical.lexical_gate(kept, pairs, cfg)
by_path = {s.path: s for s in kept}
hit, scored, stats = semantic.semantic_select(passed, by_path, cfg)
cfg.rank_checkpoint = ""
cfg.rank_mode = "vec"
picked, rstats = rerank.rerank(hit, by_path, cfg)
def slim(rows):
    return [{k: r.get(k) for k in ("a","b","a_path","b_path","body_core_cosine","summary_cosine","arms","rank_score","rank_arms","rank_source")} for r in rows]
out = {"stage4": stats, "stage4_rows": slim(hit), "stage45": rstats, "stage45_rows": slim(picked)}
json.dump(out, open("D:/dsh/skill-merge/node/parity/golden/ref_stage4.json","w",encoding="utf-8"), ensure_ascii=False, indent=1)
print("④ selected:", stats.get("selected"), "| ④.5 n_out:", rstats.get("n_out"), "| mode:", rstats.get("mode_used"))