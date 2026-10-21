"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { makeConfig } from "../src/config.js";
import { buildReport } from "../src/report.js";
import { planMerges } from "../src/merge/index.js";
import { renderSummaryLines, renderSummaryMarkdown } from "../src/merge/summary.js";

const FIXTURE = path.join(import.meta.dirname, "..", "parity", "fixtures", "corpus");
const cfg = makeConfig({});
const PAIR = { a: "capability-claim-audit", b: "capability-replication-audit", verdict_id: 1, action: "MERGE" };

function treeHash(dir) {
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      h.update(path.relative(dir, p) + "\0");
      if (e.isDirectory()) walk(p); else h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

test("G6.4 plan 输出：summary.md + summary.json 同源、逐字节可复现、源语料只读", async () => {
  const report = buildReport({ cfg, sections: { pairs_final: [PAIR] } });
  const before = treeHash(FIXTURE);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g6-output-"));
  try {
    const a = await planMerges({ report, corpusRoots: [FIXTURE], cfg, noLlm: true, outDir });
    assert.equal(fs.existsSync(a.summary_md), true);
    const mdA = fs.readFileSync(a.summary_md);
    assert.match(mdA.toString("utf8"), /# Merge Plan Summary/);
    assert.match(mdA.toString("utf8"), /capability-claim-audit/);
    assert.match(mdA.toString("utf8"), /relation: (complement|duplicate)/);
    assert.match(renderSummaryLines(a).join("\n"), /产出计划: 1/);
    assert.match(renderSummaryMarkdown(a), /target: /);
    const b = await planMerges({ report, corpusRoots: [FIXTURE], cfg, noLlm: true, outDir });
    assert.equal(fs.readFileSync(b.summary_md).equals(mdA), true, "summary.md 必须逐字节一致");
    assert.equal(treeHash(FIXTURE), before, "源语料不得被修改");
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});