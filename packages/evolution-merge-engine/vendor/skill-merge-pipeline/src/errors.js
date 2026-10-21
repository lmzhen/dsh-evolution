"use strict";
// C3 契约实现：错误分类 + Diagnostic + 退出码映射 + 诊断收集器（v1.1）
import { DiagnosticCode, ExitCode } from "./contracts.js";

class AppError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code || DiagnosticCode.INTERNAL;
    this.exitCode = opts.exitCode !== undefined ? opts.exitCode : ExitCode.RUNTIME;
    this.where = opts.where || "";
    this.retryable = !!opts.retryable;
    if (opts.cause) this.cause = opts.cause;
  }
}

class UsageError extends AppError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: DiagnosticCode.USAGE, exitCode: ExitCode.USAGE }));
  }
}

class ConfigError extends AppError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: opts.code || DiagnosticCode.CONFIG, exitCode: ExitCode.USAGE }));
  }
}

class ModelMissingError extends ConfigError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: DiagnosticCode.MODEL_MISSING }));
  }
}

class PipelineError extends AppError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: opts.code || DiagnosticCode.INTERNAL, exitCode: opts.exitCode !== undefined ? opts.exitCode : ExitCode.RUNTIME }));
  }
}

class UnavailableError extends PipelineError {
  constructor(message, opts = {}) { super(message, Object.assign({}, opts, { code: DiagnosticCode.UNAVAILABLE, retryable: opts.retryable !== false })); }
}

class InvalidResponseError extends PipelineError {
  constructor(message, opts = {}) { super(message, Object.assign({}, opts, { code: DiagnosticCode.INVALID, retryable: opts.retryable !== false })); }
}

class BudgetError extends PipelineError {
  constructor(message, opts = {}) { super(message, Object.assign({}, opts, { code: DiagnosticCode.BUDGET })); }
}

class UnreadableError extends PipelineError {
  constructor(message, opts = {}) { super(message, Object.assign({}, opts, { code: DiagnosticCode.UNREADABLE })); }
}

class InvalidDataError extends PipelineError {
  constructor(message, opts = {}) { super(message, Object.assign({}, opts, { code: DiagnosticCode.INVALID })); }
}

function isAppError(err) { return err instanceof AppError; }

function toDiagnostic(err, info = {}) {
  if (isAppError(err)) {
    return { code: err.code, where: info.where || err.where || "", detail: err.message, retryable: err.retryable };
  }
  if (err && typeof err === "object") {
    return { code: DiagnosticCode.INTERNAL, where: info.where || "", detail: String(err.message || err), retryable: false };
  }
  return { code: DiagnosticCode.INTERNAL, where: info.where || "", detail: String(err), retryable: false };
}

function exitCodeOf(err) {
  if (isAppError(err)) return err.exitCode;
  return ExitCode.RUNTIME;
}

const HINTS = Object.freeze({
  USAGE: "运行 --help 查看参数；或检查参数值是否在 choices 范围内。",
  CONFIG: "检查配置文件/环境变量；缺失模型或凭据请先运行 doctor。",
  MODEL_MISSING: "运行 skill-merge models ensure 下载/构建，或 --models-dir 指向已有模型根目录。",
  UNREADABLE: "检查文件路径/权限；必要时重新生成产物。",
  UNAVAILABLE: "服务不可用；稍后重试或使用降级模式（如 --rank vec）。",
  INVALID: "返回内容非法；检查服务版本或重试。",
  BUDGET: "资源预算超限；减小 --max-table-mb 或使用 --stream-mode stream。",
  PARTIAL: "部分结果失败；检查 diagnostics 与降级原因。",
  ALL_DOWN: "所有候选通道不可用；检查模型/服务后重试。",
  INTERNAL: "内部错误；用 --debug 查看栈并保留日志。"
});

function formatError(err, opts) {
  const o = opts || {};
  const d = toDiagnostic(err);
  const hint = HINTS[d.code] || HINTS.INTERNAL;
  const lines = ["[" + d.code + "] " + d.detail + (d.where ? " (where=" + d.where + ")" : ""), "下一步：" + hint];
  if (o.debug && err && typeof err.stack === "string" && err.stack) lines.push(err.stack);
  return lines.join(nl());
}

function nl() { return String.fromCharCode(10); }

class Diagnostics {
  constructor() { this.items = []; }
  record(diag) { this.items.push(diag); return diag; }
  recordError(err, where) { return this.record(toDiagnostic(err, where ? { where } : {})); }
  hasErrors() { return this.items.some(d => d.code !== DiagnosticCode.PARTIAL); }
  countByCode() { const out = {}; for (const d of this.items) out[d.code] = (out[d.code] || 0) + 1; return out; }
}

export { AppError, UsageError, ConfigError, ModelMissingError, PipelineError, UnavailableError, InvalidResponseError, BudgetError, UnreadableError, InvalidDataError, isAppError, toDiagnostic, exitCodeOf, formatError, Diagnostics, HINTS };