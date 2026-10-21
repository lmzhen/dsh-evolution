"use strict";
import { defineStage } from "../pipeline/stage.js";
import { PipelineError } from "../errors.js";
import { DiagnosticCode } from "../contracts.js";
import * as prefilter from "../screening/prefilter.js";
const prefilterStage = defineStage({
  id: "prefilter",
  requires: [],
  async run(ctx, env) {
    if (!Array.isArray(env.skills)) throw new PipelineError("prefilter 需要 input.skills", { code: DiagnosticCode.INVALID, where: "pipeline" });
    const [kept, dropped, stats] = prefilter.prefilter(env.skills, ctx.cfg);
    return { data: { kept, dropped }, stats, counters: { skills: env.skills.length, kept: kept.length, dropped: dropped.length } };
  }
});
export { prefilterStage };