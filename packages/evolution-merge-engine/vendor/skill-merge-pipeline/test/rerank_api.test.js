import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeConfig } from "../src/config.js";
import { rerank } from "../src/rerank/index.js";

const skill = n => ({ name: n, description: "d" + n, body_core: "## 何时用\n" + n, body: "## 何时用\n" + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const rows = [{ a: "a", b: "b", a_path: "a", b_path: "b" }];

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("api 模式：走 Bamboo /v1/decisions，并按四选一概率排序", async () => {
  let seen = null;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    seen = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answers: { pair: { probabilities: { a: 0.05, b: 0.10, c: 0.80, d: 0.05 } } } }));
  });
  const port = await listen(server);
  const old = process.env.BAMBOO_API_KEY;
  process.env.BAMBOO_API_KEY = "test-key";
  try {
    const cfg = makeConfig({ rank_mode: "api", rank_api_url: "http://127.0.0.1:" + port + "/v1/decisions", rank_api_timeout: 5, rank_n: 2 });
    const [picked, stats] = await rerank(rows, byPath, cfg);
    assert.equal(stats.mode_used, "api");
    assert.equal(picked.length, 1);
    assert.equal(picked[0].rank_source, "api_quad");
    assert.ok(Math.abs(picked[0].rank_score - 0.875) < 1e-12);
    assert.equal(seen.model, "startlux-decision-27b-autothink");
    assert.equal(seen.allow_none, false);
    assert.equal(seen.questions.pair.type, "choice");
    assert.deepEqual(Object.keys(seen.questions.pair.criteria), ["a", "b", "c", "d"]);
  } finally {
    if (old === undefined) delete process.env.BAMBOO_API_KEY; else process.env.BAMBOO_API_KEY = old;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("auto 有 key：默认链从 API 起步", async () => {
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answers: { pair: { probabilities: { a: 0.05, b: 0.10, c: 0.80, d: 0.05 } } } }));
  });
  const port = await listen(server);
  const old = process.env.BAMBOO_API_KEY;
  process.env.BAMBOO_API_KEY = "test-key";
  try {
    const cfg = makeConfig({ rank_mode: "auto", rank_api_url: "http://127.0.0.1:" + port + "/v1/decisions", rank_api_timeout: 5, rank_n: 2 });
    const [picked, stats] = await rerank(rows, byPath, cfg);
    assert.equal(stats.mode_used, "api");
    assert.equal(picked[0].rank_source, "api_quad");
  } finally {
    if (old === undefined) delete process.env.BAMBOO_API_KEY; else process.env.BAMBOO_API_KEY = old;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("api 连续失败：降级到本地探测/向量，不抛错", async () => {
  const server = http.createServer((req, res) => { res.statusCode = 500; res.end("boom"); });
  const port = await listen(server);
  const old = process.env.BAMBOO_API_KEY;
  process.env.BAMBOO_API_KEY = "test-key";
  try {
    const cfg = makeConfig({ rank_mode: "api", rank_api_url: "http://127.0.0.1:" + port + "/v1/decisions", rank_server: "", rank_api_timeout: 5, rank_n: 2 });
    const [picked, stats] = await rerank(rows, byPath, cfg);
    assert.equal(picked.length, 1);
    assert.equal(stats.mode_used, "vec");
    assert.ok(stats.api_failed >= 1);
    assert.ok(stats.attempts.some(a => a.tier === "api"));
  } finally {
    if (old === undefined) delete process.env.BAMBOO_API_KEY; else process.env.BAMBOO_API_KEY = old;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("api 失败后降级本地模型：仍返回本地排序结果", async () => {
  const api = http.createServer((req, res) => { res.statusCode = 500; res.end("api down"); });
  const local = http.createServer((req, res) => {
    let raw = ""; req.on("data", c => { raw += c; });
    req.on("end", () => {
      if (req.url === "/health") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ status: "ok" })); return; }
      if (req.url === "/apply-template") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ prompt: "P" })); return; }
      if (req.url === "/completion") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [{ id: 32, logprob: -0.1 }, { id: 33, logprob: -2 }, { id: 34, logprob: -0.05 }, { id: 35, logprob: -3 }] }] })); return; }
      res.statusCode = 404; res.end("nf");
    });
  });
  const apiPort = await listen(api);
  const localPort = await listen(local);
  const old = process.env.BAMBOO_API_KEY;
  process.env.BAMBOO_API_KEY = "test-key";
  try {
    const cfg = makeConfig({ rank_mode: "api", rank_api_url: "http://127.0.0.1:" + apiPort + "/v1/decisions", rank_server: "http://127.0.0.1:" + localPort, rank_api_timeout: 5, rank_probe_timeout: 2, rank_request_timeout: 5, rank_n: 2 });
    const [picked, stats] = await rerank(rows, byPath, cfg);
    assert.equal(stats.mode_used, "local");
    assert.ok(stats.api_failed >= 1);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].rank_source, "local_quad");
  } finally {
    if (old === undefined) delete process.env.BAMBOO_API_KEY; else process.env.BAMBOO_API_KEY = old;
    await new Promise((resolve) => api.close(resolve));
    await new Promise((resolve) => local.close(resolve));
  }
});