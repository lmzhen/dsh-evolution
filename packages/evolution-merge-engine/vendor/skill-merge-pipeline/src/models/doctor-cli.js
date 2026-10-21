"use strict";
// G3.4：doctor CLI 只做解析/渲染；检查与三态结论在 models/doctor.js。
import { makeConfig } from "../config.js";
import { UsageError } from "../errors.js";
import { runDoctor } from "./doctor.js";

const USAGE = "用法: skill-merge doctor [--json] [--offline] [--models-dir <dir>] [--hf-endpoint <url>] [--credentials <path>]";

function parseDoctorArgs(argv) {
  const o = { json: false, help: false, overrides: {}, credentialsPath: undefined };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--json") o.json = true;
    else if (a === "--offline") o.overrides.offline = true;
    else if (a === "--models-dir") { const v = argv[++i]; if (v === undefined || v === "") throw new UsageError("--models-dir 需要目录", { where: "doctor" }); o.overrides.models_dir = v; }
    else if (a === "--hf-endpoint") { const v = argv[++i]; if (v === undefined || v === "") throw new UsageError("--hf-endpoint 需要 URL", { where: "doctor" }); o.overrides.hf_endpoint = v; }
    else if (a === "--credentials") { const v = argv[++i]; if (v === undefined || v === "") throw new UsageError("--credentials 需要路径", { where: "doctor" }); o.credentialsPath = v; }
    else throw new UsageError("未知参数: " + a + "（" + USAGE + "）", { where: "doctor" });
  }
  return o;
}

function renderDoctor(report, opts) {
  const o = opts || {};
  if (o.json) return [JSON.stringify(report, null, 2)];
  const lines = [];
  for (const c of report.checks || []) {
    const tag = c.status === "pass" ? "[OK]  " : c.status === "fail" ? "[FAIL]" : "[SKIP]";
    lines.push(tag + " " + c.label + ": " + c.detail);
    if (c.hint) lines.push("       建议: " + c.hint);
  }
  lines.push("");
  lines.push("summary: pass=" + report.summary.pass + " fail=" + report.summary.fail + " skip=" + report.summary.skip + " | exit=" + report.exitCode);
  return lines;
}

async function runDoctorCommand(argv, opts) {
  const o = opts || {};
  const args = parseDoctorArgs(argv);
  if (args.help) return { exitCode: 0, lines: [USAGE] };
  const cfg = makeConfig(args.overrides);
  const report = await runDoctor(Object.assign({}, o, { cfg, offline: cfg.offline, credentialsPath: args.credentialsPath }));
  return { exitCode: report.exitCode, lines: renderDoctor(report, { json: args.json }), report };
}

export { USAGE as DOCTOR_USAGE, parseDoctorArgs, renderDoctor, runDoctorCommand };