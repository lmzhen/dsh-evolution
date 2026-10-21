"use strict";
// G7.1：plan verb handler（tools/merge-plan.js 的解析逻辑收编于此）。
import path from "node:path";
import { makeConfig } from "../config.js";
import { UsageError } from "../errors.js";
import { planMerges } from "../merge/index.js";
import { renderSummaryLines } from "../merge/summary.js";

const USAGE = "用法: skill-merge plan --report <report.json> --corpus <dir> [--out <dir>] [--model <id>] [--credentials <path>] [--limit <n>] [--no-llm] [--json]";

function parsePlanArgs(argv) {
  const o = { corpusRoots: [], noLlm: false, limit: 0, json: false, model: "", credentialsPath: "", outDir: "", help: false };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--report") { const v = argv[++i]; if (v === undefined || v === "") throw new UsageError("--report 需要报告路径", { where: "plan" }); o.reportPath = v; }
    else if (a === "--corpus") { const v = argv[++i]; if (v === undefined || v === "") throw new UsageError("--corpus 需要目录", { where: "plan" }); o.corpusRoots.push(v); }
    else if (a === "--out") o.outDir = argv[++i];
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--credentials") o.credentialsPath = argv[++i];
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else if (a === "--no-llm") o.noLlm = true;
    else if (a === "--json") o.json = true;
    else throw new UsageError("未知参数: " + a + "（" + USAGE + "）", { where: "plan" });
  }
  if (o.help) return o;
  if (!o.reportPath) throw new UsageError("必须 --report <report.json>", { where: "plan" });
  if (!o.corpusRoots.length) throw new UsageError("必须 --corpus <dir>（plan 不再从 report 递归猜语料路径）", { where: "plan" });
  return o;
}

async function runPlanCommand(argv) {
  const args = parsePlanArgs(argv);
  if (args.help) return { exitCode: 0, lines: [USAGE] };
  const summary = await planMerges({ reportPath: args.reportPath, corpusRoots: args.corpusRoots, outDir: args.outDir || undefined, cfg: makeConfig({}), noLlm: args.noLlm, model: args.model || undefined, credentialsPath: args.credentialsPath || undefined, limit: args.limit });
  if (args.json) return { exitCode: summary.validation_failed > 0 ? 1 : 0, lines: [JSON.stringify(summary, null, 2)] };
  const lines = renderSummaryLines(summary);
  lines.push("输出目录: " + path.dirname(summary.summary_md));
  return { exitCode: summary.validation_failed > 0 ? 1 : 0, lines };
}

export { USAGE as PLAN_USAGE, parsePlanArgs, runPlanCommand };