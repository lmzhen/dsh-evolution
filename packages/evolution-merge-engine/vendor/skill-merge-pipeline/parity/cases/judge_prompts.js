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
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  id: "judge_prompts", layer: "parity", description: "⑤ 27 个 prompt 在 --parity-bytes 下与 Python golden 逐字节一致",
  async run(ctx) {
    const cfg = makeConfig({ seed_mode: "fixed", round_count: 1, embed_backend: "local", embedder_model: ctx.modelDir, rank_mode: "vec", judge: "stub", parity_bytes: true, write_prompts: true });
    const [skills] = corpus.loadCorpus([ctx.corpusRoot]);
    corpus.stripBoilerplate(skills, cfg);
    const [kept] = prefilter.prefilter(skills, cfg);
    const [pairs] = candidates.generateCandidates(kept, cfg);
    const [passed] = lexical.lexicalGate(kept, pairs, cfg);
    const byPath = new Map(kept.map(s => [s.path, s]));
    const { selected } = await runSemantic(passed, byPath, cfg);
    const dir = path.join(ctx.root, "out", "parity_prompts");
    fs.rmSync(dir, { recursive: true, force: true });
    const [, stats] = await judge.judgeCascade(selected, byPath, cfg, dir);
    const goldenDir = path.join(__dirname, "..", "golden", "prompts");
    const goldens = fs.readdirSync(goldenDir).filter(f => f.endsWith(".md")).sort();
    const actual = fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort();
    ctx.assert(JSON.stringify(goldens) === JSON.stringify(actual), "prompt 文件名/数量不一致: " + actual.length + " vs " + goldens.length);
    for (const f of goldens) {
      const a = fs.readFileSync(path.join(goldenDir, f));
      const b = fs.readFileSync(path.join(dir, f));
      ctx.assert(a.equals(b), "prompt 字节不一致: " + f);
    }
    ctx.assert(stats.prompt_version === "judge-prompt-v1", "prompt_version 不符");
    return { prompts: goldens.length, prompt_version: stats.prompt_version };
  }
};