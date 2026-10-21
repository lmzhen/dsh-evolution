// G9：S0–S2 编排：从既有 ⑤ 报告 + 语料生成 MergePlan（默认不落盘合并，只产计划）。
import path from "node:path";
import { readJson } from "../io/read.js";
import { writeJson, writeText } from "../io/write.js";
import { ensureDir } from "../io/bytes.js";
import { assertReportModel } from "../contracts/report.js";
import { InvalidDataError } from "../errors.js";
import { buildCard, loadCorpusSkills } from "./card.js";
import { classifyMerge } from "./classify.js";
import { planMerge } from "./plan.js";
import { createLlm } from "./llm.js";
import { MERGE_SCHEMA_VERSION, validatePlan } from "./schema.js";
import { renderSummaryMarkdown } from "./summary.js";

function safeName(s) { return String(s || "?").replace(/[^a-z0-9_-]+/gi, "_"); }

function relToRoots(p, roots) {
  const abs = path.resolve(p);
  for (const root of roots) {
    const rel = path.relative(path.resolve(root), abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  }
  return path.basename(abs);
}

function sanitizeCard(card, roots) {
  const clone = JSON.parse(JSON.stringify(card));
  for (const side of ["a", "b"]) {
    const s = clone.skills && clone.skills[side];
    if (s && typeof s.path === "string") s.path = relToRoots(s.path, roots);
  }
  return clone;
}

export function mergePairsOf(report) {
  assertReportModel(report);
  const rows = report.pairs_final;
  return rows.filter(p => p && (p.verdict_id === 1 || String(p.action || "").toUpperCase() === "MERGE"));
}

export async function planMerges(opts) {
  const o = opts || {};
  const report = o.report || readJson(o.reportPath);
  assertReportModel(report);
  const pairs = mergePairsOf(report).slice(0, Number(o.limit) > 0 ? Number(o.limit) : undefined);
  const roots = Array.isArray(o.corpusRoots) ? o.corpusRoots.filter(r => typeof r === "string" && r.trim()) : [];
  let byName;
  if (o.corpusSkills && typeof o.corpusSkills.get === "function") byName = o.corpusSkills;
  else {
    if (!roots.length) throw new InvalidDataError("planMerges 需要 caller 传入 corpusRoots 或 corpusSkills 快照（不再从 report 递归猜路径）", { where: "merge" });
    byName = loadCorpusSkills(roots, o.cfg);
  }
  const baseDir = o.reportPath ? path.dirname(path.resolve(o.reportPath)) : process.cwd();
  const outDir = o.outDir || path.join(baseDir, "merge_plans");
  ensureDir(outDir);
  const llm = o.llm || createLlm({ cfg: o.cfg, noLlm: o.noLlm, model: o.model, credentialsPath: o.credentialsPath });
  const summary = { schemaVersion: MERGE_SCHEMA_VERSION, report: o.reportPath ? path.resolve(o.reportPath) : null, corpus_roots: roots.slice(), model: llm.model, llm_available: !!llm.available, pairs: [], planned: 0, skipped: 0, fallback: 0, validation_failed: 0, usage: null };
  for (const pair of pairs) {
    const card = buildCard(pair, byName);
    if (!card.compat.both_found) { summary.skipped += 1; summary.pairs.push({ a: pair.a, b: pair.b, skipped: true, notes: card.notes }); continue; }
    const s1 = await classifyMerge(card, llm);
    const s2 = await planMerge(card, s1.result, llm);
    const problems = validatePlan(s2.plan, card);
    const file = safeName(pair.a) + "__" + safeName(pair.b) + ".json";
    writeJson(path.join(outDir, file), { card: sanitizeCard(card, roots), s1: { source: s1.source, result: s1.result, raw: s1.raw || null }, plan: s2.plan, validate: { ok: problems.length === 0, problems }, source: s2.source, error: s2.error || null }, { indent: 2 });
    summary.planned += 1;
    if (String(s2.source).startsWith("fallback")) summary.fallback += 1;
    if (problems.length) summary.validation_failed += 1;
    summary.pairs.push({ a: pair.a, b: pair.b, file: path.join(outDir, file), relation: s2.plan.relation, mode: s2.plan.mode, executor: s2.plan.executor, target: s2.plan.nomination && s2.plan.nomination.target, sources: s2.plan.nomination && s2.plan.nomination.sources, rationale: s2.plan.rationale, source: s2.source, fallback: String(s2.source).startsWith("fallback"), validate_ok: problems.length === 0, problems });
  }
  summary.usage = { calls: llm.usage.calls, prompt_tokens: llm.usage.prompt_tokens, completion_tokens: llm.usage.completion_tokens, cost_cny: Math.round(llm.usage.cost_cny * 1e6) / 1e6 };
  summary.summary_md = path.join(outDir, "summary.md");
  writeJson(path.join(outDir, "summary.json"), summary, { indent: 2 });
  writeText(summary.summary_md, renderSummaryMarkdown(summary), { eol: "lf" });
  return summary;
}