"use strict";
// G5.2：可取消的指数退避重试（仅用于 429/5xx/timeout/网络类错误）。
import { throwIfAborted, abortError } from "./signal.js";

function retryableReason(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/HTTP (429|5\d\d)\b/.test(msg)) return true;
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed/i.test(msg)) return true;
  return false;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError("操作已取消")); return; }
    const timer = setTimeout(() => { cleanup(); resolve(); }, Math.max(0, Number(ms) || 0));
    const onAbort = () => { cleanup(); reject(abortError("操作已取消")); };
    function cleanup() { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function withRetry(fn, opts) {
  const o = opts || {};
  const retries = Math.max(0, Math.min(5, Number(o.retries) || 0));
  const baseMs = Math.max(0, Number(o.baseMs) || 0);
  const isRetryable = typeof o.isRetryable === "function" ? o.isRetryable : retryableReason;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(o.signal);
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (o.signal && o.signal.aborted) throw err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      if (o.onRetry) o.onRetry(attempt + 1, err);
      await sleep(baseMs * Math.pow(2, attempt), o.signal);
    }
  }
  throw lastErr;
}

export { retryableReason, sleep, withRetry };