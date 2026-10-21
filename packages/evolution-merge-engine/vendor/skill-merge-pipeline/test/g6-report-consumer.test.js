"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeConfig } from "../src/config.js";
import { buildReport } from "../src/report.js";
import { mergePairsOf, planMerges } from "../src/merge/index.js";
import { loadCorpusSkills } from "../src/merge/card.js";

const FIXTURE = path.join(import.meta.dirname, "..", "parity", "fixtures", "corpus");
const cfg = makeConfig({});
const PAIR = { a: "capability-claim-audit", b: "capability-replication-audit", verdict_id: 1, action: "MERGE" };
const validReport = () => buildReport({ cfg, sections: { pairs_final: [PAIR] } });

test("G6.2 坏 report：mergePairsOf/planMerges 入口直接失败", async () => {
  assert.throws(() => mergePairsOf({ schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => mergePairsOf({ pairs_final: [] }), /schemaVersion|缺少必需字段/);
  await assert.rejects(planMerges({ report: { schemaVersion: 2 }, corpusRoots: [FIXTURE], noLlm: true }), /schemaVersion/);
});

test("G6.2 corpus 必须 caller 传入：缺省不递归猜路径", async () => {
  await assert.rejects(planMerges({ report: validReport(), noLlm: true, outDir: fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g6-no-corpus-")) }), /corpusRoots|corpusSkills/);
});

test("G6.2 corpusSkills 快照可消费，report 对象无需 reportPath", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g6-snapshot-"));
  try {
    const snapshot = loadCorpusSkills([FIXTURE], cfg);
    const summary = await planMerges({ report: validReport(), corpusSkills: snapshot, noLlm: true, outDir });
    assert.equal(summary.planned, 1);
    assert.equal(summary.corpus_roots.length, 0);
    assert.equal(summary.report, null);
    assert.equal(fs.existsSync(path.join(outDir, path.basename(summary.pairs[0].file))), true);
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});