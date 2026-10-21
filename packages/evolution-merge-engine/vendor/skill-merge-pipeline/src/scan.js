"use strict";
// G2.1：高层 scan 编排（无 CLI/process/console）。
import path from "node:path";
import { ensureDir } from "./io/bytes.js";
import * as corpus from "./corpus.js";
import { runPipeline } from "./pipeline/index.js";
import { buildScanStages } from "./pipeline/compose.js";
import * as ledger from "./ledger.js";
import * as report from "./report.js";
import { assessDegradation } from "./degrade.js";

function stageData(res, id) { const s = res.stages.find(x => x.id === id); return s ? s.data : {}; }
function stageStats(res, id) { const s = res.stages.find(x => x.id === id); return s ? s.stats : {}; }

export async function runScan(opts) {
  const o = opts || {};
  const cfg = o.cfg;
  const roots = o.corpus || [];
  const out = o.out || "";
  if (!cfg) throw new Error("runScan 缺少 cfg");
  ensureDir(out);
  const [skills] = corpus.loadCorpus(roots);
  const bp = corpus.stripBoilerplate(skills, cfg);
  cfg.rank_checkpoint = path.join(out, "rank_scores.json");
  if (cfg.judge_cache && !cfg.judge_cache_path) cfg.judge_cache_path = path.join(out, "judge_cache.json");
  const res = await runPipeline({
    cfg, out, stages: buildScanStages(), input: { skills }, signal: o.signal,
    onProgress: typeof o.onProgress === "function" ? o.onProgress : undefined,
  });
  if (!res.ok) return { ok: false, res, cfg, skills, bp, error: res.error, exitCode: res.exitCode };

  const degradation = assessDegradation({ res, cfg });
  const pairs = stageData(res, "candidates").pairs;
  let ledgerAfter;
  if (cfg.ledger_path) {
    const allPairs = [...pairs.keys()].map(k => k.split("\u0000"));
    ledger.mark(cfg.ledger_path, allPairs, { run_out: out });
    ledgerAfter = Object.keys(ledger.load(cfg.ledger_path)).length;
  }
  const built = report.buildScanReport({
    cfg, res, roots, skills, bp, ledgerAfter, degradation,
    command: o.command === undefined ? null : o.command,
    generatedAt: o.generatedAt === undefined ? null : o.generatedAt,
  });
  report.writeArtifacts(out, {
    cfg, config: cfg, report: built.reportDoc,
    markdown: report.candidatesMarkdown({ rows: built.verdicts, rerankStats: built.rerankStats, rankPlan: built.rankPlan, judgeFallback: built.judgeFallback }),
    candidatesRows: report.candidatesCsvRows(built.verdicts),
    pairsRows: report.pairsCsvRows(built.verdicts),
  });
  return { ok: true, res, cfg, skills, bp, sections: built.sections, reportDoc: built.reportDoc, out, degradation, strictFail: cfg.strict === true && degradation.degraded };
}

export function formatScanSummary(scan, opts) {
  if (!scan || !scan.ok) return [];
  const verbose = !!(opts && opts.verbose) || (scan.cfg && scan.cfg.verbose === true);
  if (!verbose) {
    const verdicts = stageData(scan.res, "judge").verdicts || [];
    const mergeRows = verdicts.filter(r => r.verdict_id === 1).sort((a, b) => ((Number(b.rank_score) || 0) - (Number(a.rank_score) || 0)) || String(a.a).localeCompare(String(b.a)));
    const keep = verdicts.filter(r => r.verdict_id === -1).length;
    const undecided = verdicts.filter(r => r.verdict_id === 0).length;
    const reasons = scan.degradation && scan.degradation.reasons ? scan.degradation.reasons.map(x => x.code) : [];
    const conclusion = "结论: " + scan.skills.length + " 个技能；候选 " + verdicts.length + " 对；MERGE " + mergeRows.length + " / UNDECIDED " + undecided + " / KEEP " + keep + (reasons.length ? "；降级/启发式: " + reasons.join(",") : "");
    const top = mergeRows.slice(0, 3).map(r => r.a + " ↔ " + r.b + "（" + (r.rank_score === undefined ? "score n/a" : "score " + r.rank_score) + "）").join("；") || "暂无建议合并对";
    const roots = (scan.sections && scan.sections.corpus && scan.sections.corpus.roots) || [];
    const planCmd = "skill-merge plan --report " + path.join(scan.out || ".", "report.json") + " --corpus " + (roots.join(" ") || "<dir>");
    return [conclusion, "Top: " + top, "下一步: " + planCmd + (scan.strictFail ? "；严格模式: 存在降级/启发式路径（exit 1）" : "")];
  }
  const res = scan.res;
  const pre = stageStats(res, "prefilter");
  const cand = stageStats(res, "candidates");
  const lex = stageStats(res, "lexical");
  const sem = stageStats(res, "semantic");
  const rerank = stageStats(res, "rerank");
  const judge = stageStats(res, "judge");
  const verdicts = stageData(res, "judge").verdicts || [];
  const lines = [
    "语料: " + scan.skills.length + " 个技能（" + (scan.sections.corpus.roots || []).length + " 个目录）",
    "公共前言剥离: " + JSON.stringify(scan.bp),
    "① 预过滤: " + JSON.stringify(pre),
    "② 候选生成: " + JSON.stringify(cand),
    "③ 词面门限: " + JSON.stringify(lex),
    "④ 向量相似度: " + JSON.stringify(sem),
    "④.5 精排: " + JSON.stringify(rerank),
    "⑤ 判决: " + verdicts.length + " 对（" + (judge.judge_mode || scan.cfg.judge) + "）",
  ];
  if (judge) lines.push("   级联: " + JSON.stringify(judge));
  const degradation = scan.degradation;
  if (degradation && degradation.reasons.length) lines.push("降级/启发式: " + degradation.reasons.map(x => x.code).join(", "));
  if (scan.strictFail) lines.push("严格模式: 存在降级/启发式路径 ⇒ exit 1");
  const supply = stageData(res, "provision").supply;
  if (supply && !supply.skipped) lines.push("模型供给: 下载 " + (supply.downloaded || []).length + " 件 / 构建 " + (supply.built || []).length + " 件 / 校验 " + (supply.verified || []).length + " 件（" + (supply.managed ? "managed" : "auto") + "）");
  lines.push("运行级: seed=" + cand.run_seed + " mode=" + scan.cfg.seed_mode + " | 台账 " + cand.ledger_total_before + " -> " + scan.sections.stage2_candidates.ledger_after + " | ④.5 " + rerank.mode_used + " | ④ " + sem.selected + " 对");
  lines.push("产出: " + scan.out);
  return lines;
}