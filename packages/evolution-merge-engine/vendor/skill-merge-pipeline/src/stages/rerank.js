"use strict";
import { defineStage } from "../pipeline/stage.js";
import * as rerank from "../rerank/index.js";
const rerankStage = defineStage({
  id: "rerank",
  requires: ["semantic"],
  async run(ctx, env) {
    const [ranked, stats] = await rerank.rerank(env.semantic.selected, env.semantic.byPath, ctx.cfg, { signal: ctx.signal });
    return { data: { ranked }, stats, counters: { n_in: stats.n_in, n_out: stats.n_out }, degraded: stats.degraded === true };
  }
});
export { rerankStage };