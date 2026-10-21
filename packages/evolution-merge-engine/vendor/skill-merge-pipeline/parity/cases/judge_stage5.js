"use strict";
import fs from "node:fs";
import path from "node:path";
import { makeConfig } from "../../src/config.js";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import * as candidates from "../../src/screening/candidates.js";
import * as lexical from "../../src/screening/lexical.js";
import * as judge from "../../src/judge.js";
import { runSemantic } from "../../src/stages/semantic.js";

export default {
  id: "judge_stage5", layer: "parity", description: "⑤ stub-v1 判决分布 3/0/14、层级 L0:7/L1:10/L2:1、audit 7/1/1 与 Python 基线一致",
  async run(ctx) {
    const cfg = makeConfig({ seed_mode: "fixed", round_count: 1, embed_backend: "local", embedder_model: ctx.modelDir, rank_mode: "vec", judge: "stub", l0_caution: false });
    const [skills] = corpus.loadCorpus([ctx.corpusRoot]);
    corpus.stripBoilerplate(skills, cfg);
    const [kept] = prefilter.prefilter(skills, cfg);
    const [pairs] = candidates.generateCandidates(kept, cfg);
    const [passed] = lexical.lexicalGate(kept, pairs, cfg);
    const byPath = new Map(kept.map(s => [s.path, s]));
    const { selected } = await runSemantic(passed, byPath, cfg);
    const dir = path.join(ctx.root, "out", "parity_stage5");
    fs.rmSync(dir, { recursive: true, force: true });
    const [rows, stats] = await judge.judgeCascade(selected, byPath, cfg, dir);
    ctx.assert(JSON.stringify(stats.verdicts) === JSON.stringify({ "1": 3, "0": 0, "-1": 14 }), "⑤ 判决分布不符: " + JSON.stringify(stats.verdicts));
    ctx.assert(JSON.stringify(stats.levels) === JSON.stringify({ L0: 7, L1: 10, L2: 1 }), "⑤ 层级不符: " + JSON.stringify(stats.levels));
    ctx.assert(stats.stub_version === "stub-v1", "stub 版本不是冻结 oracle");
    ctx.assert(stats.prompt_version === "judge-prompt-v1", "prompt 版本不符");
    ctx.assert(stats.audit_pool === 7 && stats.audit_sampled === 1 && stats.audit_overrides === 1, "audit 统计不符: " + JSON.stringify({ pool: stats.audit_pool, sampled: stats.audit_sampled, overrides: stats.audit_overrides }));
    for (const r of rows) ctx.assert(r.verdict_record && r.verdict_record.prompt_sha === r.prompt_sha, "VerdictRecord 缺失或不一致");
    return { verdicts: stats.verdicts, levels: stats.levels, audit: [stats.audit_pool, stats.audit_sampled, stats.audit_overrides] };
  }
};