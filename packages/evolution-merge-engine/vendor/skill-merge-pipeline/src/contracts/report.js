// C2：ReportModel v1 契约（唯一形状与消费方校验入口）。
import { InvalidDataError } from "../errors.js";

const REPORT_SCHEMA_VERSION = 1;
const REPORT_REQUIRED_TOP_KEYS = Object.freeze([
  "schemaVersion", "generatedAt", "command", "config", "stages",
  "timings", "diagnostics", "used_mode", "degraded", "pairs_final"
]);
const PAIR_REQUIRED_FIELDS = Object.freeze(["a", "b", "action", "verdict_id"]);

function bad(message) { return new InvalidDataError(message, { where: "report" }); }
function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function assertReportModel(report) {
  if (!isObject(report)) throw bad("report 必须是对象");
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) throw bad("report.schemaVersion 必须为 " + REPORT_SCHEMA_VERSION);
  for (const key of REPORT_REQUIRED_TOP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(report, key)) throw bad("report 缺少必需字段: " + key);
  }
  if (report.generatedAt !== null && typeof report.generatedAt !== "string") throw bad("report.generatedAt 必须是 ISO 字符串或 null");
  if (report.command !== null && typeof report.command !== "string") throw bad("report.command 必须是字符串或 null");
  if (!isObject(report.config)) throw bad("report.config 必须是对象");
  if (!Array.isArray(report.stages)) throw bad("report.stages 必须是数组");
  if (!isObject(report.timings)) throw bad("report.timings 必须是对象");
  if (!Array.isArray(report.diagnostics)) throw bad("report.diagnostics 必须是数组");
  if (!isObject(report.used_mode)) throw bad("report.used_mode 必须是对象");
  if (typeof report.degraded !== "boolean") throw bad("report.degraded 必须是 boolean");
  if (!Array.isArray(report.pairs_final)) throw bad("report.pairs_final 必须是数组");
  for (let i = 0; i < report.pairs_final.length; i += 1) {
    const row = report.pairs_final[i];
    if (!isObject(row)) throw bad("report.pairs_final[" + i + "] 必须是对象");
    for (const key of PAIR_REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) throw bad("report.pairs_final[" + i + "] 缺少字段: " + key);
    }
    if (typeof row.a !== "string" || typeof row.b !== "string") throw bad("report.pairs_final[" + i + "].a/b 必须是字符串");
    if (typeof row.action !== "string") throw bad("report.pairs_final[" + i + "].action 必须是字符串");
    if (!Number.isFinite(row.verdict_id)) throw bad("report.pairs_final[" + i + "].verdict_id 必须是数值");
  }
  return report;
}

export { REPORT_SCHEMA_VERSION, REPORT_REQUIRED_TOP_KEYS, PAIR_REQUIRED_FIELDS, assertReportModel };