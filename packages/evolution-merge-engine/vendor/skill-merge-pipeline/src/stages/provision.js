"use strict";
import { defineStage } from "../pipeline/stage.js";
import { supplyLocalModels } from "../models/supply.js";
const provisionStage = defineStage({
  id: "provision",
  requires: ["lexical"],
  async run(ctx, env) {
    const supply = await supplyLocalModels({ cfg: ctx.cfg, runtime: ctx.state });
    ctx.state.modelDirs = supply.dirs;
    return {
      data: { supply },
      stats: {
        managed: supply.managed, skipped: supply.skipped,
        downloaded: supply.downloaded.length, built: supply.built.length, verified: supply.verified.length
      },
      counters: { downloaded: supply.downloaded.length, built: supply.built.length }
    };
  }
});
export { provisionStage };