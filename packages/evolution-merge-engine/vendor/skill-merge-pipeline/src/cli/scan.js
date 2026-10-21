"use strict";
// G7.1：scan verb handler；解析/执行/摘要，不 process.exit。
import { parseCli } from "../cli.js";
import { makeConfig } from "../config.js";
import { runScan, formatScanSummary } from "../scan.js";

async function runScanCommand(argv, opts) {
  const o = opts || {};
  const cli = parseCli(argv || []);
  if (cli.help) return { exitCode: 0, lines: [cli.helpText], warnings: [] };
  const ac = new AbortController();
  const onSigint = () => { if (o.onSigint) o.onSigint(); ac.abort(); };
  process.once("SIGINT", onSigint);
  let scan;
  const cfg = makeConfig(cli.overrides);
  try { scan = await runScan({ cfg, corpus: cli.corpus, out: cli.out, signal: ac.signal }); }
  finally { process.removeListener("SIGINT", onSigint); }
  if (!scan.ok) return { exitCode: scan.exitCode, lines: [], warnings: cli.warnings, error: scan.error };
  return { exitCode: scan.strictFail ? 1 : 0, lines: formatScanSummary(scan, { verbose: cfg.verbose === true }), warnings: cli.warnings };
}

export { runScanCommand };