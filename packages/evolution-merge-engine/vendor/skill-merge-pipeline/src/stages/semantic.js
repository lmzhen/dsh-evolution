"use strict";
// G4.6：④ semantic stage（算法仍由 semantic.semanticSelect 提供；G6.1 再内联 stage 编排）。
import { defineStage } from "../pipeline/stage.js";
import * as semantic from "../screening/semantic.js";

async function runSemantic(passed, byPath, cfg, opts) {
  if (cfg.skip_stage4) {
    const stats = { skipped: true, pairs_in: passed.length, selected: passed.length };
    return { selected: passed, scored: passed, stats };
  }
  const [selected, scored, stats] = await semantic.semanticSelect(passed, byPath, cfg, opts);
  return { selected, scored, stats };
}

const semanticStage = defineStage({
  id: "semantic",
  requires: ["passed", "byPath"],
  async run(ctx, env) {
    const { selected, scored, stats } = await runSemantic(env.passed, env.byPath, ctx.cfg, { signal: ctx.signal });
    return {
      data: { selected, scored },
      stats,
      counters: { pairs_in: Number(stats.pairs_in || 0), selected: Number(stats.selected || 0) },
      degraded: stats.embedder_degraded === true
    };
  }
});

export { runSemantic, semanticStage };