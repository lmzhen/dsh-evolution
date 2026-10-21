import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";
import { rerank } from "../src/rerank/index.js";

const skill = n => ({ name: n, description: "d" + n, body_core: "## 何时用\n" + n, body: "## 何时用\n" + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const rows = [{ a: "a", b: "b", a_path: "a", b_path: "b" }];
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }

test("Q8 探活失败 → Q4 接力；记录 tier 与 attempts", async () => {
  const q4 = http.createServer((req, res) => {
    if (req.url === "/health") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ status: "ok" })); return; }
    if (req.url === "/apply-template") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ prompt: "P" })); return; }
    if (req.url === "/completion") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [{ id: 32, logprob: -0.1 }, { id: 33, logprob: -2 }, { id: 34, logprob: -0.05 }, { id: 35, logprob: -3 }] }] })); return; }
    res.statusCode = 404; res.end("nf");
  });
  const q4Port = await listen(q4);
  try {
    const cfg = makeConfig({
      rank_mode: "local",
      rank_local_chain: "q8,q4",
      rank_server_q8: "http://127.0.0.1:1",
      rank_server_q4: "http://127.0.0.1:" + q4Port,
      rank_probe_timeout: 0.4, rank_request_timeout: 5, rank_n: 2,
    });
    const [picked, stats] = await rerank(rows, byPath, cfg);
    assert.equal(stats.mode_used, "local");
    assert.deepEqual(stats.local_chain, ["q8", "q4"]);
    assert.equal(stats.local_tier_used, "q4");
    assert.equal(picked.length, 1);
    assert.equal(picked[0].rank_source, "local_quad");
    assert.ok(stats.attempts.some(a => a.tier === "q8" && a.phase === "probe" && a.ok === false));
  } finally { await new Promise((resolve) => q4.close(resolve)); }
});

test("链全部不可用 → vec；reason_code 取首档失败原因", async () => {
  const cfg = makeConfig({ rank_mode: "local", rank_local_chain: "q8,q4", rank_server_q8: "http://127.0.0.1:1", rank_server_q4: "http://127.0.0.1:1", rank_probe_timeout: 0.3, rank_n: 2 });
  const [picked, stats] = await rerank(rows, byPath, cfg);
  assert.equal(stats.mode_used, "vec");
  assert.equal(stats.local_scored, 0);
  assert.ok(stats.attempts.some(a => a.tier === "q8"));
  assert.ok(stats.attempts.some(a => a.tier === "q4"));
  assert.ok(picked.length >= 1);
});

test("CLI：--rank-local-chain / --rank-server-q8 / --rank-server-q4", () => {
  const parsed = parseCli(["--corpus", "c", "--out", "o", "--rank-local-chain", "q8,q4", "--rank-server-q4", "http://x:9"]);
  assert.equal(parsed.overrides.rank_local_chain, "q8,q4");
  assert.equal(parsed.overrides.rank_server_q4, "http://x:9");
});