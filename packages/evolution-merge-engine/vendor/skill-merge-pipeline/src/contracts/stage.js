// C3：Stage/ctx v1 契约（形状与消费方校验；cfg 冻结/state/signal 的运行时落在 G2.2/G2.3）。
import { InvalidDataError } from "../errors.js";

const STAGE_CONTRACT_VERSION = 1;
const STAGE_RESULT_KEYS = Object.freeze(["data", "stats", "warnings", "counters", "degraded"]);
const CONTEXT_REQUIRED_KEYS = Object.freeze([
  "cfg", "state", "signal", "out", "env", "log", "clock", "timings",
  "cleanup", "diagnostics", "addTiming", "onCleanup", "record", "recordError", "dispose",
]);

function bad(message) { return new InvalidDataError(message, { where: "stage" }); }
function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function assertStageSpec(stage) {
  if (!isObject(stage)) throw bad("stage 必须是对象");
  if (typeof stage.id !== "string" || stage.id.trim() === "") throw bad("stage.id 必须是非空字符串");
  if (!Array.isArray(stage.requires) || stage.requires.some(r => typeof r !== "string")) throw bad("stage.requires 必须是字符串数组");
  if (typeof stage.run !== "function") throw bad("stage.run 必须是函数");
  return stage;
}

function assertStageResult(result) {
  if (!isObject(result)) throw bad("StageResult 必须是对象");
  for (const key of STAGE_RESULT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) throw bad("StageResult 缺少字段: " + key);
  }
  if (!isObject(result.stats)) throw bad("StageResult.stats 必须是对象");
  if (!Array.isArray(result.warnings)) throw bad("StageResult.warnings 必须是数组");
  if (!isObject(result.counters)) throw bad("StageResult.counters 必须是对象");
  if (typeof result.degraded !== "boolean") throw bad("StageResult.degraded 必须是 boolean");
  return result;
}

function assertContextShape(ctx) {
  if (!isObject(ctx)) throw bad("PipelineContext 必须是对象");
  for (const key of CONTEXT_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(ctx, key)) throw bad("PipelineContext 缺少字段: " + key);
  }
  if (!isObject(ctx.cfg)) throw bad("ctx.cfg 必须是对象");
  if (!isObject(ctx.state)) throw bad("ctx.state 必须是对象");
  if (ctx.signal !== null && ctx.signal !== undefined && typeof ctx.signal !== "object") throw bad("ctx.signal 必须是 AbortSignal/null");
  if (!Array.isArray(ctx.timings) || !Array.isArray(ctx.cleanup)) throw bad("ctx.timings/cleanup 必须是数组");
  return ctx;
}

export { STAGE_CONTRACT_VERSION, STAGE_RESULT_KEYS, CONTEXT_REQUIRED_KEYS, assertStageSpec, assertStageResult, assertContextShape };