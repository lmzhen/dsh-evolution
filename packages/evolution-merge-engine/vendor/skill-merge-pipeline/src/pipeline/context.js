"use strict";
// C4 契约：ctx 生命周期（timings/diagnostics/cleanup LIFO/signal）。
import { Diagnostics, PipelineError } from "../errors.js";
import { DiagnosticCode } from "../contracts.js";

function round1(n) { return Math.round(Number(n) * 10) / 10; }

function createContext(options) {
  const o = options || {};
  const diagnostics = new Diagnostics();
  const cleanup = [];
  const timings = [];
  let disposed = false;
  const ctx = {
    cfg: Object.freeze(o.cfg || {}),
    state: o.state || {},
    out: o.out || "",
    argv: o.argv || [],
    env: o.env || process.env,
    log: o.log || ((...args) => console.log(...args)),
    clock: o.clock || (() => Date.now()),
    signal: o.signal || null,
    timings,
    cleanup,
    diagnostics,
    data: {},
    addTiming(stageId, ms, extra) {
      const e = { id: String(stageId), ms: round1(ms), counters: (extra && extra.counters) || {}, degraded: !!(extra && extra.degraded) };
      timings.push(e);
      return e;
    },
    onCleanup(fn) {
      if (typeof fn !== "function") throw new PipelineError("cleanup 必须是函数", { code: DiagnosticCode.INVALID, where: "context" });
      cleanup.push(fn);
      return () => { const i = cleanup.indexOf(fn); if (i >= 0) cleanup.splice(i, 1); };
    },
    record(diag) { return diagnostics.record(diag); },
    recordError(err, where) { return diagnostics.recordError(err, where); },
    dispose() {
      if (disposed) return { executed: 0, failed: 0, skipped: true };
      disposed = true;
      let executed = 0;
      let failed = 0;
      while (cleanup.length) {
        const fn = cleanup.pop();
        try { fn(); executed += 1; } catch (err) { failed += 1; diagnostics.recordError(err, "cleanup"); }
      }
      return { executed, failed };
    }
  };
  return ctx;
}

async function runWithContext(ctx, fn) {
  try {
    const value = await fn(ctx);
    return { value, ctx };
  } finally {
    ctx.dispose();
  }
}

export { createContext, runWithContext };