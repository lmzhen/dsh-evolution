"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as judge from "../src/judge.js";
import * as stub from "../src/judge/stub.js";
import * as deepseek from "../src/judge/deepseek.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-judge-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const skill = n => ({ name: n, description: "d" + n, body_core: "## 何时用\n" + n, body: "## 何时用\n" + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const mkPair = (ev) => [{ a_path: "a", b_path: "b", jaccard_summary: 0.1, jaccard_body: 0.2, body_core_cosine: ev.body, summary_cosine: ev.summary }];

test("stub-v1 冻结 oracle：阈值/回退/文案", () => {
  assert.equal(stub.STUB_VERSION, "stub-v1");
  assert.deepEqual(stub.V1.l0, { merge: 0.6, forward: 0.45 });
  assert.equal(stub.stubVerdict("L0", { summary_cosine: 0.6 }).verdict, 1);
  assert.equal(stub.stubVerdict("L0", { summary_cosine: 0.45 }).verdict, 0);
  assert.equal(stub.stubVerdict("L0", { summary_cosine: 0.449 }).verdict, -1);
  assert.equal(stub.stubVerdict("L0", { jaccard_summary: 0.7 }).verdict, 1);
  assert.equal(stub.stubVerdict("L1", { body_cosine: 0.95 }).verdict, 1);
  assert.equal(stub.stubVerdict("L1", { body_cosine: 0.9 }).verdict, 0);
  assert.equal(stub.stubVerdict("L1", { body_cosine: 0.899 }).verdict, -1);
  assert.equal(stub.stubVerdict("L1", {}).verdict, -1);
  assert.equal(stub.stubVerdict("L2", { body_cosine: 0.94 }).verdict, 1);
  assert.equal(stub.stubVerdict("L2", { body_cosine: 0.939 }).verdict, -1);
  assert.equal(stub.stubVerdict("L1", { body_cosine: 0.9 }).reason, "stub(启发式): score=0.900");
});

test("stub-v2 地板驱动：默认 0.95/0.60；floor 覆盖；仅 opt-in", () => {
  assert.equal(stub.STUB2_VERSION, "stub-v2");
  assert.equal(stub.stubVerdictV2("L0", { summary_cosine: 0.6 }).verdict, 1);
  assert.equal(stub.stubVerdictV2("L0", { summary_cosine: 0.59 }).verdict, 0);
  assert.equal(stub.stubVerdictV2("L1", { body_cosine: 0.95 }).verdict, 1);
  assert.equal(stub.stubVerdictV2("L1", { body_cosine: 0.949 }).verdict, 0);
  assert.equal(stub.stubVerdictV2("L2", { body_cosine: 0.949 }).verdict, -1);
  assert.equal(stub.stubVerdictV2("L1", { body_cosine: 0.8 }, { body: 0.8, summary: 0.7 }).verdict, 1);
  assert.match(stub.stubVerdictV2("L1", { body_cosine: 0.5 }).reason, /stub2\(地板驱动\)/);
  const r = parseCli(["--corpus", "c", "--out", "o", "--judge", "stub2"]);
  assert.equal(r.overrides.judge, "stub2");
});

test("judgeCascade：stub2 使用地板（cfg.stub2_floors），默认 stub 仍为 v1", async () => {
  const base = makeConfig({ judge: "stub", l0_caution: false });
  const [rows1, st1] = await judge.judgeCascade(mkPair({ body: 0.96, summary: 0.61 }), byPath, base, path.join(tmp, "p1"));
  assert.equal(st1.stub_version, "stub-v1");
  assert.equal(rows1[0].verdict_id, 1);
  const cfg2 = makeConfig({ judge: "stub2", l0_caution: false });
  cfg2.stub2_floors = { body: 0.99, summary: 0.99 };
  const [rows2, st2] = await judge.judgeCascade(mkPair({ body: 0.96, summary: 0.61 }), byPath, cfg2, path.join(tmp, "p2"));
  assert.equal(st2.stub_version, "stub-v2");
  assert.notEqual(rows2[0].verdict_id, 1);
  assert.equal(rows2[0].trail[0].level, "L0");
});

test("deepseek usage/计费：tokens 与 cost_cny 累加", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "{\"verdict\":1,\"reason\":\"x\",\"evidence\":[]}" } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) });
  try {
    Object.assign(deepseek.USAGE, { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 });
    const cfg = makeConfig({ judge: "deepseek", judge_model: "deepseek-flash" });
    const out = await deepseek.callDeepseek("p", cfg);
    assert.match(out, /verdict/);
    assert.equal(deepseek.USAGE.calls, 1);
    assert.equal(deepseek.USAGE.prompt_tokens, 100);
    assert.equal(deepseek.USAGE.completion_tokens, 50);
    assert.ok(Math.abs(deepseek.USAGE.cost_cny - (100 / 1000 * 0.0005 + 50 / 1000 * 0.002)) < 1e-12);
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey; }
});

test("VerdictRecord：level/verdict/action/prompt_sha/model", async () => {
  const cfg = makeConfig({ judge: "stub", l0_caution: false, judge_model: "deepseek-flash" });
  const [rows, stats] = await judge.judgeCascade(mkPair({ body: 0.96, summary: 0.61 }), byPath, cfg, path.join(tmp, "p3"));
  const rec = rows[0].verdict_record;
  assert.equal(rec.level, rows[0].level);
  assert.equal(rec.verdict, rows[0].verdict_id);
  assert.equal(rec.action, rows[0].action);
  assert.match(rec.prompt_sha, /^[0-9a-f]{64}$/);
  assert.equal(rec.model, "deepseek-flash");
  assert.equal(stats.prompt_version, "judge-prompt-v1");
});