"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import {
  MERGE_SCHEMA_VERSION, MODES, RELATIONS, EXECUTORS, validateMergePlanShape, validateMergeDecision, emptyPlan, unsafePath,
} from "../src/contracts/merge.js";
import { validatePlan } from "../src/merge/schema.js";

function validPlan() {
  const p = emptyPlan({ a: "a", b: "b" });
  p.relation = "complement";
  p.mode = "merge-into-existing";
  p.executor = "agent-distill";
  p.nomination = { target: "target-skill", sources: ["a"], mode: "append", reason: "test" };
  p.content = { target_sections: [{ id: "sec-1" }], unit_dispositions: [], atomic_pairs: [{ file: "references/x.md" }], budget: { max_chars: 10 } };
  p.changelog = ["x"];
  return p;
}

test("C7 常量：五 mode / relation / executor 冻结", () => {
  assert.equal(MERGE_SCHEMA_VERSION, 1);
  assert.deepEqual([...MODES], ["merge-into-existing", "create-umbrella", "demote-to-reference", "reference-only", "keep"]);
  assert.ok(RELATIONS.includes("complement"));
  assert.ok(EXECUTORS.includes("agent-distill"));
  assert.ok(Object.isFrozen(MODES));
});

test("C7 MergeDecision 形状合法/非法", () => {
  const d = { relation: "complement", mode: "merge-into-existing", executor: "agent-distill", target: "target-skill", sources: ["a"], rationale: "r", confidence: 0.5 };
  assert.deepEqual(validateMergeDecision(d), []);
  assert.ok(validateMergeDecision({ ...d, mode: "keep" }).length === 0);
  assert.ok(validateMergeDecision({ ...d, confidence: 2 }).some(x => /confidence/.test(x)));
  assert.ok(validateMergeDecision({ ...d, sources: [] }).some(x => /sources/.test(x)));
});

test("C7 MergePlan 形状：合法 plan 通过，枚举/路径失败", () => {
  assert.deepEqual(validateMergePlanShape(validPlan()), []);
  assert.ok(validateMergePlanShape({ ...validPlan(), mode: "bogus" }).some(x => /mode 非法/.test(x)));
  const abs = validPlan(); abs.content.atomic_pairs[0].file = "D:/tmp/x.md";
  assert.ok(validateMergePlanShape(abs).some(x => /安全相对路径/.test(x)));
  const dot = validPlan(); dot.content.atomic_pairs[0].file = "../x.md";
  assert.ok(validateMergePlanShape(dot).some(x => /安全相对路径/.test(x)));
  const tmp = validPlan(); tmp.content.atomic_pairs[0].file = "tmp/x.md";
  assert.ok(validateMergePlanShape(tmp).some(x => /安全相对路径/.test(x)));
  assert.equal(unsafePath("references/x.md"), false);
});

test("C7 旧 validatePlan 仍消费形状契约并保留卡级校验", () => {
  const card = { pair: { a: "a", b: "b" }, skills: { a: { support_files: [], units: [], chars: 10 }, b: { support_files: [], units: [], chars: 10 } } };
  const p = validPlan();
  p.nomination = { target: "target-skill", sources: ["a"], mode: "reference", reason: "test" };
  p.executor = "consolidate-reference";
  assert.deepEqual(validatePlan(p, card).filter(x => !/budget|agent-distill/.test(x)), []);
  assert.ok(validatePlan({ ...p, content: null }, card).some(x => /budget/.test(x)));
});