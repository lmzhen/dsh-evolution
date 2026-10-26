"use strict";
import { makeConfig } from "../../src/config.js";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import * as candidates from "../../src/screening/candidates.js";
import * as lexical from "../../src/screening/lexical.js";
import { runSemantic } from "../../src/stages/semantic.js";
import { alignCandidates } from "../align.js";

export default {
  id: "stage4", layer: "parity", description: "④ 名单/余弦与 Python golden 一致",
  async run(ctx) {
    const ref = ctx.golden("ref_stages.json");
    const ref4 = ctx.golden("ref_stage4.json");
    const cfg = makeConfig({ seed_mode: "fixed", round_count: 1, embed_backend: "local", embedder_model: ctx.modelDir, rank_mode: "vec" });
    const [skills] = corpus.loadCorpus([ctx.corpusRoot]);
    corpus.stripBoilerplate(skills, cfg);
    const [kept] = prefilter.prefilter(skills, cfg);
    const [pairs] = candidates.generateCandidates(kept, cfg);
    const aligned = alignCandidates(pairs, ref.candidates);
    const [passed] = lexical.lexicalGate(kept, aligned, cfg);
    const byPath = new Map(kept.map(s => [s.path, s]));
    const { selected: hit, stats } = await runSemantic(passed, byPath, cfg);
    const pyt = ref4.stage4;
    ctx.assert(stats.selected === pyt.selected, "④ selected 不一致: " + stats.selected + " vs " + pyt.selected);
    ctx.assert(JSON.stringify(stats.floors_used) === JSON.stringify(pyt.floors_used), "④ floors 不一致");
    ctx.assert(JSON.stringify(stats.per_projection) === JSON.stringify(pyt.per_projection), "④ per_projection 不一致");
    const rel = p => p.replace(/^.*[\\/]fixtures[\\/]corpus[\\/]/, "");
    const key = r => [rel(r.a_path), rel(r.b_path)].sort().join("|");
    const nodeSet = new Set(hit.map(key));
    const pySet = new Set(ref4.stage4_rows.map(key));
    ctx.assert(nodeSet.size === pySet.size && [...pySet].every(k => nodeSet.has(k)), "④ 名单不一致");
    const pyRows = new Map(ref4.stage4_rows.map(r => [key(r), r]));
    for (const r of hit) {
      const p = pyRows.get(key(r));
      if (!p) continue;
      if (r.body_core_cosine !== undefined) ctx.assert(Math.abs(r.body_core_cosine - p.body_core_cosine) <= 1e-4, "④ body 余弦差过大: " + key(r));
      if (r.summary_cosine !== undefined) ctx.assert(Math.abs(r.summary_cosine - p.summary_cosine) <= 1e-4, "④ summary 余弦差过大: " + key(r));
    }
    return { selected: hit.length };
  }
};