"use strict";
// C6：Attempt/Degrade 引擎（sequence；partial/route 由 G5 复用同一记录形状）。
import { RemoteEmbedError } from "./embed/remote.js";

const REASON_CODES = Object.freeze(["no-key", "http-error", "timeout", "invalid-response", "all-down", "partial-fill", "unknown"]);

function classifyReason(err) {
  if (err && typeof err.reasonCode === "string" && REASON_CODES.includes(err.reasonCode)) return err.reasonCode;
  const msg = String((err && err.message) || err || "");
  if (err && err.name === "AbortError") return "timeout";
  if (/timeout|timed out|aborted|ETIMEDOUT|超时/i.test(msg)) return "timeout";
  if (/缺少 API key|api key|未设.+KEY|key 缺失|未找到 key/i.test(msg)) return "no-key";
  if (/HTTP \d+|status [45]\d\d|429|5\d\d/.test(msg)) return "http-error";
  if (/条数不符|非法|invalid|缺少.+概率|no completion/i.test(msg)) return "invalid-response";
  if (/全部不可用|全部失败|all-down/i.test(msg)) return "all-down";
  return "unknown";
}

function errText(err) { return String((err && err.message) || err || "").slice(0, 160); }

async function attemptSequence(steps) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) {
    const e = new RemoteEmbedError("attempt: 没有可用档位");
    e.reasonCode = "all-down"; e.attempts = [];
    throw e;
  }
  const attempts = [];
  const failed = new Set();
  const t0 = Date.now();
  let lastReason = null;
  for (;;) {
    const step = list.find(s => !failed.has(s.tier));
    if (!step) break;
    const b0 = Date.now();
    let inst;
    try { inst = await step.build(); } catch (err) {
      failed.add(step.tier);
      const rc = classifyReason(err); lastReason = rc;
      attempts.push({ tier: step.tier, phase: "build", ok: false, reasonCode: rc, error: errText(err), ms: Date.now() - b0 });
      continue;
    }
    attempts.push({ tier: step.tier, phase: "build", ok: true, ms: Date.now() - b0 });
    const i0 = Date.now();
    try {
      const value = await step.infer(inst);
      const degraded = attempts.some(a => !a.ok);
      return { value, tier: step.tier, attempts, degraded, reasonCode: degraded ? lastReason : null, cost: { ms: Date.now() - t0 }, instance: inst };
    } catch (err) {
      failed.add(step.tier);
      const rc = classifyReason(err); lastReason = rc;
      attempts.push({ tier: step.tier, phase: "infer", ok: false, reasonCode: rc, error: errText(err), ms: Date.now() - i0 });
    }
  }
  const e = new RemoteEmbedError("embedding 链全部不可用: " + JSON.stringify(attempts).slice(0, 300));
  e.reasonCode = "all-down"; e.attempts = attempts;
  throw e;
}

async function attemptPartial(items, steps) {
  const list = Array.isArray(steps) ? steps : [];
  const results = [];
  const attempts = [];
  for (const item of items) {
    let done = false;
    for (const step of list) {
      try {
        const value = await step.run(item);
        attempts.push({ tier: step.tier, phase: "run", ok: true });
        results.push({ item, tier: step.tier, ok: true, value });
        done = true;
        break;
      } catch (err) {
        const rc = classifyReason(err);
        attempts.push({ tier: step.tier, phase: "run", ok: false, reasonCode: rc, error: errText(err) });
      }
    }
    if (!done) results.push({ item, ok: false });
  }
  const degraded = attempts.some(x => !x.ok);
  return { results, failed: results.filter(x => !x.ok).map(x => x.item), attempts, degraded, reasonCode: degraded ? "partial-fill" : null };
}

function buildDegradeReport(res) {
  return { tier: res.tier, attempts: res.attempts, degraded: !!res.degraded, reasonCode: res.reasonCode || null, cost: res.cost || { ms: 0 } };
}

export { REASON_CODES, classifyReason, attemptSequence, attemptPartial, buildDegradeReport };