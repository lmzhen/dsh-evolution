"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mapLimit } from "../src/embed/remote.js";
import { runPipeline } from "../src/pipeline/index.js";
import { defineStage } from "../src/pipeline/stage.js";
import { makeConfig } from "../src/config.js";
import { rerank } from "../src/rerank/index.js";

const abortErr = (e) => e && e.name === "AbortError";

test("G2.3 mapLimit：预先/进行中取消", async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(mapLimit([1, 2], 1, async x => x, ac.signal), abortErr);
  const ac2 = new AbortController();
  const p = mapLimit([1, 2, 3, 4], 1, async x => { await new Promise(r => setTimeout(r, 30)); return x; }, ac2.signal);
  setTimeout(() => ac2.abort(), 10);
  await assert.rejects(p, abortErr);
});

test("G2.3 runPipeline：取消在 stage 边界生效", async () => {
  const ac = new AbortController(); ac.abort();
  let ran = false;
  const s = defineStage({ id: "s", async run() { ran = true; return { data: 1, stats: {}, warnings: [], counters: {}, degraded: false }; } });
  const res = await runPipeline({ cfg: makeConfig(), signal: ac.signal, stages: [s] });
  assert.equal(res.ok, false);
  assert.equal(ran, false);
  assert.equal(res.error && res.error.name, "AbortError");
});

test("G2.3 rerank：慢请求可被 signal 取消", async () => {
  let started;
  const completionStarted = new Promise(resolve => { started = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }
    if (req.url === "/apply-template") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ prompt: "P" })); return; }
    if (req.url === "/completion") { started(); setTimeout(() => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [{ id: 32, logprob: -0.1 }, { id: 33, logprob: -2 }, { id: 34, logprob: -0.05 }, { id: 35, logprob: -3 }] }] })); }, 5000); return; }
    res.writeHead(404); res.end("nf");
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const ac = new AbortController();
  const rows = [{ a: "a", b: "b", a_path: "a", b_path: "b" }];
  const byPath = new Map([["a", { name: "a", description: "d", body_core: "body" }], ["b", { name: "b", description: "d", body_core: "body" }]]);
  const cfg = makeConfig({ rank_mode: "local", rank_local_chain: "q8", rank_server: "http://127.0.0.1:" + port, rank_probe_timeout: 1, rank_request_timeout: 5, rank_n: 1, rank_cap: 100 });
  try {
    const p = rerank(rows, byPath, cfg, { signal: ac.signal });
    await completionStarted;
    ac.abort();
    await assert.rejects(p, abortErr);
  } finally { await new Promise(r => server.close(r)); }
});