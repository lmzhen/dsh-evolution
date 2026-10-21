"use strict";
import test from "node:test";
import { provisionStage } from "../src/stages/provision.js";
import { rankPlanStage } from "../src/stages/rank_plan.js";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPipeline, defaultStages, timingOf } from "../src/pipeline/index.js";
import { defineStage } from "../src/pipeline/stage.js";
import { UsageError, PipelineError } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";
import * as corpus from "../src/corpus.js";
import { makeConfig } from "../src/config.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIX = path.join(__dirname, "..", "parity", "fixtures", "corpus");
const INT8 = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipe-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const cfg0 = makeConfig();
const [skills] = corpus.loadCorpus([FIX]);
corpus.stripBoilerplate(skills, cfg0);
const cfgFixed = () => makeConfig({ seed_mode: "fixed", round_count: 1 });
const cfgLocal = () => makeConfig({ seed_mode: "fixed", round_count: 1, embed_backend: "local", embedder_model: INT8, embedder_model_last: "D:/dsh/skill-merge/models/potion-multilingual-128M-pca64-int8", rank_mode: "vec" });

test("空 stage 管线可跑：ok/exitCode 0/timings 空/cleanup 0", async () => {
  const res = await runPipeline({ cfg: cfgFixed(), out: tmp, stages: [] });
  assert.equal(res.ok, true);
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.timings, []);
  assert.deepEqual(res.diagnostics, []);
  assert.deepEqual(res.cleanup, { executed: 0, failed: 0 });
});

test("默认骨架前 3 段：fixture 语料跑通，timings/次序正确", async () => {
  const res = await runPipeline({ cfg: cfgFixed(), out: tmp, stages: defaultStages().slice(0, 3), input: { skills } });
  assert.equal(res.ok, true, res.error && res.error.message);
  assert.equal(res.data.prefilter.kept.length, 45);
  assert.ok(res.data.candidates.pairs.size > 0);
  assert.equal(res.data.lexical.passed.length, 134);
  assert.deepEqual(res.timings.map(t => t.id), ["prefilter", "candidates", "lexical"]);
  assert.ok(res.timings.every(t => typeof t.ms === "number" && t.ms >= 0));
  assert.deepEqual(res.diagnosticsSummary, {});
  assert.ok(timingOf(res, "prefilter") !== null);
  assert.equal(timingOf(res, "nope"), null);
});

test("默认骨架前 4 段：semantic stage 接入，④=17", async () => {
  const res = await runPipeline({ cfg: cfgLocal(), out: tmp, stages: defaultStages().slice(0, 4), input: { skills } });
  assert.equal(res.ok, true, res.error && res.error.message);
  assert.equal(res.data.semantic.selected.length, 17);
  assert.equal(res.data.semantic.selected, res.data.semantic.scored);
  assert.ok(res.data.semantic.byPath instanceof Map);
  assert.deepEqual(res.timings.map(t => t.id), ["prefilter", "candidates", "lexical", "semantic"]);
});

test("progress 事件顺序：start→stage-start/done×N→done", async () => {
  const events = [];
  const res = await runPipeline({ cfg: cfgFixed(), out: tmp, stages: defaultStages().slice(0, 3), input: { skills }, onProgress: e => events.push(e.phase + (e.stage ? ":" + e.stage : "")) });
  assert.equal(res.ok, true);
  assert.deepEqual(events, ["start", "stage-start:prefilter", "stage-done:prefilter", "stage-start:candidates", "stage-done:candidates", "stage-start:lexical", "stage-done:lexical", "done"]);
});

test("provision hook 先于 stage 且只调一次；cleanup 执行", async () => {
  const events = [];
  const res = await runPipeline({
    cfg: cfgFixed(), out: tmp, stages: [],
    provision: async (ctx) => { events.push("provision"); ctx.onCleanup(() => events.push("cleanup-a")); ctx.onCleanup(() => events.push("cleanup-b")); },
    onProgress: e => events.push("phase:" + e.phase)
  });
  assert.equal(res.ok, true);
  assert.deepEqual(events, ["phase:start", "phase:provision", "provision", "cleanup-b", "cleanup-a", "phase:done"]);
  assert.deepEqual(res.cleanup, { executed: 2, failed: 0 });
});

test("整链 8 段（含 provision/rank_plan）：跑通且 ⑤=17", async () => {
  const base = defaultStages();
  const stages = [base[0], base[1], base[2], provisionStage, rankPlanStage, base[3], base[4], base[5]];
  const res = await runPipeline({ cfg: cfgLocal(), out: path.join(tmp, "full"), stages, input: { skills } });
  assert.equal(res.ok, true, res.error && res.error.message);
  assert.deepEqual(res.timings.map(t => t.id), ["prefilter", "candidates", "lexical", "provision", "rank_plan", "semantic", "rerank", "judge"]);
  assert.equal(res.data.judge.verdicts.length, 17);
  assert.equal(res.data.rank_plan.plan.use_local, false);
  assert.equal(res.data.provision.supply.skipped, true);
  assert.equal(res.data.semantic.selected.length, 17);
});

test("退出码映射：UsageError→2；非法依赖→1；错误进 diagnostics", async () => {
  const usage = defineStage({ id: "bad_usage", async run() { throw new UsageError("参数错误"); } });
  const r1 = await runPipeline({ cfg: cfgFixed(), out: tmp, stages: [usage] });
  assert.equal(r1.ok, false);
  assert.equal(r1.exitCode, 2);
  assert.equal(r1.diagnostics.length, 1);
  assert.equal(r1.diagnostics[0].code, DiagnosticCode.USAGE);
  const r2 = await runPipeline({ cfg: cfgFixed(), out: tmp, stages: [defaultStages()[2]], input: { skills } });
  assert.equal(r2.ok, false);
  assert.equal(r2.exitCode, 1);
  assert.match(String(r2.error.message), /依赖 prefilter 未在此之前执行/);
});

test("失败路径 cleanup LIFO 仍执行；warnings→diagnostics", async () => {
  const events = [];
  const warn = defineStage({
    id: "warning",
    async run(ctx) {
      ctx.onCleanup(() => events.push("cleanup-1"));
      return { warnings: [{ code: DiagnosticCode.UNAVAILABLE, where: "warning", detail: "降级" }] };
    }
  });
  const boom = defineStage({ id: "boom", requires: ["warning"], async run() { throw new PipelineError("炸了", { code: DiagnosticCode.INVALID }); } });
  const res = await runPipeline({ cfg: cfgFixed(), out: tmp, stages: [warn, boom] });
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, 1);
  assert.equal(res.diagnosticsSummary.UNAVAILABLE, 1);
  assert.equal(res.cleanup.executed, 1);
  assert.deepEqual(events, ["cleanup-1"]);
});