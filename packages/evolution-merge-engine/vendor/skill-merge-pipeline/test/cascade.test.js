"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as judge from "../src/judge.js";
import * as cascade from "../src/judge/cascade.js";
import { makeConfig } from "../src/config.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cascade-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const skill = n => ({ name: n, description: "d" + n, body_core: "## 何时用\n" + n, body: "## 何时用\n" + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const pair = (ev) => ({ a_path: "a", b_path: "b", jaccard_summary: 0.1, jaccard_body: 0.2, body_core_cosine: ev.body, summary_cosine: ev.summary });
const cfg = () => makeConfig({ judge: "stub", l0_caution: false, write_prompts: true });
const promptsIn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".md")).length : 0);

test("resolveJudge：auto→deepseek（有 key）/ stub（无 key）", () => {
  assert.deepEqual(cascade.resolveJudge({ judge: "auto" }, { DEEPSEEK_API_KEY: "k" }), { mode: "deepseek", fallback: "" });
  const noKey = cascade.resolveJudge({ judge: "auto" }, {});
  assert.equal(noKey.mode, "stub");
  assert.match(noKey.fallback, /DEEPSEEK_API_KEY/);
  assert.equal(cascade.resolveJudge({ judge: "stub2" }, {}).mode, "stub2");
  assert.equal(cascade.resolveJudge({ judge: "deepseek" }, {}).mode, "deepseek");
});

test("路由：L0/L1/L2 终止与 L1 MERGE 的 prompt/层级正确", async () => {
  const dir = path.join(tmp, "route");
  const pairs = [
    pair({ summary: 0.30, body: 0.10 }),
    pair({ summary: 0.50, body: 0.10 }),
    pair({ summary: 0.50, body: 0.92 }),
    pair({ summary: 0.50, body: 0.96 })
  ];
  const [rows, stats] = await judge.judgeCascade(pairs, byPath, cfg(), dir);
  assert.deepEqual(rows.map(r => r.level), ["L0", "L1", "L2", "L1"]);
  assert.deepEqual(rows.map(r => r.action), ["KEEP_BOTH", "KEEP_BOTH", "KEEP_BOTH", "MERGE"]);
  assert.deepEqual(rows.map(r => r.trail.length), [2, 2, 3, 2]); // 第 1 行命中 audit（trail 增 L2(audit)）
  assert.deepEqual(stats.levels, { L0: 1, L1: 2, L2: 2 }); // audit 重放计入 L2
  assert.equal(stats.l0_forwarded, 3);
  assert.equal(stats.l1_forwarded, 1);
  assert.equal(promptsIn(dir), 8);
  assert.equal(stats.verdicts["-1"], 3);
  assert.equal(stats.audit_pool, 1);
  assert.equal(stats.audit_sampled, 1);
  assert.equal(stats.audit_overrides, 0); // L2 重放仍 -1，不改判
  assert.equal(stats.verdicts["1"], 1);
});
test("audit：L0 池采样 1 个并 L2 改判覆盖", async () => {
  const dir = path.join(tmp, "audit");
  const pairs = [];
  for (let i = 0; i < 10; i += 1) pairs.push(pair({ summary: 0.40, body: 0.96 }));
  const [rows, stats] = await judge.judgeCascade(pairs, byPath, cfg(), dir);
  assert.equal(stats.audit_pool, 10);
  assert.equal(stats.audit_sampled, 1);
  assert.equal(stats.audit_overrides, 1);
  const changed = rows.filter(r => r.audit_sampled);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].verdict_id, 1);
  assert.equal(changed[0].action, "MERGE");
  assert.equal(changed[0].level, "L2(audit)");
  assert.match(changed[0].reason, /抽检改判/);
  assert.equal(stats.levels.L2, 1);
});

test("错误行语义：runner 异常沿级转发，最终 error/UNDECIDED", async () => {
  const dir = path.join(tmp, "error");
  const failing = async () => { throw new Error("boom"); };
  const [rows, stats] = await judge.judgeCascade([pair({ summary: 0.5, body: 0.5 })], byPath, cfg(), dir, failing);
  assert.equal(rows[0].error, true);
  assert.equal(rows[0].level, "L2");
  assert.equal(rows[0].verdict_id, 0);
  assert.equal(rows[0].action, "UNDECIDED");
  assert.match(rows[0].reason, /^ERROR /);
  assert.equal(stats.errors, 1);
  assert.equal(stats.usage.calls, 0);
  assert.equal(rows[0].trail.length, 3);
});

test("auto→stub：无 key 时内部降级并记录 judge_mode/fallback", async () => {
  const old = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const c = makeConfig({ judge: "auto", l0_caution: false });
    const [rows, stats] = await judge.judgeCascade([pair({ summary: 0.5, body: 0.96 })], byPath, c, path.join(tmp, "auto"));
    assert.equal(stats.judge_mode, "stub");
    assert.equal(stats.judge_auto_fallback, true);
    assert.equal(rows[0].verdict_id, 1);
  } finally { if (old !== undefined) process.env.DEEPSEEK_API_KEY = old; }
});

test("模块拆分：judge 聚合导出与 cascade 一致", () => {
  assert.equal(judge.judgeCascade, cascade.judgeCascade);
  assert.equal(judge.parseVerdict, cascade.parseVerdict);
  assert.deepEqual(cascade.ROUTE, { l0_forward: [1, 0], l1_forward: [0] });
});