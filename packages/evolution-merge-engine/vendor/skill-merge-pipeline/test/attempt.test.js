"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { classifyReason, attemptSequence, REASON_CODES } from "../src/attempt.js";
import { RemoteEmbedError } from "../src/embed/remote.js";

test("classifyReason：枚举映射", () => {
  const mk = (msg, extra) => Object.assign(new Error(msg), extra || {});
  assert.equal(classifyReason(mk("缺少 API key（env X）")), "no-key");
  assert.equal(classifyReason(mk("HTTP 429 too many")), "http-error");
  assert.equal(classifyReason(mk("请求失败", { name: "AbortError" })), "timeout");
  assert.equal(classifyReason(mk("条数不符: 3 != 2")), "invalid-response");
  assert.equal(classifyReason(mk("embedding 链全部不可用")), "all-down");
  assert.equal(classifyReason(mk("奇怪错误")), "unknown");
  const explicit = mk("x"); explicit.reasonCode = "partial-fill";
  assert.equal(classifyReason(explicit), "partial-fill");
  assert.deepEqual(REASON_CODES.slice(0, 3), ["no-key", "http-error", "timeout"]);
});

test("attemptSequence：build/infer 失败后降级成功 + reasonCode", async () => {
  const steps = [
    { tier: "a", build: () => { throw new Error("缺少 API key"); }, infer: () => "x" },
    { tier: "b", build: () => ({}), infer: () => { throw new Error("条数不符: 1 != 2"); } },
    { tier: "c", build: () => ({}), infer: () => "VALUE" }
  ];
  const res = await attemptSequence(steps);
  assert.equal(res.value, "VALUE");
  assert.equal(res.tier, "c");
  assert.equal(res.degraded, true);
  assert.equal(res.reasonCode, "invalid-response");
  assert.deepEqual(res.attempts.map(a => a.tier + ":" + a.phase + ":" + (a.ok ? "ok" : a.reasonCode)), ["a:build:no-key", "b:build:ok", "b:infer:invalid-response", "c:build:ok"]);
  assert.ok(res.cost.ms >= 0);
});

test("attemptSequence：单档成功无降级", async () => {
  const res = await attemptSequence([{ tier: "only", build: () => ({}), infer: () => 42 }]);
  assert.equal(res.value, 42);
  assert.equal(res.degraded, false);
  assert.equal(res.reasonCode, null);
});

test("attemptSequence：全失败 → reasonCode=all-down + attempts 完整", async () => {
  const steps = [
    { tier: "a", build: () => { throw new Error("缺少 API key"); }, infer: () => 1 },
    { tier: "b", build: () => { throw new Error("HTTP 500"); }, infer: () => 1 }
  ];
  await assert.rejects(attemptSequence(steps), err => {
    assert.equal(err instanceof RemoteEmbedError, true);
    assert.equal(err.reasonCode, "all-down");
    assert.equal(err.attempts.length, 2);
    assert.match(err.message, /全部不可用/);
    return true;
  });
  await assert.rejects(attemptSequence([]), /没有可用档位/);
});