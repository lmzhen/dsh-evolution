"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as rerank from "../src/rerank/index.js";
import { makeConfig } from "../src/config.js";

const state = { health: 200, completionCalls: 0, templateCalls: 0, healthCalls: 0, active: 0, maxActive: 0, failEvery: 0, delay: 0 };
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", async () => {
    if (req.url === "/health") {
      state.healthCalls += 1;
      if (state.health !== 200) { res.writeHead(state.health); res.end("fail"); return; }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return;
    }
    if (req.url === "/apply-template") { state.templateCalls += 1; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ prompt: "P:" + JSON.parse(raw).messages[1].content })); return; }
    if (req.url === "/completion") {
      state.completionCalls += 1;
      state.active += 1; if (state.active > state.maxActive) state.maxActive = state.active;
      await new Promise(r => setTimeout(r, state.delay));
      state.active -= 1;
      if (state.failEvery && state.completionCalls % state.failEvery === 0) { res.writeHead(500); res.end("model fail"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [
        { id: 32, logprob: -0.10 }, { id: 33, logprob: -2.00 }, { id: 34, logprob: -0.05 }, { id: 35, logprob: -3.00 }
      ] }] }));
      return;
    }
    res.writeHead(404); res.end("nf");
  });
});
let BASE = "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-rr-"));
after(() => { server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
function reset() { state.health = 200; state.completionCalls = 0; state.templateCalls = 0; state.healthCalls = 0; state.active = 0; state.maxActive = 0; state.failEvery = 0; state.delay = 0; }
function mkCfg(extra) {
  return makeConfig(Object.assign({ rank_mode: "auto", rank_server: BASE, rank_probe_timeout: 2, rank_request_timeout: 5, rank_n: 20, rank_vec_topk: 10, rank_cap: 5000, rank_concurrency: 1, rank_ckpt_batch: 3 }, extra || {}));
}
function skill(n) { return { name: "skill-" + n, description: "desc " + n, body_core: "body " + n, body: "body " + n }; }
const byPath = new Map();
for (const n of ["a", "b", "c", "d", "e", "f"]) byPath.set(n, skill(n));
const rows = [["a", "b"], ["c", "d"], ["a", "c"], ["b", "d"], ["a", "e"], ["c", "f"]].map(([x, y], i) => ({
  a: "skill-" + x, b: "skill-" + y, a_path: x, b_path: y, body_core_cosine: 0.9 - i * 0.1, summary_cosine: 0.8 - i * 0.05
}));
const keyOf = r => r.a_path + "|" + r.b_path;

test("setup 服务器", async () => { await new Promise(r => server.listen(0, "127.0.0.1", r)); BASE = "http://127.0.0.1:" + server.address().port; });

test("探活失败 → vec：结果与 vecSelect 深等，reason_code 有值", async () => {
  reset(); state.health = 500;
  const cfg = mkCfg();
  const [picked, stats] = await rerank.rerank(rows, byPath, cfg);
  assert.equal(stats.mode_used, "vec");
  assert.equal(stats.degraded, true);
  assert.equal(stats.reason_code, "http-error");
  assert.equal(stats.local_scored, 0);
  assert.equal(state.completionCalls, 0);
  const expect = rerank.vecSelect(rows, cfg).map(r => r.a_path + "|" + r.b_path + ":" + r.rank_score);
  assert.deepEqual(picked.map(r => keyOf(r) + ":" + r.rank_score), expect);
});

test("本地全成功：ckpt 批量写；重跑 0 completion 调用", async () => {
  reset();
  const ck = path.join(tmp, "ck1.json");
  const cfg = mkCfg({ rank_checkpoint: ck });
  const [picked, stats] = await rerank.rerank(rows, byPath, cfg);
  assert.equal(stats.mode_used, "local");
  assert.equal(stats.degraded, false);
  assert.equal(picked.length, 6);
  assert.equal(state.completionCalls, 6);
  const doc = JSON.parse(fs.readFileSync(ck, "utf8"));
  assert.equal(Object.keys(doc).length, 6);
  assert.ok(Object.keys(doc).every(k => /^q8\|cap=5000\|prompt=[0-9a-f]{64}\|/.test(k)), "checkpoint key 缺 rankerId/cap/promptSha");
  const calls1 = state.completionCalls, tpl1 = state.templateCalls;
  const cfg2 = mkCfg({ rank_checkpoint: ck });
  const [picked2, stats2] = await rerank.rerank(rows, byPath, cfg2);
  assert.equal(state.completionCalls, calls1, "重跑不得再调用模型");
  assert.equal(state.templateCalls, tpl1);
  assert.equal(stats2.ckpt_all, true);
  assert.equal(stats2.ckpt_hits, 6);
  assert.deepEqual(picked2.map(keyOf), picked.map(keyOf));
});

test("部分失败 → local_partial：失败项 vec 补位 + attempts/reason_code", async () => {
  reset(); state.failEvery = 2;
  const cfg = mkCfg({ rank_checkpoint: path.join(tmp, "ck2.json"), rank_retries: 0 });
  const [picked, stats] = await rerank.rerank(rows, byPath, cfg);
  assert.equal(stats.mode_used, "local_partial");
  assert.equal(stats.degraded, true);
  assert.equal(stats.reason_code, "partial-fill");
  assert.equal(stats.attempts.length, 3);
  assert.ok(stats.attempts.every(a => a.ok === false && a.reasonCode === "http-error"));
  assert.ok(picked.some(r => r.rank_source === "vec_fallback"));
  assert.ok(picked.length >= 4);
});

test("Checkpoint：批量原子写次数、损坏文件回退、旧 key 不复用", async () => {
  reset();
  const p = path.join(tmp, "ck_unit.json");
  const ck = new rerank.Checkpoint(p, 3);
  for (let i = 0; i < 6; i += 1) ck.set("k" + i, i);
  assert.equal(ck.writes, 2);
  ck.flush();
  assert.equal(ck.writes, 3);
  assert.equal(JSON.parse(fs.readFileSync(p, "utf8")).k5, 5);
  const bad = path.join(tmp, "bad.json"); fs.writeFileSync(bad, "{not-json");
  const ck2 = new rerank.Checkpoint(bad, 3);
  assert.equal(ck2.size(), 0);
  const legacy = path.join(tmp, "legacy.json"); fs.writeFileSync(legacy, JSON.stringify({ "a|b": 0.4321 }));
  const cfg = mkCfg({ rank_checkpoint: legacy });
  const [picked, stats] = await rerank.rerank([rows[0]], byPath, cfg);
  assert.equal(stats.ckpt_all, false);
  assert.ok(state.completionCalls > 0, "旧 key 不得复用");
  assert.notEqual(picked[0].rank_score, 0.4321);
  assert.equal(picked[0].rank_source, "local_quad");
});

test("并发：rank_concurrency=2 受限且结果与串行一致", async () => {
  reset(); state.delay = 20;
  const c1 = mkCfg({ rank_concurrency: 1, rank_checkpoint: path.join(tmp, "ck_c1.json") });
  const [p1] = await rerank.rerank(rows, byPath, c1);
  assert.equal(state.maxActive, 1);
  reset(); state.delay = 20;
  const c2 = mkCfg({ rank_concurrency: 2, rank_checkpoint: path.join(tmp, "ck_c2.json") });
  const [p2, s2] = await rerank.rerank(rows, byPath, c2);
  assert.ok(state.maxActive <= 2 && state.maxActive >= 2, "maxActive=" + state.maxActive);
  assert.equal(s2.local_scored, 6);
  assert.deepEqual(p2.map(r => keyOf(r) + ":" + r.rank_score), p1.map(r => keyOf(r) + ":" + r.rank_score));
});

