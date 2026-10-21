"use strict";
import { defineStage } from "../pipeline/stage.js";
import * as candidates from "../screening/candidates.js";
const candidatesStage = defineStage({
  id: "candidates",
  requires: ["prefilter"],
  async run(ctx, env) {
    const [pairs, stats] = candidates.generateCandidates(env.prefilter.kept, ctx.cfg);
    return { data: { pairs }, stats, counters: { kept: env.prefilter.kept.length, pairs: pairs.size } };
  }
});
export { candidatesStage };