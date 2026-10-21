"use strict";
// C4 例外：judge 需写 prompt 文件（ctx.out/prompts）；其余 stage 纯计算。
import path from "node:path";
import { defineStage } from "../pipeline/stage.js";
import * as judge from "../judge.js";
const judgeStage = defineStage({
  id: "judge",
  requires: ["semantic", "rerank"],
  async run(ctx, env) {
    const cfg = Object.assign({}, ctx.cfg);
    const resolution = judge.resolveJudge(cfg, ctx.env);
    if (cfg.judge === "auto") cfg.judge = resolution.mode;
    if (cfg.judge === "stub2" && env.semantic && env.semantic.floors_used) {
      cfg.stub2_floors = { body: env.semantic.floors_used.body, summary: env.semantic.floors_used.summary };
      ctx.state.stub2Floors = cfg.stub2_floors;
    }
    ctx.state.judgeMode = cfg.judge;
    const [verdicts, stats] = await judge.judgeCascade(env.rerank.ranked, env.semantic.byPath, cfg, path.join(ctx.out, "prompts"));
    return { data: { verdicts, fallback: resolution.fallback }, stats, counters: { pairs: verdicts.length } };
  }
});
export { judgeStage };