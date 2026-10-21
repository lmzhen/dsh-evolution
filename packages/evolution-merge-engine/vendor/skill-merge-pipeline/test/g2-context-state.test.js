"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createContext } from "../src/pipeline/context.js";
import { runPipeline } from "../src/pipeline/index.js";
import { defineStage, runStage } from "../src/pipeline/stage.js";
import { makeConfig } from "../src/config.js";
import { provisionStage } from "../src/stages/provision.js";
import { rankPlanStage } from "../src/stages/rank_plan.js";
import { judgeStage } from "../src/stages/judge.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g2-context-"));
const INT8 = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";

test("G2.2 createContext：cfg 冻结、state 默认/注入", () => {
  const cfg = makeConfig();
  const ctx = createContext({ cfg });
  assert.equal(Object.isFrozen(ctx.cfg), true);
  assert.deepEqual(ctx.state, {});
  assert.throws(() => { ctx.cfg.judge = "deepseek"; }, TypeError);
  const state = { marker: 1 };
  assert.equal(createContext({ cfg, state }).state, state);
});

test("G2.2 runPipeline：state 透传到 stage", async () => {
  let seen = null;
  const s = defineStage({ id: "s", async run(ctx) { seen = ctx.state; return { data: 1, stats: {}, warnings: [], counters: {}, degraded: false }; } });
  const res = await runPipeline({ cfg: makeConfig(), state: { marker: 2 }, stages: [s] });
  assert.equal(res.ok, true);
  assert.equal(seen.marker, 2);
});

test("G2.2 provision/rank_plan/judge 写 state 不写 cfg", async () => {
  if (!fs.existsSync(path.join(INT8, "config.json"))) return;
  const cfg = makeConfig({ embedder_model: INT8, embedder_model_last: INT8, rank_mode: "vec", judge: "auto" });
  const ctx = createContext({ cfg, out: tmp, env: {} });
  const provision = await runStage(provisionStage, ctx, { lexical: { passed: [] } });
  assert.ok(ctx.state.modelDirs && ctx.state.modelDirs.int8);
  assert.equal(Object.prototype.hasOwnProperty.call(cfg, "stub2_floors"), false);
  const rank = await runStage(rankPlanStage, ctx, { lexical: { passed: [] } });
  assert.equal(typeof ctx.state.semanticTopN, "number");
  assert.equal(Object.prototype.hasOwnProperty.call(cfg, "semantic_top_n"), true);
  const judge = await runStage(judgeStage, ctx, { semantic: { byPath: new Map(), floors_used: { body: 0.9, summary: 0.6 } }, rerank: { ranked: [] } });
  assert.equal(ctx.cfg.judge, "auto");
  assert.equal(ctx.state.judgeMode, "stub");
  assert.equal(provision.data.supply.dirs.int8, ctx.state.modelDirs.int8);
  assert.equal(rank.data.plan.semantic_top_n, ctx.state.semanticTopN);
  assert.match(judge.data.fallback, /DEEPSEEK|stub/);
});