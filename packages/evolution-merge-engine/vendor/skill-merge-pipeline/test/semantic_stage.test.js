"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as corpus from "../src/corpus.js";
import * as prefilter from "../src/screening/prefilter.js";
import * as candidates from "../src/screening/candidates.js";
import * as lexical from "../src/screening/lexical.js";
import * as semantic from "../src/screening/semantic.js";
import { runSemantic, semanticStage } from "../src/stages/semantic.js";
import { runStage } from "../src/pipeline/stage.js";
import { createContext } from "../src/pipeline/context.js";
import { makeConfig } from "../src/config.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIX = path.join(__dirname, "..", "parity", "fixtures", "corpus");
const INT8 = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const PCA64 = "D:/dsh/skill-merge/models/potion-multilingual-128M-pca64-int8";
const cfg0 = makeConfig();
const [skills] = corpus.loadCorpus([FIX]);
corpus.stripBoilerplate(skills, cfg0);
const [kept] = prefilter.prefilter(skills, cfg0);
const fixed = makeConfig({ seed_mode: "fixed", round_count: 1 });
const [pairs] = candidates.generateCandidates(kept, fixed);
const [passed] = lexical.lexicalGate(kept, pairs, fixed);
const byPath = new Map(kept.map(s => [s.path, s]));
const localCfg = makeConfig({ embed_backend: "local", embedder_model: INT8, rank_mode: "vec" });
const chainCfg = makeConfig({ embed_backend: "chain", embed_api_key_env: "SKILL_MERGE_TEST_NO_KEY", embedder_model: "D:/nonexistent-int8", embedder_model_last: PCA64, rank_mode: "vec" });

test("stage 元数据：id/requires/run", () => {
  assert.equal(semanticStage.id, "semantic");
  assert.deepEqual(semanticStage.requires, ["passed", "byPath"]);
  assert.equal(typeof semanticStage.run, "function");
});

test("runSemantic 与 semanticSelect 结果深等（int8 ④=17）", async () => {
  const res = await runSemantic(passed, byPath, localCfg);
  const [hit, scored, stats] = await semantic.semanticSelect(passed, byPath, localCfg);
  assert.equal(res.stats.selected, 17);
  assert.equal(res.stats.selected, stats.selected);
  assert.equal(JSON.stringify(res.stats), JSON.stringify(stats));
  const key = r => r.a_path + "|" + r.b_path;
  assert.deepEqual(res.selected.map(key).sort(), hit.map(key).sort());
  assert.equal(res.scored.length, scored.length);
});

test("pca64 降级路径经 stage 仍 ④=26", async () => {
  const res = await runSemantic(passed, byPath, chainCfg);
  assert.equal(res.stats.selected, 26);
  assert.equal(res.stats.embedder_used, "local:pca64-int8");
});

test("skip_stage4 透传；runStage 规范化 counters/timing/degraded", async () => {
  const skip = await runSemantic(passed, byPath, makeConfig({ skip_stage4: true }));
  assert.equal(skip.selected, passed);
  assert.equal(skip.stats.skipped, true);
  const ctx = createContext({ cfg: chainCfg });
  const res = await runStage(semanticStage, ctx, { passed, byPath });
  assert.equal(res.stats.selected, 26);
  assert.equal(res.data.selected.length, 26);
  assert.deepEqual(res.counters, { pairs_in: passed.length, selected: 26 });
  assert.equal(res.degraded, true);
  assert.equal(ctx.timings.filter(t => t.id === "semantic").length, 1);
  ctx.dispose();
});