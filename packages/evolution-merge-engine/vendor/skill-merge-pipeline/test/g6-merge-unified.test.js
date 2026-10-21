"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeConfig } from "../src/config.js";
import { buildCard, loadCorpusSkills } from "../src/merge/card.js";
import { deterministicClassify, classifyMerge } from "../src/merge/classify.js";
import { planMerges } from "../src/merge/index.js";
import { buildReport } from "../src/report.js";
import { validateMergeDecision } from "../src/contracts/merge.js";

const FIXTURE = path.join(import.meta.dirname, "..", "parity", "fixtures", "corpus");
const cfg = makeConfig({});
const PAIR = { a: "capability-claim-audit", b: "capability-replication-audit", level: "L1", verdict_id: 1, action: "MERGE", reason: "same audit method", jaccard_summary: 0.21, jaccard_body: 0.16, summary_cosine: 0.68, body_core_cosine: 0.5, score: 0.21 };

function card() { return buildCard(PAIR, loadCorpusSkills([FIXTURE], cfg)); }

test("G6.1 deterministic decision 通过统一 C7 validator", () => {
  const d = deterministicClassify(card());
  assert.deepEqual(validateMergeDecision(d), []);
});

test("G6.1 LLM decision 统一校验：非法 target/confidence 走 fallback-invalid", async () => {
  const bad = { available: true, async callJson() { return { relation: "duplicate", mode: "merge-into-existing", executor: "consolidate-append", target: "Bad Target!", sources: [], rationale: "", confidence: 9 }; } };
  const r = await classifyMerge(card(), bad);
  assert.equal(r.source, "fallback-invalid");
  assert.deepEqual(validateMergeDecision(r.result), []);
  const good = { available: true, async callJson() { return { relation: "duplicate", mode: "merge-into-existing", executor: "consolidate-append", target: "capability-audit", sources: ["capability-claim-audit"], rationale: "same", confidence: 0.8 }; } };
  const g = await classifyMerge(card(), good);
  assert.equal(g.source, "llm");
  assert.deepEqual(validateMergeDecision(g.result), []);
});

test("G6.1 planMerges artifact 无绝对路径", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g6-unified-"));
  try {
    const reportPath = path.join(tmp, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify(buildReport({ cfg, sections: { pairs_final: [PAIR] } })));
    const outDir = path.join(tmp, "plans");
    const summary = await planMerges({ reportPath, cfg, corpusRoots: [FIXTURE], noLlm: true, outDir });
    assert.equal(summary.planned, 1);
    const file = path.join(outDir, path.basename(summary.pairs[0].file));
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(/^[A-Za-z]:[\\/]|^\//.test(saved.card.skills.a.path), false);
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (!v || typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) {
        if ((k === "path" || k === "file") && typeof x === "string") assert.equal(/^[A-Za-z]:[\\/]|^\//.test(x), false, "plan artifact 含绝对路径: " + x);
        else walk(x);
      }
    };
    walk(saved);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("G6.1 src/merge 无第二套 decision/synthesis schema", () => {
  for (const f of fs.readdirSync(path.join(import.meta.dirname, "..", "src", "merge")).filter(x => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "merge", f), "utf8");
    assert.equal(/DECISION_SCHEMA|SYNTHESIS_SCHEMA|MergeFailure/.test(src), false, f + " 含第二套 schema");
  }
});