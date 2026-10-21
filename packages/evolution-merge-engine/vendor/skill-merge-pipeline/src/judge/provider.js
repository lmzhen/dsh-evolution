"use strict";
// G5.3：Judge provider 契约（id/promptSha/heuristic/judge）；stub 不伪装 LLM。
import crypto from "node:crypto";
import { UnavailableError, InvalidDataError } from "../errors.js";
import { PROMPT_VERSION } from "./prompt.js";
import { STUB_VERSION, STUB2_VERSION, stubVerdict, stubVerdictV2 } from "./stub.js";
import { callDeepseek } from "./deepseek.js";
import { parseVerdict } from "./verdict.js";

function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
function providerId(mode, cfg) {
  if (mode === "deepseek") return "deepseek:" + String(cfg.judge_model || "deepseek-flash");
  return "stub:" + (mode === "stub2" ? STUB2_VERSION : STUB_VERSION);
}

function makeJudgeProvider(spec) {
  const s = spec || {};
  const provider = {
    id: String(s.id || ""),
    mode: String(s.mode || ""),
    promptSha: String(s.promptSha || ""),
    heuristic: !!s.heuristic,
    fallback: String(s.fallback || ""),
    judge: s.judge
  };
  return assertJudgeProvider(provider);
}

function assertJudgeProvider(provider) {
  if (!provider || typeof provider !== "object") throw new InvalidDataError("judge provider 必须是对象", { where: "judge-provider" });
  if (!provider.id) throw new InvalidDataError("judge provider 缺少 id", { where: "judge-provider" });
  if (typeof provider.promptSha !== "string" || !/^[0-9a-f]{64}$/.test(provider.promptSha)) throw new InvalidDataError("judge provider promptSha 非法: " + provider.id, { where: "judge-provider" });
  if (typeof provider.heuristic !== "boolean") throw new InvalidDataError("judge provider heuristic 必须是布尔: " + provider.id, { where: "judge-provider" });
  if (typeof provider.judge !== "function") throw new InvalidDataError("judge provider 缺少 judge(rows): " + provider.id, { where: "judge-provider" });
  return provider;
}

function resolveJudgeProvider(cfg, env) {
  const c = cfg || {};
  const e = env || process.env;
  const requested = String(c.judge || "stub");
  let mode = requested;
  let fallback = "";
  if (requested === "auto") {
    if (e && e.DEEPSEEK_API_KEY) mode = "deepseek";
    else { mode = "stub"; fallback = "未设 DEEPSEEK_API_KEY ⇒ ⑤ 退化为 stub，候选未判决"; }
  }
  if (!["stub", "stub2", "deepseek"].includes(mode)) throw new InvalidDataError("未知 judge provider: " + mode + "（可选: stub/stub2/deepseek/auto）", { where: "judge-provider" });
  const id = providerId(mode, c);
  const promptSha = sha256(PROMPT_VERSION + "|" + id);
  if (mode === "deepseek") {
    return makeJudgeProvider({ id, mode, promptSha, heuristic: false, fallback, judge: async (rows, ctx) => {
      const runner = ctx && ctx.runner;
      if (typeof runner !== "function") throw new UnavailableError("deepseek judge 需要 ctx.runner(prompt,cfg)", { where: "judge-provider" });
      const out = [];
      for (const r of rows || []) out.push(parseVerdict(await runner(String(r.prompt || ""), (ctx && ctx.cfg) || c)));
      return out;
    } });
  }
  const stubFn = mode === "stub2" ? (level, ev) => stubVerdictV2(level, ev, c.stub2_floors || {}) : stubVerdict;
  return makeJudgeProvider({ id, mode, promptSha, heuristic: true, fallback, judge: async (rows) => (rows || []).map(r => stubFn(r.level, r.evidence || {})) });
}

export { makeJudgeProvider, assertJudgeProvider, resolveJudgeProvider };