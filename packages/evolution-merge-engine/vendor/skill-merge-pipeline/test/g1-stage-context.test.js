"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { defineStage, runStage } from "../src/pipeline/stage.js";
import { createContext } from "../src/pipeline/context.js";
import { STAGE_CONTRACT_VERSION, STAGE_RESULT_KEYS, CONTEXT_REQUIRED_KEYS, assertStageSpec, assertStageResult, assertContextShape } from "../src/contracts/stage.js";
import { InvalidDataError } from "../src/errors.js";

function fakeContext() {
  return {
    cfg: {}, state: {}, signal: null, out: "", env: {}, log: () => {}, clock: () => 0,
    timings: [], cleanup: [], diagnostics: { items: [], record: () => {}, recordError: () => {}, countByCode: () => ({}) },
    addTiming: () => {}, onCleanup: () => {}, record: () => {}, recordError: () => {}, dispose: () => ({})
  };
}

test("C3 StageSpec 合法形状与冻结", () => {
  const s = defineStage({ id: "x", requires: ["a"], async run() { return { data: 1, stats: {}, warnings: [], counters: {}, degraded: false }; } });
  assert.equal(STAGE_CONTRACT_VERSION, 1);
  assert.ok(Object.isFrozen(s));
  assert.ok(Object.isFrozen(s.requires));
  assert.equal(assertStageSpec(s), s);
});

test("C3 StageSpec 拒绝缺 id/run/坏 requires", () => {
  const isInvalid = (e) => e && e.code === "INVALID";
  assert.throws(() => defineStage({}), isInvalid);
  assert.throws(() => defineStage({ id: "x" }), isInvalid);
  assert.throws(() => defineStage({ id: "x", requires: [1], run() {} }), isInvalid);
});

test("C3 StageResult 五键齐全；runStage 产出通过校验", async () => {
  assert.deepEqual(STAGE_RESULT_KEYS, ["data", "stats", "warnings", "counters", "degraded"]);
  const s = defineStage({ id: "x", async run() { return { data: { ok: 1 }, stats: { n: 1 }, warnings: [], counters: { n: 1 }, degraded: false }; } });
  const ctx = createContext({ cfg: {} });
  const res = await runStage(s, ctx, {});
  assert.equal(assertStageResult(res), res);
  assert.throws(() => assertStageResult({ data: 1 }), InvalidDataError);
  assert.throws(() => assertStageResult({ data: 1, stats: {}, warnings: [], counters: {}, degraded: "no" }), InvalidDataError);
});

test("C3 PipelineContext 必需键形状（契约 fixture）", () => {
  assert.ok(CONTEXT_REQUIRED_KEYS.includes("state"));
  assert.ok(CONTEXT_REQUIRED_KEYS.includes("signal"));
  assert.equal(assertContextShape(fakeContext()).state !== undefined, true);
  const bad = fakeContext(); delete bad.state;
  assert.throws(() => assertContextShape(bad), InvalidDataError);
});