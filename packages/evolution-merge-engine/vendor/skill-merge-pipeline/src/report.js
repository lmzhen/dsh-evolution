"use strict";
// C20 契约：report 终态（stages/timings/diagnostics/config 白名单/used_mode）+ 产物字节方言。
import path from "node:path";
import { CONFIG_FIELDS } from "./config/schema.js";
import { CONTRACT_VERSION } from "./contracts.js";
import { REPORT_SCHEMA_VERSION, assertReportModel } from "./contracts/report.js";
import { writeText, writeJson, writeCsv, resolveDialect } from "./io/write.js";
import { InvalidDataError } from "./errors.js";

const RUNTIME_ONLY_CONFIG_KEYS = Object.freeze(["rank_checkpoint", "judge_cache_path", "stub2_floors"]);
const RESERVED_TOP_KEYS = Object.freeze(["schemaVersion", "generatedAt", "command", "meta", "config", "stages", "timings", "diagnostics", "used_mode", "degraded", "pairs_final"]);
const CONFIG_KEYS = CONFIG_FIELDS.map(f => f.key);
const CANDIDATES_HEADER = Object.freeze(["a", "b", "verdict", "action", "level", "rank_score", "rank_rank", "reason"]);
const PAIRS_HEADER = Object.freeze(["a", "b", "via_summary", "via_body", "jaccard_summary", "jaccard_body", "cosine", "pass_semantic", "action", "target"]);

function cloneJson(v) { return JSON.parse(JSON.stringify(v)); }
function why(r) { const rn = r && r.reason; return typeof rn === "string" ? rn.replace(/\n/g, " ").slice(0, 160) : ""; }

