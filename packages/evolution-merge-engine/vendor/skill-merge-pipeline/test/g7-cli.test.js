"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeConfig } from "../src/config.js";
import { buildReport } from "../src/report.js";

const FIXTURE = path.join(import.meta.dirname, "..", "parity", "fixtures", "corpus");
const RUN = path.join(import.meta.dirname, "..", "src", "run.js");
const cfg = makeConfig({});

function run(args) { return spawnSync(process.execPath, [RUN].concat(args), { encoding: "utf8" }); }

test("G7.1 顶层 help 列出 verbs；scan/plan --help 可用", () => {
  const top = run(["--help"]);
  assert.equal(top.status, 0);
  for (const v of ["scan", "plan", "doctor", "models"]) assert.match(top.stdout, new RegExp(v));
  assert.match(top.stdout, /--corpus/);
  const scan = run(["scan", "--help"]);
  assert.equal(scan.status, 0);
  assert.match(scan.stdout, /--corpus/);
  const plan = run(["plan", "--help"]);
  assert.equal(plan.status, 0);
  assert.match(plan.stdout, /--report/);
});

test("G7.1 plan verb：report+corpus 产出计划与 summary.md", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g7-cli-"));
  try {
    const reportPath = path.join(tmp, "report.json");
    const report = buildReport({ cfg, sections: { pairs_final: [{ a: "capability-claim-audit", b: "capability-replication-audit", verdict_id: 1, action: "MERGE" }] } });
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const out = path.join(tmp, "plans");
    const p = run(["plan", "--report", reportPath, "--corpus", FIXTURE, "--out", out, "--no-llm"]);
    assert.equal(p.status, 0, p.stderr);
    assert.equal(fs.existsSync(path.join(out, "summary.md")), true);
    assert.match(p.stdout, /产出计划: 1/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});