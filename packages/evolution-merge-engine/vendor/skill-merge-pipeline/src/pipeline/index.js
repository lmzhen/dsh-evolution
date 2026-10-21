"use strict";
// C4 / G6.1：pipeline 编排骨架（stage 列表/timings/diagnostics/错误→退出码/progress；G2 provision hook 预留）。
import { createContext } from "./context.js";
import { runStages } from "./stage.js";
import { toDiagnostic, exitCodeOf } from "../errors.js";
import { defineStage } from "./stage.js";
import { runSemantic } from "../stages/semantic.js";
import { prefilterStage } from "../stages/prefilter.js";
import { candidatesStage } from "../stages/candidates.js";
import { lexicalStage } from "../stages/lexical.js";
import { rerankStage } from "../stages/rerank.js";
import { judgeStage } from "../stages/judge.js";

function semanticCfg(ctx) {
  const cfg = Object.assign({}, ctx.cfg);
  const dirs = ctx.state && ctx.state.modelDirs;
  if (dirs) {
    if (dirs.int8) cfg.embedder_model = dirs.int8;
    if (dirs.pca) cfg.embedder_model_last = dirs.pca;
  }
  if (ctx.state && ctx.state.semanticTopN !== undefined) cfg.semantic_top_n = ctx.state.semanticTopN;
  return cfg;
}

function makeSemanticStage() {
  return defineStage({
    id: "semantic",
    requires: ["prefilter", "lexical"],
    async run(ctx, env) {
      const byPath = new Map(env.prefilter.kept.map(s => [s.path, s]));
      const args = env.params && env.params.semanticArgs ? env.params.semanticArgs : {};
      const res = await runSemantic(env.lexical.passed, byPath, semanticCfg(ctx), { signal: ctx.signal });
      return { data: { selected: res.selected, scored: res.scored, byPath, floors_used: res.stats.floors_used || null }, stats: res.stats, counters: { pairs_in: res.stats.pairs_in || 0, selected: res.stats.selected || 0 }, degraded: res.stats.embedder_degraded === true };
    }
  });
}

function defaultStages() {
  return [prefilterStage, candidatesStage, lexicalStage, makeSemanticStage(), rerankStage, judgeStage];
}

function wrapProgress(stage, progress) {
  return {
    id: stage.id,
    requires: stage.requires || [],
    async run(ctx, env) {
      if (progress) progress({ phase: "stage-start", stage: stage.id });
      const res = await stage.run(ctx, env);
      if (progress) {
        const last = ctx.timings.length ? ctx.timings[ctx.timings.length - 1] : null;
        progress({ phase: "stage-done", stage: stage.id, ms: last ? last.ms : null });
      }
      return res;
    }
  };
}

async function runPipeline(options) {
  const o = options || {};
  const progress = typeof o.onProgress === "function" ? o.onProgress : null;
  const ctx = createContext({ cfg: o.cfg || {}, state: o.state, out: o.out || "", env: o.env, clock: o.clock, log: o.log, signal: o.signal });
  const stages = o.stages !== undefined ? (Array.isArray(o.stages) ? o.stages : []) : defaultStages();
  const input = o.input || {};
  let data = {};
  let results = [];
  let failure = null;
  try {
    if (progress) progress({ phase: "start", stages: stages.map(s => s.id) });
    if (typeof o.provision === "function") {
      if (progress) progress({ phase: "provision" });
      await o.provision(ctx);
    }
    const wrapped = stages.map(s => wrapProgress(s, progress));
    const res = await runStages(wrapped, ctx, input);
    data = res.data;
    results = res.results;
  } catch (err) {
    failure = err;
    ctx.recordError(err, "pipeline");
    if (progress) progress({ phase: "error", error: String(err && err.message ? err.message : err) });
  }
  const cleanup = ctx.dispose();
  const out = {
    ok: !failure,
    exitCode: failure ? exitCodeOf(failure) : 0,
    data: data,
    stages: results,
    timings: ctx.timings.slice(),
    diagnostics: ctx.diagnostics.items.slice(),
    diagnosticsSummary: ctx.diagnostics.countByCode(),
    cleanup: cleanup,
    cfg: ctx.cfg
  };
  if (failure) {
    out.error = failure;
    out.diagnostic = toDiagnostic(failure, { where: "pipeline" });
  }
  if (progress) progress({ phase: failure ? "failed" : "done", stages: results.map(r => r.id), exitCode: out.exitCode });
  return out;
}

function timingOf(result, id) {
  const hit = (result.timings || []).find(t => t.id === id);
  return hit ? hit.ms : null;
}

export { defaultStages, runPipeline, timingOf, exitCodeOf as exitCodeFor };