function snapshotConfig(cfg) {
  const src = cfg || {};
  const out = {};
  for (const key of CONFIG_KEYS) {
    if (RUNTIME_ONLY_CONFIG_KEYS.includes(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    out[key] = cloneJson(src[key]);
  }
  return out;
}

function pruneUndefined(value) {
  if (Array.isArray(value)) return value.map(v => v === undefined ? null : pruneUndefined(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (value[k] === undefined) continue;
      out[k] = pruneUndefined(value[k]);
    }
    return out;
  }
  return value;
}

function assertJsonSafe(value, at) {
  const p = at || "$";
  if (value === undefined) throw new InvalidDataError("报告含 undefined: " + p, { where: "report" });
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new InvalidDataError("报告含不可序列化值 (" + typeof value + "): " + p, { where: "report" });
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new InvalidDataError("报告含非有限数值: " + p, { where: "report" });
  if (Array.isArray(value)) { value.forEach((v, i) => assertJsonSafe(v, p + "[" + i + "]")); return; }
  if (value && typeof value === "object") { for (const k of Object.keys(value)) assertJsonSafe(value[k], p + "." + k); }
}

function timingRows(stages) {
  return (stages || []).map(x => ({ id: x.id, ms: x.ms, counters: x.counters || {}, degraded: !!x.degraded }));
}

function timingsSummary(rows) {
  const by = {};
  let total = 0;
  for (const r of rows) { by[r.id] = r.ms; total += Number(r.ms) || 0; }
  return { total_ms: Math.round(total * 10) / 10, by_stage: by };
}

function buildReport(spec) {
  const s = spec || {};
  const ctx = s.ctx || null;
  const cfg = s.cfg !== undefined ? s.cfg : (ctx && ctx.cfg);
  const stageInput = s.stages !== undefined ? s.stages : (ctx && ctx.timings);
  const diagInput = s.diagnostics !== undefined ? s.diagnostics : (ctx && ctx.diagnostics && ctx.diagnostics.items);
  const stages = timingRows(stageInput);
  const sections = Object.assign({}, s.sections || {});
  const pairsFinal = Object.prototype.hasOwnProperty.call(sections, "pairs_final")
    ? sections.pairs_final
    : (s.pairsFinal || []);
  delete sections.pairs_final;
  for (const k of Object.keys(sections)) {
    if (RESERVED_TOP_KEYS.includes(k)) throw new InvalidDataError("report.sections 不得覆盖保留字段: " + k, { where: "report" });
  }
  const degraded = s.degraded !== undefined
    ? !!s.degraded
    : (stages.some(x => x.degraded === true) || !!(s.usedMode && s.usedMode.degraded === true));
  const report = Object.assign({
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: s.generatedAt === undefined ? null : s.generatedAt,
    command: s.command === undefined ? null : s.command,
    meta: Object.assign({ contractVersion: CONTRACT_VERSION, generator: "skill-merge-node" }, pruneUndefined(s.meta || {})),
    config: snapshotConfig(cfg),
    stages: stages,
    timings: timingsSummary(stages),
    diagnostics: pruneUndefined((diagInput || []).slice()),
    used_mode: pruneUndefined(s.usedMode || {}),
    degraded: degraded,
    pairs_final: pairsFinal
  }, sections);
  assertJsonSafe(report);
  assertReportModel(report);
  return report;
}

function stageData(res, id) { const s = (res.stages || []).find(x => x.id === id); return s ? s.data : {}; }
function stageStats(res, id) { const s = (res.stages || []).find(x => x.id === id); return s ? s.stats : {}; }

function buildScanReport(opts) {
  const o = opts || {};
  const res = o.res || {};
  const cfg = o.cfg || {};
  const preStats = stageStats(res, "prefilter");
  const candStats = stageStats(res, "candidates");
  const lexStats = stageStats(res, "lexical");
  const rankPlan = stageData(res, "rank_plan").plan;
  const semStats = stageStats(res, "semantic");
  const semScored = stageData(res, "semantic").scored || [];
  const rerankStats = stageStats(res, "rerank");
  const verdicts = (stageData(res, "judge").verdicts || []).slice();
  const judgeFallback = stageData(res, "judge").fallback || "";
  const judgeStats = stageStats(res, "judge");
  const dropped = stageData(res, "prefilter").dropped;
  const scored = stageData(res, "lexical").scored || [];
  if (judgeFallback) for (const r of verdicts) { r.unjudged = true; r.action = "UNJUDGED"; }
  const semByPair = new Map(semScored.map(r => [r.a_path + "\u0000" + r.b_path, r]));
  for (const r of verdicts) {
    const s = semByPair.get(r.a_path + "\u0000" + r.b_path);
    if (s) { r.cosine = s.cosine; r.body_cosine = s.body_core_cosine; r.summary_cosine = s.summary_cosine; }
  }
  const sections = {
    corpus: { roots: o.roots || [], skills: Array.isArray(o.skills) ? o.skills.length : 0 },
    boilerplate: o.bp || {}, stage1_prefilter: preStats, stage2_candidates: candStats, stage3_lexical: lexStats,
    stage4_semantic: semStats, stage4_5_rerank: Object.assign({ plan: rankPlan }, rerankStats),
    stage5_judge: { pairs: verdicts.length, mode: judgeStats.judge_mode || cfg.judge, fallback: judgeFallback, cascade: judgeStats },
    dropped_names: dropped, pairs_final: verdicts, pairs_all_scored: scored,
    degradation: o.degradation || { degraded: false, reason_code: null, reasons: [], attempts: [] },
  };
  if (o.ledgerAfter !== undefined) sections.stage2_candidates.ledger_after = o.ledgerAfter;
  const reportDoc = buildReport({
    cfg,
    stages: res.timings || [],
    diagnostics: res.diagnostics || [],
    command: o.command === undefined ? null : o.command,
    generatedAt: o.generatedAt === undefined ? null : o.generatedAt,
    usedMode: {
      embedder: semStats.embedder_used || (semStats.skipped ? "skipped" : "local"),
      rank: rerankStats.mode_used,
      judge: judgeStats.judge_mode || cfg.judge,
      degraded: !!(o.degradation && o.degradation.degraded),
      reasons: (o.degradation ? o.degradation.reasons : []) || [],
    },
    sections: pruneUndefined(sections),
  });
  return { reportDoc, sections, verdicts, rankPlan, rerankStats, judgeFallback, judgeStats, semStats, preStats, candStats, lexStats };
}

function resolveArtifactDialect(cfg) {
  const c = cfg || {};
  return (c.parity_bytes === true || c.io_dialect === "python") ? "python" : "native";
}

function candidatesMarkdown(o) {
  const spec = o || {};
  const rows = spec.rows || [];
  const rs = spec.rerankStats || {};
  const judgeFallback = spec.judgeFallback || "";
  const merges = rows.filter(r => r.verdict_id === 1);
  const unjudged = rows.filter(r => r.unjudged);
  const keeps = rows.filter(r => r.verdict_id === -1 && !r.unjudged);
  const lines = ["# 待合并候选清单", "",
    "- 精排: mode=" + rs.mode_requested + " used=" + rs.mode_used + " degraded=" + rs.degraded + " n=" + rs.n + " → 输出 " + rs.n_out + " 对",
    "- ⑤: " + (judgeFallback || "已判决"), ""];
  if (merges.length) {
    lines.push("## 建议合并（" + merges.length + " 对）", "", "| # | A | B | 精排分 | 层级 | 理由 |", "| --- | --- | --- | --- | --- | --- |");
    merges.sort((a, b) => (a.rank_rank || 999) - (b.rank_rank || 999));
    merges.forEach((r, i) => lines.push("| " + (i + 1) + " | " + r.a + " | " + r.b + " | " + r.rank_score + " | " + r.level + " | " + why(r) + " |"));
    lines.push("");
  }
  if (unjudged.length) {
    lines.push("## 待人工判断（未判决 " + unjudged.length + " 对）", "", "| # | A | B | 精排分 |", "| --- | --- | --- | --- |");
    unjudged.sort((a, b) => (Number(b.rank_score) || 0) - (Number(a.rank_score) || 0));
    unjudged.forEach((r, i) => lines.push("| " + (i + 1) + " | " + r.a + " | " + r.b + " | " + r.rank_score + " |"));
    lines.push("");
  }
  if (keeps.length) {
    lines.push("## 各自保留（" + keeps.length + " 对）", "");
    for (const r of keeps) lines.push("- " + r.a + " ↔ " + r.b + "（精排分 " + r.rank_score + "，" + r.level + "）");
    lines.push("");
  }
  if (rs.degraded) lines.push("> 降级说明: " + rs.reason, "");
  return lines.join("\n");
}

function candidatesCsvRows(rows) {
  return (rows || []).map(r => [r.a, r.b, r.verdict_id, r.action, r.level, r.rank_score, r.rank_rank, why(r)]);
}

function pairsCsvRows(verdicts) {
  return (verdicts || []).map(r => [r.a, r.b, r.via_summary, r.via_body, r.jaccard_summary, r.jaccard_body, r.cosine, r.pass_semantic, r.action, r.target]);
}

function artifactBanner(reportDoc) {
  const um = (reportDoc && reportDoc.used_mode) || {};
  const reasons = Array.isArray(um.reasons) ? um.reasons.map(x => (x && x.code) || String(x)).filter(Boolean) : [];
  if (!um.degraded && !reasons.length) return "";
  return "> 降级/启发式: " + (reasons.join(", ") || "degraded") + "\n\n";
}

function writeArtifacts(outDir, spec) {
  const s = spec || {};
  const cfg = s.cfg || {};
  const reportDoc = s.report || {};
  const dialect = resolveArtifactDialect(cfg);
  const d = resolveDialect(dialect);
  const views = {
    "candidates.md": { derived: true, source: "report.json" },
    "candidates.csv": { derived: true, source: "report.json" },
    "pairs.csv": { derived: true, source: "report.json" }
  };
  const runMeta = {
    schemaVersion: 1,
    command: reportDoc.command === undefined ? null : reportDoc.command,
    generatedAt: reportDoc.generatedAt === undefined ? null : reportDoc.generatedAt,
    config: reportDoc.config || s.config || {},
    degraded: reportDoc.degraded === true,
    authoritative: "report.json",
    views: views
  };
  writeJson(path.join(outDir, "run.meta.json"), runMeta, { eol: d.eol, sortKeys: d.sortKeys });
  writeJson(path.join(outDir, "report.json"), reportDoc, { eol: d.eol, sortKeys: d.sortKeys });
  writeText(path.join(outDir, "candidates.md"), artifactBanner(reportDoc) + (s.markdown || ""), { eol: d.eol });
  writeCsv(path.join(outDir, "candidates.csv"), { header: CANDIDATES_HEADER, rows: s.candidatesRows || [], dialect: d.csvDialect, eol: d.eol });
  writeCsv(path.join(outDir, "pairs.csv"), { header: PAIRS_HEADER, rows: s.pairsRows || [], dialect: d.csvDialect, eol: d.eol });
  return { dialect: dialect, eol: d.eol, sortKeys: d.sortKeys, files: ["run.meta.json", "report.json", "candidates.md", "candidates.csv", "pairs.csv"], views: views };
}

export { REPORT_SCHEMA_VERSION, RUNTIME_ONLY_CONFIG_KEYS, RESERVED_TOP_KEYS, CANDIDATES_HEADER, PAIRS_HEADER, snapshotConfig, pruneUndefined, assertJsonSafe, buildReport, buildScanReport, resolveArtifactDialect, candidatesMarkdown, candidatesCsvRows, pairsCsvRows, writeArtifacts };