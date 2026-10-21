"use strict";
// G6.4：merge 计划的人读摘要（纯函数、确定性，无时间戳）。
import path from "node:path";

function pairLine(p) {
  if (p.skipped) return "SKIP " + (p.notes || []).join(";");
  return String(p.relation || "?") + "/" + String(p.executor || "?") + " [" + String(p.source || "?") + "] validate=" + (p.validate_ok ? "OK" : JSON.stringify(p.problems || []).slice(0, 160));
}

function renderSummaryLines(summary) {
  const s = summary || {};
  const lines = ["报告: " + String(s.report || "(inline report)"), "语料: " + ((s.corpus_roots || []).join(", ") || "(caller snapshot)"), "模型: " + String(s.model || "?") + "（LLM " + (s.llm_available ? "可用" : "不可用/已禁用") + "）", "MERGE 对: " + (Number(s.planned || 0) + Number(s.skipped || 0)) + " | 产出计划: " + Number(s.planned || 0) + " | 跳过: " + Number(s.skipped || 0) + " | fallback: " + Number(s.fallback || 0) + " | 计划校验失败: " + Number(s.validation_failed || 0)];
  for (const p of s.pairs || []) lines.push("  " + p.a + " <> " + p.b + " → " + pairLine(p));
  const u = s.usage || {};
  lines.push("LLM usage: calls=" + Number(u.calls || 0) + " prompt=" + Number(u.prompt_tokens || 0) + " completion=" + Number(u.completion_tokens || 0) + " cost=" + Number(u.cost_cny || 0) + " CNY");
  return lines;
}

function renderSummaryMarkdown(summary) {
  const s = summary || {};
  const lines = ["# Merge Plan Summary", "", "## 输入", "", "- report: " + String(s.report || "(inline report)"), "- corpus: " + ((s.corpus_roots || []).join(", ") || "(caller snapshot)"), "- model: " + String(s.model || "?") + "（LLM " + (s.llm_available ? "可用" : "不可用/已禁用") + "）", "", "## 汇总", ""];
  lines.push("- MERGE 对: " + (Number(s.planned || 0) + Number(s.skipped || 0)));
  lines.push("- 产出计划: " + Number(s.planned || 0));
  lines.push("- 跳过: " + Number(s.skipped || 0));
  lines.push("- fallback: " + Number(s.fallback || 0));
  lines.push("- 计划校验失败: " + Number(s.validation_failed || 0));
  const u = s.usage || {};
  lines.push("- LLM usage: calls=" + Number(u.calls || 0) + " prompt=" + Number(u.prompt_tokens || 0) + " completion=" + Number(u.completion_tokens || 0) + " cost=" + Number(u.cost_cny || 0) + " CNY");
  lines.push("", "## 逐对", "");
  for (const p of s.pairs || []) {
    lines.push("### " + p.a + " ↔ " + p.b, "");
    if (p.skipped) { lines.push("- 跳过: " + ((p.notes || []).join(";") || "语料缺失"), ""); continue; }
    lines.push("- relation: " + String(p.relation || "?"));
    lines.push("- mode: " + String(p.mode || "?"));
    lines.push("- executor: " + String(p.executor || "?"));
    lines.push("- source: " + String(p.source || "?"));
    if (p.target) lines.push("- target: " + String(p.target));
    if (Array.isArray(p.sources) && p.sources.length) lines.push("- sources: " + p.sources.join(", "));
    if (p.rationale) lines.push("- rationale: " + String(p.rationale).slice(0, 300));
    lines.push("- validate: " + (p.validate_ok ? "OK" : JSON.stringify(p.problems || []).slice(0, 300)));
    lines.push("- plan: " + path.basename(String(p.file || "")), "");
  }
  return lines.join("\n") + "\n";
}

export { renderSummaryLines, renderSummaryMarkdown };