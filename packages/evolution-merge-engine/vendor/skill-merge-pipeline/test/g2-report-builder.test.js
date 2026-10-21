"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as report from "../src/report.js";
import { assertReportModel } from "../src/contracts/report.js";
import { makeConfig } from "../src/config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeRes() {
  return {
    ok: true,
    timings: [{ id: "prefilter", ms: 1, counters: {}, degraded: false }],
    diagnostics: [],
    stages: [
      { id: "prefilter", data: { kept: [], dropped: [] }, stats: { skills: 2 } },
      { id: "candidates", data: { pairs: new Map() }, stats: { candidate_pairs: 1 } },
      { id: "lexical", data: { passed: [], scored: [] }, stats: { passed: 1 } },
      { id: "rank_plan", data: { plan: { use_local: false } }, stats: {} },
      { id: "semantic", data: { selected: [], scored: [] }, stats: { selected: 1, embedder: "local" } },
      { id: "rerank", data: { ranked: [] }, stats: { mode_used: "vec", n_in: 1, n_out: 1, degraded: false } },
      { id: "judge", data: { verdicts: [{ a: "a", b: "b", action: "KEEP_BOTH", verdict_id: -1, reason: "r" }], fallback: "" }, stats: { judge_mode: "stub" } },
    ],
  };
}

test("G2.4 buildScanReport：单一 builder 产出合法 C2 report", () => {
  const cfg = makeConfig();
  const built = report.buildScanReport({ cfg, res: fakeRes(), roots: ["c"], skills: [{}, {}], bp: { floor: 1 }, ledgerAfter: 3 });
  assertReportModel(built.reportDoc);
  assert.equal(built.reportDoc.used_mode.judge, "stub");
  assert.equal(built.reportDoc.sections, undefined);
  assert.deepEqual(built.reportDoc.pairs_final.map(x => x.action), ["KEEP_BOTH"]);
  assert.equal(built.sections.stage2_candidates.ledger_after, 3);
  assert.equal(built.sections.stage5_judge.mode, "stub");
});

test("G2.4 scan.js 不再组装 sections/used_mode", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "scan.js"), "utf8");
  assert.match(src, /buildScanReport/);
  assert.equal(src.includes("stage4_5_rerank"), false);
  assert.equal(src.includes("usedMode:"), false);
});