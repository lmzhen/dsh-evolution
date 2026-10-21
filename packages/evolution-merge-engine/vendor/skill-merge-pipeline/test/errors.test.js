"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { DiagnosticCode, ExitCode } from "../src/contracts.js";
import {
  AppError, UsageError, ConfigError, ModelMissingError, PipelineError,
  UnavailableError, InvalidResponseError, BudgetError,
  isAppError, toDiagnostic, exitCodeOf, formatError, Diagnostics
} from "../src/errors.js";
import { findEmptyCatches, findProcessExit, allowsProcessExit } from "../src/arch-rules.js";

test("AppError 默认 code=INTERNAL / exit=1", () => {
  const e = new AppError("boom");
  assert.equal(e.code, DiagnosticCode.INTERNAL);
  assert.equal(e.exitCode, ExitCode.RUNTIME);
  assert.equal(e.retryable, false);
});

test("用法/配置类错误映射 exit 2（3 类）", () => {
  assert.equal(exitCodeOf(new UsageError("bad arg")), ExitCode.USAGE);
  assert.equal(exitCodeOf(new ConfigError("bad cfg")), ExitCode.USAGE);
  assert.equal(exitCodeOf(new ModelMissingError("missing model")), ExitCode.USAGE);
  assert.equal(new UsageError("x").code, DiagnosticCode.USAGE);
  assert.equal(new ConfigError("x").code, DiagnosticCode.CONFIG);
  assert.equal(new ModelMissingError("x").code, DiagnosticCode.MODEL_MISSING);
});

test("运行期错误映射 exit 1", () => {
  assert.equal(exitCodeOf(new PipelineError("runtime")), ExitCode.RUNTIME);
  assert.equal(exitCodeOf(new UnavailableError("down")), ExitCode.RUNTIME);
  assert.equal(exitCodeOf(new InvalidResponseError("bad json")), ExitCode.RUNTIME);
  assert.equal(exitCodeOf(new BudgetError("too big")), ExitCode.RUNTIME);
  assert.equal(new UnavailableError("x").retryable, true);
  assert.equal(new InvalidResponseError("x").retryable, true);
});

test("未知错误兜底：INTERNAL + exit 1", () => {
  const e = new Error("mystery");
  assert.equal(isAppError(e), false);
  assert.equal(exitCodeOf(e), ExitCode.RUNTIME);
  assert.deepEqual(toDiagnostic(e, { where: "stage4" }), {
    code: DiagnosticCode.INTERNAL, where: "stage4", detail: "mystery", retryable: false
  });
});

test("toDiagnostic 保留 AppError 语义", () => {
  const e = new UnavailableError("svc down", { where: "embed", retryable: true });
  const d = toDiagnostic(e);
  assert.equal(d.code, DiagnosticCode.UNAVAILABLE);
  assert.equal(d.retryable, true);
  assert.equal(d.where, "embed");
});

test("formatError 两行制：含 code/下一步；默认无栈，--debug 才显示", () => {
  const e = new UsageError("未知参数: --foo", { where: "cli" });
  const s = formatError(e);
  assert.match(s, /\[USAGE\]/);
  assert.match(s, /where=cli/);
  assert.match(s, /下一步：/);
  assert.equal(s.includes("at "), false, "不应包含栈帧");
  const runtime = formatError(new PipelineError("boom", { where: "stage5" }));
  assert.match(runtime, /下一步：/);
  assert.equal(runtime.includes("at "), false);
  assert.match(formatError(e, { debug: true }), /at /);
});

test("Diagnostics 收集/计数/hasErrors（PARTIAL 不算错误）", () => {
  const d = new Diagnostics();
  d.record({ code: DiagnosticCode.PARTIAL, where: "rerank", detail: "1 pair failed", retryable: true });
  d.recordError(new UnavailableError("down"), "embed");
  assert.equal(d.items.length, 2);
  assert.deepEqual(d.countByCode(), { PARTIAL: 1, UNAVAILABLE: 1 });
  assert.equal(d.hasErrors(), true);
  const clean = new Diagnostics();
  clean.record({ code: DiagnosticCode.PARTIAL, where: "x", detail: "y" });
  assert.equal(clean.hasErrors(), false);
});

test("ARCH 草稿：空 catch 与 process.exit 可扫描", () => {
  const src = "try { f(); } catch (e) {}" + String.fromCharCode(10) + "try { g(); } catch (e) { throw e; }";
  assert.equal(findEmptyCatches(src).length, 1);
  assert.equal(findProcessExit("process.exit(2);").length, 1);
  assert.equal(allowsProcessExit("src/cli.js"), true);
  assert.equal(allowsProcessExit("src/run.js"), false);
});

test("契约 v1.1 增量：INTERNAL 存在且不影响旧枚举", () => {
  assert.equal(DiagnosticCode.INTERNAL, "INTERNAL");
  assert.equal(DiagnosticCode.USAGE, "USAGE");
});