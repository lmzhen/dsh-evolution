"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import * as report from "../src/report.js";
import { makeConfig } from "../src/config.js";
import { assertReportModel } from "../src/contracts/report.js";
import { assertStageSpec, assertStageResult } from "../src/contracts/stage.js";
import { defineStage, runStage } from "../src/pipeline/stage.js";
import { createContext } from "../src/pipeline/context.js";
import { deterministicClassify } from "../src/merge/classify.js";
import { validateMergeDecision, validateMergePlanShape, emptyPlan } from "../src/contracts/merge.js";
import { mergePairsOf } from "../src/merge/index.js";

const validRow = () => ({ a: "a", b: "b", action: "MERGE", verdict_id: 1, reason: "r" });

test("M1 C2 消费方：buildReport 产物过 assertReportModel，且 mergePairsOf 可消费", () => {
  const r = report.buildReport({ cfg: makeConfig(), sections: { pairs_final: [validRow()] } });
  assertReportModel(r);
  const pairs = mergePairsOf(r);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, "a");
});

test("M1 C3 消费方：runStage 产物过 assertStageResult", async () => {
  const s = defineStage({ id: "x", async run() { return { data: 1, stats: {}, warnings: [], counters: {}, degraded: false }; } });
  assertStageSpec(s);
  const ctx = createContext({ cfg: {} });
  const res = await runStage(s, ctx, {});
  assertStageResult(res);
});

test("M1 C7 消费方：deterministicClassify 决策过 validateMergeDecision", () => {
  const card = {
    pair: { a: "alpha", b: "beta", scores: {} },
    skills: { a: { name: "alpha", chars: 10, support_files: [], units: [] }, b: { name: "beta", chars: 10, support_files: [], units: [] } },
    compat: { both_found: true }
  };
  const d = deterministicClassify(card);
  assert.deepEqual(validateMergeDecision(d), []);
  const p = emptyPlan({ a: "alpha", b: "beta" });
  p.relation = d.relation; p.mode = d.mode; p.executor = d.executor;
  p.nomination = { target: d.target, sources: d.sources, mode: "append", reason: d.rationale };
  p.content = { target_sections: [], unit_dispositions: [], atomic_pairs: [], budget: { max_chars: 10 } };
  p.changelog = [];
  assert.deepEqual(validateMergePlanShape(p), []);
});

test("M1 C1/C10 消费方：公共 API 与 subpath 可导入", async () => {
  const api = await import("skill-merge-pipeline");
  assert.equal(typeof api.runPipeline, "function");
  assert.equal(typeof api.assertReportModel, "function");
  const contract = await import("skill-merge-pipeline/contracts/merge");
  assert.equal(contract.MODES.length, 5);
});