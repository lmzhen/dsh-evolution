"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as report from "../src/report.js";
import { assertReportModel } from "../src/contracts/report.js";
import { assertStageSpec, assertStageResult } from "../src/contracts/stage.js";
import { defineStage } from "../src/pipeline/stage.js";
import { validateMergeDecision, validateMergePlanShape, emptyPlan } from "../src/contracts/merge.js";
import { assertEmbedderContract, assertKnownBackend } from "../src/embed/provider.js";
import { assertRankerProvider } from "../src/rerank/provider.js";
import { assertJudgeProvider } from "../src/judge/provider.js";
import { makeConfig } from "../src/config.js";

test("G8.1 Report 契约：buildReport 可过 assertReportModel，坏版本可红", () => {
  const r = report.buildReport({ cfg: makeConfig(), sections: {} });
  assertReportModel(r);
  const bad = { ...r, schemaVersion: 2 };
  assert.throws(() => assertReportModel(bad), /schemaVersion/);
});

test("G8.1 Stage 契约：defineStage/StageResult 可校验，坏形状可红", async () => {
  const s = defineStage({ id: "s", async run() { return { data: 1, stats: {}, warnings: [], counters: {}, degraded: false }; } });
  assertStageSpec(s);
  assertStageResult({ data: 1, stats: {}, warnings: [], counters: {}, degraded: false });
  assert.throws(() => assertStageResult({ data: 1 }), /stats|warnings|counters|degraded/);
});

test("G8.1 Merge 契约：decision/plan validator 可红", () => {
  const d = { relation: "complement", mode: "merge-into-existing", executor: "agent-distill", target: "alpha-beta", sources: ["alpha"], rationale: "r", confidence: 0.5 };
  assert.deepEqual(validateMergeDecision(d), []);
  assert.ok(validateMergeDecision({ ...d, mode: "bogus" }).length);
  const p = emptyPlan({ a: "alpha", b: "beta" });
  p.relation = d.relation; p.mode = d.mode; p.executor = d.executor;
  p.nomination = { target: d.target, sources: d.sources, mode: "append", reason: "r" };
  p.content = { target_sections: [], unit_dispositions: [], atomic_pairs: [], budget: { max_chars: 10 } };
  assert.deepEqual(validateMergePlanShape(p), []);
  assert.ok(validateMergePlanShape({ ...p, mode: "bogus" }).length);
});

test("G8.1 Provider 契约：embed/ranker/judge 解析器可导入可红", () => {
  assert.equal(assertKnownBackend({ embed_backend: "local" }), "local");
  assert.throws(() => assertKnownBackend({ embed_backend: "bogus" }), /未知/);
  assert.throws(() => assertEmbedderContract({}), /encode/);
  assert.throws(() => assertRankerProvider({}), /ranker/);
  assert.throws(() => assertJudgeProvider({}), /judge/);
});

test("G8.1 package：exports 含 screening、不含 plugin；files 不含 docs/tools", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"));
  assert.equal(typeof pkg.exports["./screening"], "string");
  assert.equal(pkg.exports["./plugin"], undefined);
  assert.equal(pkg.files.includes("docs/"), false);
  assert.equal(pkg.files.includes("tools/"), false);
});