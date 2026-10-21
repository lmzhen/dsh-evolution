"use strict";
import { defineStage } from "../pipeline/stage.js";
import * as rerank from "../rerank/index.js";
const rankPlanStage = defineStage({
  id: "rank_plan",
  requires: ["lexical"],
  async run(ctx, env) {
    const plan = await rerank.plan(ctx.cfg, { signal: ctx.signal });
    let semanticTopN = Number(ctx.cfg.semantic_top_n);
    if (plan.use_local) semanticTopN = Number(ctx.cfg.semantic_top_n_wide || semanticTopN);
    ctx.state.semanticTopN = semanticTopN;
    plan.semantic_top_n = semanticTopN;
    return { data: { plan }, stats: { use_local: !!plan.use_local, semantic_top_n: semanticTopN }, counters: { use_local: plan.use_local ? 1 : 0 } };
  }
});
export { rankPlanStage };