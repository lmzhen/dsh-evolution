#!/usr/bin/env node
"use strict";
// G7.1：单入口 CLI；scan/plan/doctor/models 的解析委托 src/cli 或命令模块。
import { formatHelp } from "./cli.js";
import { formatError, exitCodeOf } from "./errors.js";
import { runScanCommand } from "./cli/scan.js";
import { runPlanCommand } from "./cli/plan.js";
import { runModelsCommand } from "./models/ensure-cli.js";
import { runDoctorCommand } from "./models/doctor-cli.js";

const VERBS = new Set(["scan", "plan", "doctor", "models"]);
const TOP_USAGE = "用法: skill-merge <scan|plan|doctor|models> [选项]";

async function dispatch(verb, args) {
  if (verb === "scan") return runScanCommand(args);
  if (verb === "plan") return runPlanCommand(args);
  if (verb === "doctor") return runDoctorCommand(args);
  if (verb === "models") return runModelsCommand(args);
  throw new Error("未知 verb: " + verb);
}

(async () => {
  const rawArgv = process.argv.slice(2);
  const debug = rawArgv.includes("--debug");
  const argv = rawArgv.filter(x => x !== "--debug");
  if (argv[0] === "-h" || argv[0] === "--help") {
    console.log(TOP_USAGE);
    console.log("  --debug                            显示错误栈（仅调试）");
    console.log(formatHelp());
    return;
  }
  const hasVerb = VERBS.has(argv[0]);
  const verb = hasVerb ? argv[0] : "scan";
  const args = hasVerb ? argv.slice(1) : argv;
  try {
    const r = await dispatch(verb, args);
    for (const w of r.warnings || []) console.error("警告: " + w);
    for (const line of r.lines || []) console.log(line);
    if (r.error) console.error(formatError(r.error, { debug }));
    process.exit(r.exitCode);
  } catch (err) { console.error(formatError(err, { debug })); process.exit(exitCodeOf(err)); }
})().catch((err) => { console.error(formatError(err)); process.exit(exitCodeOf(err)); });