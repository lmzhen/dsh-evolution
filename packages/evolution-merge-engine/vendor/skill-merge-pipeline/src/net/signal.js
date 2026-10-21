"use strict";
// G2.3：统一的取消/超时信号工具。
function abortError(message) {
  const e = new Error(message || "操作已取消");
  e.name = "AbortError";
  return e;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError("操作已取消");
}

function withTimeout(signal, ms) {
  const timeout = Number(ms);
  const timeoutSignal = Number.isFinite(timeout) && timeout > 0 ? AbortSignal.timeout(timeout) : null;
  if (!signal) return timeoutSignal || undefined;
  if (!timeoutSignal) return signal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeoutSignal]);
  return timeoutSignal;
}

export { abortError, throwIfAborted, withTimeout };