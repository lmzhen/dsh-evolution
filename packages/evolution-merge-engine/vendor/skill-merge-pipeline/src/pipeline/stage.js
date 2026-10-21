"use strict";
// C4 契约：Stage 协议（requires 顺序、自动计时、warnings→diagnostics、结果规范化）。
import { PipelineError } from "../errors.js";
import { DiagnosticCode } from "../contracts.js";
import { throwIfAborted } from "../net/signal.js";

function bad(msg) { return new PipelineError(msg, { code: DiagnosticCode.INVALID, where: "stage" }); }

function defineStage(spec) {
  const s = spec || {};
  if (!s.id || typeof s.id !== "string") throw bad("stage.id 必须是非空字符串");
  const requires = s.requires === undefined ? [] : s.requires;
  if (!Array.isArray(requires) || requires.some(r => typeof r !== "string")) throw bad("stage.requires 必须是字符串数组（" + s.id + "）");
  if (typeof s.run !== "function") throw bad("stage.run 必须是函数（" + s.id + "）");
  return Object.freeze({ id: s.id, requires: Object.freeze(requires.slice()), run: s.run });
}

async function runStage(stage, ctx, input) {
  const env = input || {};
  for (const dep of stage.requires) {
    if (!Object.prototype.hasOwnProperty.call(env, dep) || env[dep] === undefined) {
      throw bad("stage " + stage.id + " 缺少依赖: " + dep);
    }
  }
  throwIfAborted(ctx.signal);
  const t0 = performance.now();
  let result;
  try {
    result = await stage.run(ctx, env);
  } catch (err) {
    ctx.addTiming(stage.id, performance.now() - t0, { degraded: true });
    throw err;
  }
  throwIfAborted(ctx.signal);
  const ms = performance.now() - t0;
  const norm = {
    data: result ? result.data : undefined,
    stats: (result && result.stats) || {},
    warnings: (result && result.warnings) || [],
    counters: (result && result.counters) || {},
    degraded: !!(result && result.degraded)
  };
  for (const w of norm.warnings) ctx.record(w);
  ctx.addTiming(stage.id, ms, { counters: norm.counters, degraded: norm.degraded });
  return norm;
}

async function runStages(stages, ctx, input) {
  const list = Array.isArray(stages) ? stages : [];
  const seen = new Set();
  const out = {};
  const results = [];
  for (const stage of list) {
    if (!stage || typeof stage.id !== "string") throw bad("非法 stage");
    if (seen.has(stage.id)) throw bad("stage id 重复: " + stage.id);
    for (const dep of stage.requires || []) {
      if (!seen.has(dep)) throw bad("stage " + stage.id + " 的依赖 " + dep + " 未在此之前执行");
    }
    const env = Object.assign({}, input || {}, out);
    const res = await runStage(stage, ctx, env);
    results.push(Object.assign({ id: stage.id }, res));
    if (res.data !== undefined) out[stage.id] = res.data;
    seen.add(stage.id);
  }
  return { results, data: out };
}

export { defineStage, runStage, runStages };