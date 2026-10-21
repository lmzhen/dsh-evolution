"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeConfig } from "../src/config.js";
import { buildCard, loadCorpusSkills } from "../src/merge/card.js";
import { deterministicClassify } from "../src/merge/classify.js";
import { deterministicPlan, planMerge } from "../src/merge/plan.js";
import { validatePlan } from "../src/merge/schema.js";

const FIXTURE = path.join(import.meta.dirname, "..", "parity", "fixtures", "corpus");
const cfg = makeConfig({});
const PAIR = { a: "capability-claim-audit", b: "capability-replication-audit", level: "L1", verdict_id: 1, action: "MERGE", reason: "same audit method", jaccard_summary: 0.21, jaccard_body: 0.16, summary_cosine: 0.68, body_core_cosine: 0.5, score: 0.21 };
function setup() { const card = buildCard(PAIR, loadCorpusSkills([FIXTURE], cfg)); return { card, s1: deterministicClassify(card), plan: deterministicPlan(card, deterministicClassify(card)) }; }

test("G6.3 deterministic plan 通过卡级校验，两次深等可复现", () => {
  const { card, s1, plan } = setup();
  assert.deepEqual(validatePlan(plan, card), []);
  const again = deterministicPlan(card, s1);
  assert.deepEqual(again, plan);
});

test("G6.3 占位符/全 drop/坏引用/重复 section 可红", () => {
  const { card, plan } = setup();
  const placeholder = JSON.parse(JSON.stringify(plan)); placeholder.rationale = "TODO 待补";
  assert.ok(validatePlan(placeholder, card).some(x => /占位符/.test(x)));
  const allDrop = JSON.parse(JSON.stringify(plan)); for (const d of allDrop.content.unit_dispositions) { d.action = "drop"; d.reason = "x"; }
  assert.ok(validatePlan(allDrop, card).some(x => /源内容存活/.test(x)));
  const badPair = JSON.parse(JSON.stringify(plan)); badPair.content.atomic_pairs = [{ file: "references/x.md", link_section: "missing-section" }];
  assert.ok(validatePlan(badPair, card).some(x => /引用/.test(x)));
  const dup = JSON.parse(JSON.stringify(plan)); dup.content.target_sections.push({ ...dup.content.target_sections[0] });
  assert.ok(validatePlan(dup, card).some(x => /target_sections\.id 重复/.test(x)));
});

test("G6.3 LLM 不可用时 fallback 可复现且标注", async () => {
  const { card, s1 } = setup();
  const a = await planMerge(card, s1, { available: false });
  const b = await planMerge(card, s1, { available: false });
  assert.equal(a.source, "fallback");
  assert.deepEqual(a.plan, b.plan);
  assert.deepEqual(validatePlan(a.plan, card), []);
});