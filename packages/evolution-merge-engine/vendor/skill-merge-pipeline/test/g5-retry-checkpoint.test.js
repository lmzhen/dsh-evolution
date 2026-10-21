"use strict";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rerank } from "../src/rerank/index.js";
import { withRetry } from "../src/net/retry.js";
import { makeConfig } from "../src/config.js";

const state = { completionCalls: 0, failStatuses: [] };
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", () => {
    if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }
    if (req.url === "/apply-template") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ prompt: "P" })); return; }
    if (req.url === "/completion") {
      state.completionCalls += 1;
      const status = state.failStatuses.shift();
      if (status) { res.writeHead(status); res.end("retry"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [{ id: 32, logprob: -0.1 }, { id: 33, logprob: -2 }, { id: 34, logprob: -0.05 }, { id: 35, logprob: -3 }] }] }));
      return;
    }
    res.writeHead(404); res.end("nf");
  });
});
let BASE = "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g5-retry-"));
after(() => { try { server.close(); } catch (e) { /* ignore */ } try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
function mkCfg(extra) { return makeConfig(Object.assign({ rank_mode: "local", rank_server: BASE, rank_probe_timeout: 2, rank_request_timeout: 5, rank_n: 5, rank_cap: 5000, rank_concurrency: 1, rank_retries: 2, rank_retry_backoff_ms: 1 }, extra || {})); }
function skill(n) { return { name: "skill-" + n, description: "d" + n, body_core: "body " + n, body: "body " + n }; }
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const rows = [{ a: "skill-a", b: "skill-b", a_path: "a", b_path: "b" }];

test("setup", async () => { await new Promise(r => server.listen(0, "127.0.0.1", r)); BASE = "http://127.0.0.1:" + server.address().port; });

test("G5.2 429/500 重试后成功，rank_retries 汇总", async () => {
  state.completionCalls = 0; state.failStatuses = [429, 500];
  const cfg = mkCfg({ rank_checkpoint: path.join(tmp, "retry-ck.json") });
  const [picked, stats] = await rerank(rows, byPath, cfg);
  assert.equal(state.completionCalls, 3);
  assert.equal(stats.mode_used, "local");
  assert.equal(stats.rank_retries, 2);
  assert.equal(picked[0].rank_source, "local_quad");
});

test("G5.2 checkpoint key 含 rankerId/cap/promptSha，换 cap 不复用", async () => {
  state.completionCalls = 0; state.failStatuses = [];
  const ck = path.join(tmp, "shape-ck.json");
  const first = mkCfg({ rank_checkpoint: ck });
  await rerank(rows, byPath, first);
  const calls = state.completionCalls;
  assert.ok(calls > 0);
  const doc = JSON.parse(fs.readFileSync(ck, "utf8"));
  assert.ok(Object.keys(doc).every(k => /^q8\|cap=5000\|prompt=[0-9a-f]{64}\|/.test(k)));
  await rerank(rows, byPath, first);
  assert.equal(state.completionCalls, calls, "同 ranker/cap/prompt 应命中 checkpoint");
  await rerank(rows, byPath, mkCfg({ rank_checkpoint: ck, rank_cap: 4000 }));
  assert.ok(state.completionCalls > calls, "换 cap 不得复用旧分");
});

test("G5.2 withRetry 可被 signal 取消，不无限重试", async () => {
  const ac = new AbortController();
  let calls = 0;
  const p = withRetry(async () => { calls += 1; throw new Error("HTTP 500 boom"); }, { retries: 5, baseMs: 50, signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, err => err.name === "AbortError");
  assert.ok(calls >= 1 && calls < 6);
});