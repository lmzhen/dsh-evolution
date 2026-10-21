"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as corpus from "../src/corpus.js";
import * as prefilter from "../src/screening/prefilter.js";
import * as candidates from "../src/screening/candidates.js";
import * as lexical from "../src/screening/lexical.js";
import * as semantic from "../src/screening/semantic.js";
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

function chainCfg(extra) {
  return makeConfig(Object.assign({
    embed_backend: "chain",
    embed_api_key_env: "SKILL_MERGE_TEST_NO_KEY",
    embedder_model: INT8,
    embedder_model_last: PCA64,
    rank_mode: "vec"
  }, extra || {}));
}

test("默认 chain：远程无 key 降级 int8，④=17，floors 走 local:int8-256", async () => {
  const [, , stats] = await semantic.semanticSelect(passed, byPath, chainCfg());
  assert.equal(stats.selected, 17, "④ 应与 Python golden 一致");
  assert.equal(stats.embedder_used, "local:int8-256");
  assert.equal(stats.embedder_degraded, true);
  assert.equal(stats.embedder_reason, "no-key");
  assert.equal(stats.floors_used.tier, "local:int8-256");
  assert.deepEqual({ body: stats.floors_used.body, summary: stats.floors_used.summary }, { body: 0.95, summary: 0.6 });
  assert.deepEqual(stats.embedder_chain.map(a => a.tier + ":" + a.phase + ":" + (a.ok ? "ok" : a.reasonCode)), ["qwen3-embedding-8b:build:no-key", "bge-m3:build:no-key", "local:int8-256:build:ok"]);
});

test("int8 不可用 → pca64 档 ④=26（与 Python 一致）", async () => {
  const cfg = chainCfg({ embedder_model: "D:/nonexistent-int8-for-test" });
  const [, , stats] = await semantic.semanticSelect(passed, byPath, cfg);
  assert.equal(stats.selected, 26);
  assert.equal(stats.embedder_used, "local:pca64-int8");
  assert.equal(stats.embedder_degraded, true);
  assert.equal(stats.floors_used.tier, "local:pca64-int8");
  assert.deepEqual({ body: stats.floors_used.body, summary: stats.floors_used.summary }, { body: 0.95, summary: 0.6 });
  assert.ok(stats.embedder_chain.some(a => a.tier === "local:int8-256" && !a.ok));
});