"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const PARITY = path.join(ROOT, "parity", "run.js");
const BENCH = path.join(ROOT, "bench", "run.js");
const GOLDEN = path.join(ROOT, "parity", "golden");

test("G8.2 篡改 golden ⇒ parity exit 1（golden 带退出码）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g8-parity-"));
  try {
    fs.cpSync(GOLDEN, tmp, { recursive: true });
    const p = path.join(tmp, "ref_rng.json");
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    doc[0].bits[0] = (doc[0].bits[0] + 1) >>> 0;
    fs.writeFileSync(p, JSON.stringify(doc));
    const r = spawnSync(process.execPath, [PARITY], { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { PARITY_GOLDEN_DIR: tmp }) });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[FAIL\]/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("G8.2 bench baseline 记录结构 + 超 +20% exit 1 / 预算内 exit 0", () => {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "bench", "baseline.json"), "utf8"));
  assert.equal(base.schemaVersion, 1);
  assert.ok(Number.isFinite(base.metrics.total_ms) && base.metrics.total_ms > 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g8-bench-"));
  try {
    const low = path.join(tmp, "low.json");
    fs.writeFileSync(low, JSON.stringify({ schemaVersion: 1, metrics: { total_ms: 1 } }));
    const fail = spawnSync(process.execPath, [BENCH, "--json"], { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { BENCH_BASELINE: low }) });
    assert.equal(fail.status, 1);
    const failDoc = JSON.parse(fail.stdout);
    assert.ok(failDoc.regressions.length >= 1);
    const high = path.join(tmp, "high.json");
    fs.writeFileSync(high, JSON.stringify({ schemaVersion: 1, metrics: { total_ms: 1e9 } }));
    const ok = spawnSync(process.execPath, [BENCH, "--json"], { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { BENCH_BASELINE: high }) });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).regressions.length, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});