"use strict";
// G5.2：把 ⑤ 输入（17 对 + evidence + cfg）dump 给 Python oracle 生成 prompt goldens。
import path from "node:path";
import fs from "node:fs";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import * as candidates from "../../src/screening/candidates.js";
import * as lexical from "../../src/screening/lexical.js";
import { runSemantic } from "../../src/stages/semantic.js";
import { makeConfig } from "../../src/config.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS = process.env.SKILL_MERGE_MODELS_ROOT || "D:/dsh/skill-merge/models";
const FIX = path.join(__dirname, "..", "fixtures", "corpus");
(async () => {
  const cfg = makeConfig({ seed_mode: "fixed", round_count: 1, embed_backend: "local", embedder_model: path.join(MODELS, "potion-multilingual-128M-int8"), rank_mode: "vec" });
  const [skills] = corpus.loadCorpus([FIX]);
  corpus.stripBoilerplate(skills, cfg);
  const [kept] = prefilter.prefilter(skills, cfg);
  const [pairs] = candidates.generateCandidates(kept, cfg);
  const [passed] = lexical.lexicalGate(kept, pairs, cfg);
  const byPath = new Map(kept.map(s => [s.path, s]));
  const { selected } = await runSemantic(passed, byPath, cfg);
  const out = { corpusRoot: FIX, cfg: { l0_caution: cfg.l0_caution, judge_max_chars_per_skill: cfg.judge_max_chars_per_skill, boilerplate_min_docs: cfg.boilerplate_min_docs, boilerplate_min_ratio: cfg.boilerplate_min_ratio }, pairs: [] };
  selected.forEach((r, i) => {
    const a = byPath.get(r.a_path), b = byPath.get(r.b_path);
    const evidence = { jaccard_summary: r.jaccard_summary, jaccard_body: r.jaccard_body, body_cosine: r.body_core_cosine, summary_cosine: r.summary_cosine };
    out.pairs.push({ i: i, a_path: r.a_path, b_path: r.b_path, a_name: a.name, b_name: b.name, evidence: evidence });
  });
  fs.writeFileSync(path.join(__dirname, "..", "..", "..", "out", "prompt_inputs.json"), JSON.stringify(out, null, 2));
  console.log("pairs=" + out.pairs.length);
})().catch(e => { console.error(e); process.exit(1); });