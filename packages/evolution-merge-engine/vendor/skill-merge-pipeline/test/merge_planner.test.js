import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeConfig } from "../src/config.js";
import { buildReport } from "../src/report.js";
import { buildCard, loadCorpusSkills, segmentUnits } from "../src/merge/card.js";
import { deterministicClassify, classifyMerge } from "../src/merge/classify.js";
import { deterministicPlan, planMerge } from "../src/merge/plan.js";
import { validatePlan } from "../src/merge/schema.js";
import { planMerges, mergePairsOf } from "../src/merge/index.js";

const FIXTURE = path.join(import.meta.dirname, "..", "parity", "fixtures", "corpus");
const cfg = makeConfig({});
const PAIR = {
  a: "capability-claim-audit", b: "capability-replication-audit", level: "L1", verdict_id: 1, action: "MERGE",
  reason: "同一审计方法的不同应用场景",
  jaccard_summary: 0.2105, jaccard_body: 0.1604, summary_cosine: 0.6792, body_core_cosine: 0.5, score: 0.2105,
  trail: [{ level: "L1", verdict: 1, reason: "同一审计方法的不同应用场景", evidence: [{ path: "capability-claim-audit/head", quote: "It does NOT run the candidates." }] }]
};

function setup() {
  const byName = loadCorpusSkills([FIXTURE], cfg);
  return { byName, card: buildCard(PAIR, byName) };
}

test("S0：卡片构建与 U-ID 切分", () => {
  const { card } = setup();
  assert.equal(card.compat.both_found, true);
  assert.ok(card.skills.a.units.length >= 2);
  assert.ok(card.skills.b.units.length >= 2);
  const ids = [...card.skills.a.units.map(u => "A:" + u.uid), ...card.skills.b.units.map(u => "B:" + u.uid)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(card.evidence.length >= 1);
});

test("segmentUnits：无 heading 时退化为段落单元", () => {
  const units = segmentUnits("A", { body_core: "第一段内容。" + String.fromCharCode(10, 10) + "第二段内容。" });
  assert.ok(units.length >= 1);
  assert.equal(units[0].uid, "A001");
});

test("S1/S2 确定性 fallback：覆盖闭合 + 校验通过", () => {
  const { card } = setup();
  const s1 = deterministicClassify(card);
  const plan = deterministicPlan(card, s1);
  assert.deepEqual(validatePlan(plan, card), []);
  const total = card.skills.a.units.length + card.skills.b.units.length;
  assert.equal(plan.content.unit_dispositions.length, total);
});

test("S4-prime：覆盖缺口/非法 executor/预算超限可检出", () => {
  const { card } = setup();
  const s1 = deterministicClassify(card);
  const plan = deterministicPlan(card, s1);
  const missing = JSON.parse(JSON.stringify(plan)); missing.content.unit_dispositions.pop();
  assert.ok(validatePlan(missing, card).some(p => /覆盖缺口/.test(p)));
  const badExec = JSON.parse(JSON.stringify(plan)); badExec.executor = "magic";
  assert.ok(validatePlan(badExec, card).some(p => /executor 非法/.test(p)));
  const badBudget = JSON.parse(JSON.stringify(plan)); badBudget.content.budget.max_chars = 1000000000;
  assert.ok(validatePlan(badBudget, card).some(p => /预算大于/.test(p)));
});
test("S1/S2 注入 fake LLM：走 llm 路径并通过校验", async () => {
  const { card } = setup();
  const s1 = deterministicClassify(card);
  const detPlan = deterministicPlan(card, s1);
  let calls = 0;
  const fake = { available: true, model: "fake", usage: { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 }, async callJson() { calls += 1; return JSON.parse(JSON.stringify(detPlan)); } };
  const got = await planMerge(card, s1, fake);
  assert.equal(got.source, "llm");
  assert.equal(calls, 1);
  assert.deepEqual(validatePlan(got.plan, card), []);
});

test("S2 计划非法时触发一次定向修复", async () => {
  const { card } = setup();
  const s1 = deterministicClassify(card);
  const good = deterministicPlan(card, s1);
  const bad = JSON.parse(JSON.stringify(good)); bad.content.unit_dispositions.pop();
  let calls = 0;
  const fake = { available: true, model: "fake", usage: { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 }, async callJson() { calls += 1; return JSON.parse(JSON.stringify(calls === 1 ? bad : good)); } };
  const got = await planMerge(card, s1, fake);
  assert.equal(got.source, "llm-repair");
  assert.equal(calls, 2);
});

test("S1 注入 fake LLM：返回结构化分类", async () => {
  const { card } = setup();
  const fake = { available: true, async callJson() { return { relation: "complement", mode: "merge-into-existing", executor: "agent-distill", target: "capability-audit", sources: ["capability-claim-audit", "capability-replication-audit"], rationale: "同一审计方法", confidence: 0.8 }; } };
  const s1 = await classifyMerge(card, fake);
  assert.equal(s1.source, "llm");
  assert.equal(s1.result.executor, "agent-distill");
});

test("端到端：synthetic 报告 → planMerges 产出计划 + summary", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merge-planner-"));
  try {
    const report = buildReport({ cfg, sections: { pairs_final: [PAIR] } });
    const reportPath = path.join(tmp, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report));
    assert.equal(mergePairsOf(report).length, 1);
    const summary = await planMerges({ reportPath, cfg, corpusRoots: [FIXTURE], noLlm: true, outDir: path.join(tmp, "plans") });
    assert.equal(summary.planned, 1);
    assert.equal(summary.validation_failed, 0);
    assert.equal(summary.fallback, 1);
    assert.ok(fs.existsSync(summary.pairs[0].file));
    const saved = JSON.parse(fs.readFileSync(summary.pairs[0].file, "utf8"));
    assert.equal(saved.plan.schemaVersion, 1);
    assert.equal(saved.validate.ok, true);
    assert.ok(fs.existsSync(path.join(tmp, "plans", "summary.json")));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});