"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeConfig } from "../src/config.js";
import { rerank } from "../src/rerank/index.js";
import { makeRankerProvider, assertRankerProvider, runRankerChain, RANKER_SCORE_RANGE } from "../src/rerank/provider.js";

const skill = n => ({ name: n, description: "d" + n, body_core: "## 何时用\n" + n, body: "## 何时用\n" + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")], ["x", skill("x")], ["y", skill("y")]]);
const row = n => ({ a: n, b: n, a_path: n, b_path: n });

function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }

test("G5.1 ranker provider 契约与可注入 fake 链", async () => {
  const p1 = makeRankerProvider({ id: "fake:q8", modelId: "q8", scoreRange: RANKER_SCORE_RANGE, score: async (rows) => ({ scored: rows.slice(0, 2).map(r => ({ ...r, rank_score: 0.8 })), failures: rows.slice(2).map(r => ({ ...r, error: "boom" })) }) });
  const p2 = makeRankerProvider({ id: "fake:q4", modelId: "q4", scoreRange: [0, 1], score: async (rows) => ({ scored: rows.map(r => ({ ...r, rank_score: 0.4 })), failures: [] }) });
  assert.equal(assertRankerProvider(p1), p1);
  assert.throws(() => makeRankerProvider({ id: "x", modelId: "x", scoreRange: [0, 2], score: async () => ({}) }), /scoreRange/);
  assert.throws(() => makeRankerProvider({ id: "x", modelId: "x", scoreRange: [0, 1] }), /score/);
  const rows = [row("a"), row("b"), row("c")];
  const res = await runRankerChain([p1, p2], rows, byPath);
  assert.equal(res.scored.length, 3);
  assert.equal(res.failures.length, 0);
  assert.deepEqual(res.attempts.map(x => x.id), ["fake:q8", "fake:q4"]);
  assert.equal(res.scored.find(x => x.a === "c").rank_provider, "fake:q4");
});

test("G5.1 API 部分失败：只回退失败行，不丢成功行", async () => {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    calls += 1;
    if (calls === 2) { res.statusCode = 500; res.end("boom"); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answers: { pair: { probabilities: { a: 0.05, b: 0.10, c: 0.80, d: 0.05 } } } }));
  });
  const port = await listen(server);
  const old = process.env.BAMBOO_API_KEY;
  process.env.BAMBOO_API_KEY = "test-key";
  try {
    const cfg = makeConfig({ rank_mode: "api", rank_api_url: "http://127.0.0.1:" + port + "/v1/decisions", rank_server: "", rank_api_timeout: 5, rank_n: 2, rank_retries: 0 });
    const rows = [{ a: "a", b: "x", a_path: "a", b_path: "x", body_core_cosine: 0.8 }, { a: "b", b: "y", a_path: "b", b_path: "y", body_core_cosine: 0.2 }];
    const [picked, stats] = await rerank(rows, byPath, cfg);
    assert.equal(stats.api_partial, true);
    assert.equal(stats.api_scored, 1);
    assert.equal(stats.api_failed, 1);
    assert.equal(stats.mode_used, "api_partial");
    assert.equal(stats.degraded, true);
    assert.equal(picked.length, 2);
    assert.equal(picked.filter(r => r.rank_source === "api_quad").length, 1);
    assert.equal(picked.filter(r => String(r.rank_source).startsWith("vec")).length, 1);
  } finally {
    if (old === undefined) delete process.env.BAMBOO_API_KEY; else process.env.BAMBOO_API_KEY = old;
    await new Promise((resolve) => server.close(resolve));
  }
});