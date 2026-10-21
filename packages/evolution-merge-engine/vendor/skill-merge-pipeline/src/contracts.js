"use strict";
// 跨组契约常量与类型声明（v1，冻结于 2026-10-17）
// 本文件只做声明/枚举，不含业务逻辑；契约变更须升版本并走 docs/contracts.md §0 流程。
const CONTRACT_VERSION = "v1";

const ExitCode = Object.freeze({ OK: 0, RUNTIME: 1, USAGE: 2 });

const DiagnosticCode = Object.freeze({
  USAGE: "USAGE", CONFIG: "CONFIG", MODEL_MISSING: "MODEL_MISSING",
  UNREADABLE: "UNREADABLE", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE",
  BUDGET: "BUDGET", PARTIAL: "PARTIAL", ALL_DOWN: "ALL_DOWN", INTERNAL: "INTERNAL"
});

const ReasonCode = Object.freeze({
  NO_KEY: "no-key", HTTP_ERROR: "http-error", TIMEOUT: "timeout",
  INVALID_RESPONSE: "invalid-response", ALL_DOWN: "all-down", PARTIAL_FILL: "partial-fill", UNKNOWN: "unknown"
});

/** @typedef {{code: string, where: string, detail?: string, retryable?: boolean}} Diagnostic */
/** @typedef {{data: *, stats: Object, warnings: Diagnostic[]}} StageResult */
/** @typedef {{id: string, requires?: string[], run: function(ctx: *, input: *): Promise<StageResult>}} Stage */
/** @typedef {{cfg: Object, log: function, clock: function, cleanup: function[], signal?: AbortSignal}} PipelineContext */
/** @typedef {{tier: string, degraded: boolean, reasonCode: string, attempts: Object[], cost: {ms: number, tokens: number}}} DegradeReport */
/** @typedef {{jaccard_summary: number|null, jaccard_body: number|null, body_cosine: number|null, summary_cosine: number|null}} Evidence */

// CLI 参数描述（C1）：G1.3 将由 schema 生成；此处先声明形状供消费方对齐
/** @typedef {{key: string, type: string, default: *, choices?: string[], min?: number, max?: number, cli?: boolean, doc: string, derived?: boolean}} OptionSpec */

export { CONTRACT_VERSION, ExitCode, DiagnosticCode, ReasonCode };