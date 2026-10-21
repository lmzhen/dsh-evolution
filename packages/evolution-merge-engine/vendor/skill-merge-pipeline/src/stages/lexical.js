"use strict";
import { defineStage } from "../pipeline/stage.js";
import * as lexical from "../screening/lexical.js";
const lexicalStage = defineStage({
  id: "lexical",
  requires: ["prefilter", "candidates"],
  async run(ctx, env) {
    const [passed, scored, stats] = lexical.lexicalGate(env.prefilter.kept, env.candidates.pairs, ctx.cfg);
    return { data: { passed, scored }, stats, counters: { pairs: env.candidates.pairs.size, passed: passed.length, scored: scored.length } };
  }
});
export { lexicalStage };