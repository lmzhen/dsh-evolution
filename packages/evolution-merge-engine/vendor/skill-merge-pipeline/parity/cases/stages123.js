"use strict";
import fs from "node:fs";
import { makeConfig } from "../../src/config.js";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import * as candidates from "../../src/screening/candidates.js";
import * as lexical from "../../src/screening/lexical.js";
import { alignCandidates } from "../align.js";

function runPipeline(ctx) {
  const cfg = makeConfig({ seed_mode: "fixed", round_count: 1 });
  const [skills] = corpus.loadCorpus([ctx.corpusRoot]);
  const bp = corpus.stripBoilerplate(skills, cfg);
  const [kept, dropped, pre] = prefilter.prefilter(skills, cfg);
  const [pairs, cand] = candidates.generateCandidates(kept, cfg);
  const passedResult = lexical.lexicalGate(kept, pairs, cfg);
  return { cfg, skills, bp, kept, dropped, pre, pairs, cand, passedResult };
}

export default {
  id: "stages123", layer: "parity", description: "①②③ 与 Python golden 对齐后一致",
  run(ctx) {
    const ref = ctx.golden("ref_stages.json");
    const r = runPipeline(ctx);
    ctx.assert(r.kept.length === ref.skills.length, "技能数不一致: " + r.kept.length + " vs " + ref.skills.length);
    ctx.assert(JSON.stringify(r.pre) === JSON.stringify(ref.prefilter), "① 预过滤 stats 不一致");
    ctx.assert(JSON.stringify(r.bp) === JSON.stringify(ref.boilerplate), "前言剥离不一致");
    ctx.assert(r.pairs.size === ref.candidates_stats.candidate_pairs, "② 候选数不一致: " + r.pairs.size + " vs " + ref.candidates_stats.candidate_pairs);
    const candStat = Object.fromEntries(Object.entries(r.cand).filter(([k]) => k !== "rounds_detail"));
    ctx.assert(JSON.stringify(candStat) === JSON.stringify(ref.candidates_stats), "② stats 不一致");
    ctx.assert(JSON.stringify(r.cand.rounds_detail) === JSON.stringify(ref.rounds_detail), "② 轮次明细不一致");
    // 行序对齐后比较 ③（Python 集合遍历序与 Node 插入序不同，需对齐）
    const aligned = alignCandidates(r.pairs, ref.candidates);
    const [passed, , lexStats] = lexical.lexicalGate(r.kept, aligned, r.cfg);
    ctx.assert(passed.length === ref.passed.length, "③ 通过数不一致: " + passed.length + " vs " + ref.passed.length);
    ctx.assert(JSON.stringify(lexStats) === JSON.stringify(ref.lexical_stats), "③ stats 不一致");
    const rel = p => p.replace(/^.*[\\/]fixtures[\\/]corpus[\\/]/, "");
    const keyOf = x => [rel(x.a_path), rel(x.b_path)].sort().join("|");
    const nodeSet = new Set(passed.map(keyOf));
    const pySet = new Set(ref.passed.map(keyOf));
    ctx.assert(nodeSet.size === pySet.size && [...pySet].every(k => nodeSet.has(k)), "③ 通过集不一致");
    return { candidates: r.pairs.size, passed: passed.length };
  }
};