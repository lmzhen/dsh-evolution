"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../src/config.js";
import { makeJudgeProvider, assertJudgeProvider, resolveJudgeProvider } from "../src/judge/provider.js";
import { judgeCascade } from "../src/judge/cascade.js";
import { EVIDENCE_KEYS, buildEvidence } from "../src/evidence.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const skill = n => ({ name: n, path: n, description: "d" + n, summary: "s" + n, body_core: "body " + n, body: "body " + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const pairs = [{ a: "a", b: "b", a_path: "a", b_path: "b" }];

test("G5.3 judge provider 契约：id/promptSha/heuristic/judge", () => {
  const p = makeJudgeProvider({ id: "stub:x", mode: "stub", promptSha: "a".repeat(64), heuristic: true, judge: async () => [] });
  assert.equal(assertJudgeProvider(p), p);
  assert.throws(() => makeJudgeProvider({ id: "x", promptSha: "short", heuristic: false, judge: async () => [] }), /promptSha/);
  assert.throws(() => makeJudgeProvider({ id: "x", promptSha: "a".repeat(64), heuristic: false }), /judge/);
});

test("G5.3 resolveJudgeProvider：stub heuristic / auto fallback / deepseek", async () => {
  const stub = resolveJudgeProvider(makeConfig({ judge: "stub" }), {});
  assert.equal(stub.mode, "stub");
  assert.equal(stub.heuristic, true);
  assert.match(stub.id, /^stub:stub-v1$/);
  assert.match(stub.promptSha, /^[0-9a-f]{64}$/);
  assert.equal(stub.fallback, "");
  const guess = await stub.judge([{ level: "L0", evidence: { summary_cosine: 0.9 } }]);
  assert.equal(guess[0].verdict, 1);
  const auto = resolveJudgeProvider(makeConfig({ judge: "auto" }), {});
  assert.equal(auto.mode, "stub");
  assert.match(auto.fallback, /DEEPSEEK_API_KEY/);
  const ds = resolveJudgeProvider(makeConfig({ judge: "deepseek", judge_model: "m" }), { DEEPSEEK_API_KEY: "k" });
  assert.equal(ds.mode, "deepseek");
  assert.equal(ds.heuristic, false);
  await assert.rejects(ds.judge([{ prompt: "p" }]), /ctx.runner/);
  const parsed = await ds.judge([{ prompt: "p" }], { runner: async () => "{\"verdict\":-1,\"reason\":\"x\",\"evidence\":[]}" });
  assert.equal(parsed[0].verdict, -1);
});

test("G5.3 judgeCascade：evidence 四键齐全缺失 null，行/stats 带 provider 元数据", async () => {
  const cfg = makeConfig({ judge: "stub", l0_caution: false, write_prompts: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g5-judge-"));
  try {
    const [rows, stats] = await judgeCascade(pairs, byPath, cfg, dir);
    const prompt = JSON.parse(fs.readFileSync(rows[0].prompt_files[0], "utf8"));
    const ev = buildEvidence(pairs[0]);
    assert.deepEqual(Object.keys(ev), [...EVIDENCE_KEYS]);
    assert.equal(ev.jaccard_summary, null);
    assert.equal(ev.body_cosine, null);
    assert.ok(Object.keys(prompt.scores).every(k => EVIDENCE_KEYS.includes(k)));
    assert.equal(Object.values(prompt.scores).some(v => v === null), false, "prompt 不序列化 null evidence");
    assert.equal(rows[0].judge_id, "stub:stub-v1");
    assert.equal(rows[0].heuristic, true);
    assert.equal(rows[0].verdict_record.judge_id, "stub:stub-v1");
    assert.deepEqual(stats.judge_provider, { id: "stub:stub-v1", promptSha: stats.judge_provider.promptSha, heuristic: true });
    assert.match(stats.judge_provider.promptSha, /^[0-9a-f]{64}$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});