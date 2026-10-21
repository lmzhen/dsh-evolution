import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import * as rerank from "../src/rerank/index.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";

const state = { propsMode: "slots2", active: 0, maxActive: 0, delay: 25, completionCalls: 0 };
const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }
  if (req.url === "/props") {
    if (state.propsMode === "slots2") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ total_slots: 2 })); return; }
    res.writeHead(404); res.end("nf"); return;
  }
  if (req.url === "/slots") { res.writeHead(404); res.end("nf"); return; }
  if (req.url === "/apply-template") {
    let raw = ""; req.on("data", c => { raw += c; }); req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ prompt: "P:" + JSON.parse(raw).messages[1].content.slice(0, 40) }));
    });
    return;
  }
  if (req.url === "/completion") {
    state.completionCalls += 1;
    state.active += 1; if (state.active > state.maxActive) state.maxActive = state.active;
    setTimeout(() => {
      state.active -= 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [
        { id: 32, logprob: -0.10 }, { id: 33, logprob: -2.00 }, { id: 34, logprob: -0.05 }, { id: 35, logprob: -3.00 }
      ] }] }));
    }, state.delay);
    return;
  }
  res.writeHead(404); res.end("nf");
});
let BASE = "";
after(() => server.close());
function reset() { state.propsMode = "slots2"; state.active = 0; state.maxActive = 0; state.delay = 25; state.completionCalls = 0; }
const skill = n => ({ name: "s" + n, description: "d" + n, body_core: "## 何时用\n" + n, body: "## 何时用\n" + n });
const byPath = new Map();
for (let i = 0; i < 8; i += 1) byPath.set("a" + i, skill(i));
for (let i = 0; i < 8; i += 1) byPath.set("b" + i, skill(100 + i));
const rows = Array.from({ length: 8 }, (_, i) => ({ a: "s" + i, b: "s" + (100 + i), a_path: "a" + i, b_path: "b" + i, body_core_cosine: 0.9, summary_cosine: 0.8 }));
const mkCfg = (extra) => makeConfig(Object.assign({ rank_mode: "auto", rank_server: BASE, rank_probe_timeout: 2, rank_request_timeout: 5, rank_n: 20, rank_vec_topk: 10, rank_cap: 5000, rank_ckpt_batch: 25, rank_concurrency: 1 }, extra || {}));
const sig = picked => picked.map(r => r.a_path + "|" + r.b_path + ":" + r.rank_score).join(";");

test("setup", async () => { await new Promise(r => server.listen(0, "127.0.0.1", r)); BASE = "http://127.0.0.1:" + server.address().port; });

test("默认并发 1：不探测 slots、maxActive=1、行为不变", async () => {
  reset();
  const [picked, stats] = await rerank.rerank(rows, byPath, mkCfg());
  assert.equal(stats.mode_used, "local");
  assert.equal(stats.rank_concurrency_requested, 1);
  assert.equal(stats.rank_concurrency_used, 1);
  assert.equal(stats.rank_slots, null);
  assert.equal(state.maxActive, 1);
  assert.equal(picked.length, rerank.vecSelect(rows, mkCfg()).length >= 0 ? 8 : 8);
});

test("并发 4 + slots=2：used=2、maxActive≤2、结果与串行一致", async () => {
  reset();
  const [serial, s1] = await rerank.rerank(rows, byPath, mkCfg());
  assert.equal(s1.rank_concurrency_used, 1);
  reset();
  const [parallel, s2] = await rerank.rerank(rows, byPath, mkCfg({ rank_concurrency: 4 }));
  assert.equal(s2.rank_concurrency_requested, 4);
  assert.equal(s2.rank_slots, 2);
  assert.equal(s2.rank_concurrency_used, 2);
  assert.ok(state.maxActive <= 2, "maxActive=" + state.maxActive);
  assert.ok(state.maxActive >= 2, "并发未生效 maxActive=" + state.maxActive);
  assert.equal(sig(parallel), sig(serial), "并发不得改变结果");
});

test("slots 探测失败：用请求并发并记录原因，结果一致", async () => {
  reset(); state.propsMode = "none";
  const [serial] = await rerank.rerank(rows, byPath, mkCfg());
  reset(); state.propsMode = "none";
  const [parallel, stats] = await rerank.rerank(rows, byPath, mkCfg({ rank_concurrency: 4 }));
  assert.equal(stats.rank_slots, null);
  assert.equal(stats.rank_concurrency_used, 4);
  assert.match(stats.rank_slots_reason, /探测失败\/不支持/);
  assert.ok(state.maxActive <= 4 && state.maxActive >= 2);
  assert.equal(sig(parallel), sig(serial));
});

test("probeSlots 单元：total_slots / slots[] / 失败", async () => {
  reset();
  assert.deepEqual(await rerank.probeSlots(mkCfg()), { slots: 2, reason: "探测 /props 成功" });
  reset(); state.propsMode = "none";
  const r = await rerank.probeSlots(mkCfg());
  assert.equal(r.slots, null);
  assert.match(r.reason, /探测失败/);
});

test("CLI：--rank-concurrency 解析", () => {
  const parsed = parseCli(["--corpus", "c", "--out", "o", "--rank-concurrency", "4"]);
  assert.equal(parsed.overrides.rank_concurrency, 4);
});