"use strict";
// 公共 API：只再导出稳定入口，不在这里执行 CLI/读模型。
export { runPipeline, defaultStages, timingOf } from "./pipeline/index.js";
export { runScan, formatScanSummary } from "./scan.js";
export { prefilter, nameEntropy, generateCandidates, lexicalGate, semanticSelect } from "./screening/index.js";
export { planMerges } from "./merge/index.js";
export { makeConfig, DEFAULTS } from "./config.js";
export { parseCli, formatHelp } from "./cli.js";
export { CONTRACT_VERSION, ExitCode, DiagnosticCode, ReasonCode } from "./contracts.js";
export { REPORT_SCHEMA_VERSION, assertReportModel } from "./contracts/report.js";
export { STAGE_CONTRACT_VERSION, STAGE_RESULT_KEYS, CONTEXT_REQUIRED_KEYS, assertStageSpec, assertStageResult, assertContextShape } from "./contracts/stage.js";
export {
  MERGE_SCHEMA_VERSION, RELATIONS, MODES, EXECUTORS, NOMINATION_MODES, DISPOSITIONS, NAME_RE,
  emptyPlan, validateMergeDecision, validateMergePlanShape, unsafePath,
} from "./contracts/merge.js";