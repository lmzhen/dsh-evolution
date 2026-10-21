"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDoctorArgs, renderDoctor, runDoctorCommand } from "../src/models/doctor-cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("G3.4 parseDoctorArgs：标志/覆盖/未知参数", () => {
  const a = parseDoctorArgs(["--json", "--offline", "--models-dir", "m", "--hf-endpoint", "https://x", "--credentials", "c"]);
  assert.equal(a.json, true);
  assert.equal(a.overrides.offline, true);
  assert.equal(a.overrides.models_dir, "m");
  assert.equal(a.overrides.hf_endpoint, "https://x");
  assert.equal(a.credentialsPath, "c");
  assert.throws(() => parseDoctorArgs(["--bogus"]), /未知参数/);
  assert.throws(() => parseDoctorArgs(["--models-dir"]), /需要目录/);
});

test("G3.4 renderDoctor：三态标签、建议、summary", () => {
  const report = {
    checks: [
      { id: "a", label: "A", status: "pass", detail: "ok" },
      { id: "b", label: "B", status: "skip", detail: "skip", hint: "下一步" },
      { id: "c", label: "C", status: "fail", detail: "bad", hint: "修复" },
    ],
    summary: { pass: 1, fail: 1, skip: 1 }, exitCode: 2,
  };
  const text = renderDoctor(report, {}).join("\n");
  assert.match(text, /\[OK\]\s+A: ok/);
  assert.match(text, /\[SKIP\] B: skip/);
  assert.match(text, /建议: 下一步/);
  assert.match(text, /\[FAIL\] C: bad/);
  assert.match(text, /summary: pass=1 fail=1 skip=1 \| exit=2/);
  const json = JSON.parse(renderDoctor(report, { json: true }).join("\n"));
  assert.equal(json.summary.fail, 1);
});

test("G3.4 CLI 分发：src/run.js doctor --json --offline 失败 exit 2", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g3-doctor-"));
  const run = path.join(__dirname, "..", "src", "run.js");
  const p = spawnSync(process.execPath, [run, "doctor", "--json", "--offline", "--models-dir", empty], { encoding: "utf8" });
  assert.equal(p.status, 2, p.stderr);
  const report = JSON.parse(p.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.checks.some(c => c.id === "models" && c.status === "fail"), true);
});

test("G3.4 doctor --help：可复制用法", async () => {
  const r = await runDoctorCommand(["--help"]);
  assert.equal(r.exitCode, 0);
  assert.match(r.lines.join("\n"), /skill-merge doctor/);
});