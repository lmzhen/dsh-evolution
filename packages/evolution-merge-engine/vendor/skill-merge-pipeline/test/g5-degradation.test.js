"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";
import { assessDegradation } from "../src/degrade.js";
import { buildScanReport } from "../src/report.js";

const INT8 = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const PCA = "D:/dsh/skill-merge/models/potion-multilingual-128M-pca64-int8";

test("G5.4 assessDegradation：stub/vec/partial/embedder 去重与 reason_code", () => {
  const res = { timings: [], stages: [
    { id: "semantic", stats: { embedder_degraded: true, embedder_reason: "timeout" } },
    { id: "rerank", stats: { degraded: true, reason_code: "partial-fill", mode_used: "local_partial", attempts: [{ tier: "q8" }] } },
    { id: "judge", stats: { judge_mode: "stub", judge_auto_fallback: true, errors: 1 } },
  ] };
  const d = assessDegradation({ res, cfg: {} });
  assert.equal(d.degraded, true);
  const codes = d.reasons.map(x => x.code);
  assert.ok(codes.includes("timeout"));
  assert.ok(codes.includes("partial-fill"));
  assert.ok(codes.includes("rank-partial"));
  assert.ok(codes.includes("judge-stub"));
  assert.ok(codes.includes("judge-auto-fallback"));
  assert.ok(codes.includes("judge-errors"));
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(d.reason_code, "timeout");
  assert.equal(d.attempts.length, 1);
  assert.deepEqual(assessDegradation({ res: { stages: [] }, cfg: {} }).reasons, []);
});

test("G5.4 scan report：degradation 进 used_mode/sections/顶层 degraded", () => {
  const cfg = makeConfig({ judge: "stub" });
  const res = { ok: true, timings: [], diagnostics: [], stages: [
    { id: "prefilter", data: { kept: [], dropped: [] }, stats: {} },
    { id: "candidates", data: { pairs: new Map() }, stats: {} },
    { id: "lexical", data: { passed: [], scored: [] }, stats: {} },
    { id: "rank_plan", data: { plan: {} }, stats: {} },
    { id: "semantic", data: { selected: [], scored: [] }, stats: {} },
    { id: "rerank", data: {}, stats: { mode_used: "vec", degraded: true, reason_code: "all-down", attempts: [] } },
    { id: "judge", data: { verdicts: [], fallback: "" }, stats: { judge_mode: "stub" } },
  ] };
  const d = assessDegradation({ res, cfg });
  const built = buildScanReport({ cfg, res, roots: ["c"], skills: [], bp: {}, degradation: d });
  assert.equal(built.reportDoc.degraded, true);
  assert.equal(built.reportDoc.used_mode.degraded, true);
  assert.ok(built.reportDoc.used_mode.reasons.some(x => x.code === "rank-vec"));
  assert.ok(built.reportDoc.degradation.reasons.some(x => x.code === "judge-stub"));
});

test("G5.4 配置/CLI：strict 默认 false，--strict 置 true", () => {
  assert.equal(makeConfig().strict, false);
  const r = parseCli(["--corpus", "c", "--out", "o", "--strict"]);
  assert.equal(r.overrides.strict, true);
});

test("G5.4 CLI strict：stub/vec 路径 exit 1，产物仍写出", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g5-strict-"));
  const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g5-corpus-"));
  for (const name of ["alpha", "beta"]) {
    fs.mkdirSync(path.join(corpusDir, name), { recursive: true });
    fs.writeFileSync(path.join(corpusDir, name, "SKILL.md"), "---\nname: " + name + "\ndescription: " + name + " skill\n---\n\n## When\nDo " + name + " work.\n");
  }
  const run = path.join(import.meta.dirname, "..", "src", "run.js");
  const p = spawnSync(process.execPath, [run, "--corpus", corpusDir, "--out", out, "--judge", "stub", "--rank", "vec", "--seed-mode", "fixed", "--embedder", "tfidf", "--embed-local", INT8, "--embed-local-last", PCA, "--strict"], { encoding: "utf8" });
  assert.equal(p.status, 1, p.stderr);
  assert.match(p.stdout, /降级\/启发式/);
  assert.match(p.stdout, /严格模式/);
  assert.equal(fs.existsSync(path.join(out, "report.json")), true);
  fs.rmSync(corpusDir, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});