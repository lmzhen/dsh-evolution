"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { createContext, runWithContext } from "../src/pipeline/context.js";
import { defineStage, runStage, runStages } from "../src/pipeline/stage.js";
import { REPORT_SCHEMA_VERSION, snapshotConfig, assertJsonSafe, buildReport } from "../src/report.js";
import { makeConfig } from "../src/config.js";
import { DiagnosticCode } from "../src/contracts.js";
import { toDiagnostic, PipelineError } from "../src/errors.js";

test("ctx.cleanup 成功路径 LIFO", async () => {
  const ctx = createContext({ cfg: makeConfig() });
  const order = [];
  ctx.onCleanup(() => order.push("a"));
  ctx.onCleanup(() => order.push("b"));
  ctx.onCleanup(() => order.push("c"));
  await runWithContext(ctx, async () => {});
  assert.deepEqual(order, ["c", "b", "a"]);
  assert.equal(ctx.cleanup.length, 0);
});

test("ctx.cleanup 异常路径也执行；dispose 幂等", async () => {
  const ctx = createContext({ cfg: makeConfig() });
  let done = 0;
  ctx.onCleanup(() => { done += 1; });
  await assert.rejects(runWithContext(ctx, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(done, 1);
  assert.deepEqual(ctx.dispose(), { executed: 0, failed: 0, skipped: true });
});

test("cleanup 单个失败记诊断且继续执行", async () => {
  const ctx = createContext({ cfg: makeConfig() });
  const order = [];
  ctx.onCleanup(() => order.push("first"));
  ctx.onCleanup(() => { throw new Error("cleanup-fail"); });
  ctx.onCleanup(() => order.push("third"));
  const r = await runWithContext(ctx, async () => 1);
  assert.equal(r.value, 1);
  assert.deepEqual(order, ["third", "first"]);
  assert.equal(ctx.diagnostics.items.length, 1);
  assert.equal(toDiagnostic({ message: "x", code: ctx.diagnostics.items[0].code }).code, DiagnosticCode.INTERNAL);
});

test("addTiming 形状与四舍五入", () => {
  const ctx = createContext({ cfg: makeConfig() });
  const e = ctx.addTiming("stage1", 12.34, { counters: { n: 3 }, degraded: true });
  assert.deepEqual(e, { id: "stage1", ms: 12.3, counters: { n: 3 }, degraded: true });
});

test("defineStage 校验与冻结", () => {
  assert.throws(() => defineStage({ run: () => ({}) }), /id/);
  assert.throws(() => defineStage({ id: "x", requires: "a", run: async () => ({}) }), /requires/);
  assert.throws(() => defineStage({ id: "x" }), /run/);
  const s = defineStage({ id: "x", run: async () => ({}) });
  assert.equal(Object.isFrozen(s), true);
  assert.deepEqual([...s.requires], []);
});

test("runStage：requires 缺失抛错；计时/计数/warnings 落账", async () => {
  const ctx = createContext({ cfg: makeConfig() });
  const s = defineStage({ id: "s", requires: ["prev"], run: async () => ({ data: { x: 1 }, counters: { n: 2 }, warnings: [{ code: DiagnosticCode.PARTIAL, where: "s", detail: "w" }] }) });
  await assert.rejects(runStage(s, ctx, {}), /缺少依赖/);
  const res = await runStage(s, ctx, { prev: true });
  assert.deepEqual(res.data, { x: 1 });
  assert.deepEqual(res.counters, { n: 2 });
  assert.equal(res.warnings.length, 1);
  assert.equal(ctx.timings.length, 1);
  assert.equal(ctx.timings[0].id, "s");
  assert.deepEqual(ctx.timings[0].counters, { n: 2 });
  assert.equal(ctx.diagnostics.items.length, 1);
});

test("runStage：异常时记 degraded 计时并抛出", async () => {
  const ctx = createContext({ cfg: makeConfig() });
  const s = defineStage({ id: "bad", run: async () => { throw new Error("x"); } });
  await assert.rejects(runStage(s, ctx, {}), /x/);
  assert.equal(ctx.timings[0].degraded, true);
});

test("runStages：重复 id/依赖顺序/数据传递", async () => {
  const ctx = createContext({ cfg: makeConfig() });
  const s1 = defineStage({ id: "one", run: async () => ({ data: { a: 1 } }) });
  const s2 = defineStage({ id: "two", requires: ["one"], run: async (c, env) => ({ data: { b: env.one.a + 1 } }) });
  const ok = await runStages([s1, s2], ctx, { seed: 0 });
  assert.deepEqual(ok.data, { one: { a: 1 }, two: { b: 2 } });
  await assert.rejects(runStages([s1, s1], createContext({ cfg: makeConfig() }), {}), /重复/);
  await assert.rejects(runStages([s2, s1], createContext({ cfg: makeConfig() }), {}), /未在此之前执行/);
});

test("snapshotConfig：仅 schema 字段、排除运行时键、深拷贝", () => {
  const cfg = makeConfig();
  cfg.rank_checkpoint = "/tmp/ckpt.json";
  cfg.dynamic_key = 1;
  const snap = snapshotConfig(cfg);
  assert.equal("rank_checkpoint" in snap, false);
  assert.equal("dynamic_key" in snap, false);
  assert.equal(snap.judge, "stub");
  snap.embed_floor_presets.local.body = 0.5;
  assert.equal(cfg.embed_floor_presets.local.body, 0.95);
});

test("buildReport：骨架字段完整、JSON 安全、错误可诊断", () => {
  const ctx = createContext({ cfg: makeConfig() });
  ctx.addTiming("stage1", 3.33, { counters: { n: 1 } });
  ctx.record({ code: DiagnosticCode.PARTIAL, where: "x", detail: "d" });
  const rep = buildReport({ ctx, meta: { runId: "r1" }, sections: { pairs_final: [], stage1_prefilter: { kept: 45 } } });
  assert.equal(rep.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(rep.meta.runId, "r1");
  assert.equal(rep.stages.length, 1);
  assert.equal(rep.diagnostics.length, 1);
  assert.equal(rep.pairs_final.length, 0);
  assert.equal(rep.stage1_prefilter.kept, 45);
  assert.equal("rank_checkpoint" in rep.config, false);
  assert.deepEqual(JSON.parse(JSON.stringify(rep)), rep);
});

test("assertJsonSafe：undefined/NaN/函数 都拒绝", () => {
  assert.throws(() => assertJsonSafe({ a: { b: undefined } }), /undefined/);
  assert.throws(() => assertJsonSafe({ a: [NaN] }), /非有限/);
  assert.throws(() => assertJsonSafe({ a: () => 1 }), /不可序列化/);
  assert.throws(() => buildReport({ ctx: createContext({ cfg: makeConfig() }), sections: { bad: undefined } }), /undefined/);
  assert.equal(assertJsonSafe({ ok: 1, s: "x", n: null }), undefined);
});