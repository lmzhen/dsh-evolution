"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatScanSummary } from "../src/scan.js";
import { makeConfig } from "../src/config.js";
import { judgeCascade } from "../src/judge/cascade.js";

const skill = n => ({ name: n, path: n, description: "d", body_core: "## b\n" + n, body: "## b\n" + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const pair = { a: "a", b: "b", a_path: "a", b_path: "b", jaccard_summary: 0.1, jaccard_body: 0.2, body_core_cosine: 0.9, summary_cosine: 0.6 };

function fakeScan(verbose) {
  return { ok: true, skills: [{}, {}], cfg: { verbose, seed_mode: "fixed", judge: "stub" }, out: "out/demo",
    sections: { corpus: { roots: ["corpus"] }, stage2_candidates: { ledger_after: 0 }, stage5_judge: { mode: "stub" } },
    degradation: { degraded: false, reasons: [] }, strictFail: false,
    res: { stages: [
      { id: "prefilter", data: {}, stats: {} }, { id: "candidates", data: {}, stats: {} }, { id: "lexical", data: {}, stats: {} },
      { id: "semantic", data: {}, stats: {} }, { id: "rerank", data: {}, stats: { mode_used: "local" } },
      { id: "judge", data: { verdicts: [{ a: "a", b: "b", verdict_id: 1, rank_score: 0.9, action: "MERGE" }] }, stats: { judge_mode: "stub" } },
      { id: "provision", data: {}, stats: {} },
    ] } };
}

test("G7.3 默认三行结论 + Top + 下一步；verbose 才出 stage 明细", () => {
  const concise = formatScanSummary(fakeScan(false));
  assert.equal(concise.length, 3);
  assert.match(concise[0], /^结论:/);
  assert.match(concise[1], /^Top:/);
  assert.match(concise[2], /^下一步:/);
  const verbose = formatScanSummary(fakeScan(true));
  assert.ok(verbose.length > 3);
  assert.ok(verbose.some(x => x.startsWith("①")));
});

test("G7.3 prompts 默认不写，write_prompts=true 才写", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g7-prompts-"));
  try {
    await judgeCascade([pair], byPath, makeConfig({ judge: "stub", l0_caution: false }), dir);
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith(".md")), []);
    await judgeCascade([pair], byPath, makeConfig({ judge: "stub", l0_caution: false, write_prompts: true }), dir);
    assert.ok(fs.readdirSync(dir).filter(f => f.endsWith(".md")).length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});