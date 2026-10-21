"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs0 from "node:fs";
import { RemoteEmbedder, RemoteEmbedError, USAGE, mapLimit, readKey } from "../src/embed/remote.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";

const state = { active: 0, maxActive: 0, delay: 15, failStatus: 0, failTimes: 0, calls: 0 };
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", async () => {
    const body = JSON.parse(raw);
    state.active += 1;
    if (state.active > state.maxActive) state.maxActive = state.active;
    state.calls += 1;
    await new Promise(r => setTimeout(r, state.delay));
    state.active -= 1;
    if (state.failStatus && state.calls <= state.failTimes) {
      res.writeHead(state.failStatus, state.failStatus === 429 ? { "Retry-After": "0" } : {});
      res.end("fail");
      return;
    }
    const data = body.input.map((t, i) => ({ index: i, embedding: [Number((/(\d+)/.exec(t) || [0, 0])[1]), 1, 1] })).reverse();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data, usage: { prompt_tokens: body.input.length * 3 } }));
  });
});
let URL_BASE = "";
const tmps = [];
after(() => { server.close(); for (const d of tmps) { try { fs0.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } } });
function reset() { state.active = 0; state.maxActive = 0; state.failStatus = 0; state.failTimes = 0; state.calls = 0; }
function mk(opts) {
  const cfg = makeConfig({
    embed_remote_url: URL_BASE + "/v1/embeddings", embed_api_key_env: "REMOTE_TEST_KEY",
    embed_batch: 2, embed_concurrency: 2, embed_retries: 2, embed_timeout: 10,
    embed_max_chars: 100, embed_price_cny_per_ktok: { m: 0.5 }
  });
  const sleeps = [];
  const emb = new RemoteEmbedder("test-model", cfg, Object.assign({ key: "k", priceKey: "m", sleep: ms => { sleeps.push(ms); return Promise.resolve(); } }, opts || {}));
  return { emb, sleeps, cfg };
}
const TEXTS = ["t0", "t1", "t2", "t3", "t4", "t5"];
const usage0 = () => Object.assign({}, USAGE);

test("setup 服务器", async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  URL_BASE = "http://127.0.0.1:" + server.address().port;
});

test("并发上限 + index 乱序保序 + usage/计费", async () => {
  reset();
  const before = usage0();
  const { emb } = mk();
  const out = await emb.fitTransform(TEXTS);
  assert.equal(out.length, 6);
  for (let i = 0; i < 6; i += 1) {
    const expected = i / Math.sqrt(i * i + 2);
    assert.ok(Math.abs(out[i][0] - expected) < 1e-6, "第 " + i + " 条顺序错误: " + out[i][0] + " != " + expected);
  }
  assert.equal(state.maxActive, 2, "并发应为 2，实际 " + state.maxActive);
  const delta = usage0();
  assert.equal(delta.input_tokens - before.input_tokens, 18);
  assert.ok(Math.abs((delta.cost_cny - before.cost_cny) - (18 / 1000) * 0.5) < 1e-12);
});

test("concurrency=1 串行；空 texts 不请求", async () => {
  reset();
  const { emb } = mk();
  emb.concurrency = 1;
  await emb.fitTransform(TEXTS);
  assert.equal(state.maxActive, 1);
  const calls = state.calls;
  const out = await emb.fitTransform([]);
  assert.deepEqual(out, []);
  assert.equal(state.calls, calls);
});

test("429 重试：Retry-After 优先，最终成功", async () => {
  reset();
  state.failStatus = 429; state.failTimes = 1;
  const { emb, sleeps } = mk();
  const out = await emb.fitTransform(["t0", "t1"]);
  assert.equal(out.length, 2);
  assert.equal(state.calls, 2);
  assert.deepEqual(sleeps, [0]);
});

test("5xx 重试并指数退避", async () => {
  reset();
  state.failStatus = 500; state.failTimes = 1;
  const { emb, sleeps } = mk();
  await emb.fitTransform(["t0"]);
  assert.deepEqual(sleeps, [200]);
});

test("重试耗尽抛 RemoteEmbedError；400 不重试", async () => {
  reset();
  state.failStatus = 500; state.failTimes = 99;
  const a = mk();
  a.emb.retries = 1;
  await assert.rejects(a.emb.fitTransform(["t0"]), err => {
    assert.equal(err instanceof RemoteEmbedError, true);
    assert.match(err.message, /HTTP 500/);
    return true;
  });
  assert.equal(state.calls, 2);
  reset();
  state.failStatus = 400; state.failTimes = 99;
  const b = mk();
  await assert.rejects(b.emb.fitTransform(["t0"]), /HTTP 400/);
  assert.equal(state.calls, 1);
});

test("mapLimit：保序且并发不超限", async () => {
  let active = 0, max = 0;
  const items = [5, 1, 3, 4, 2];
  const out = await mapLimit(items, 2, async (x) => { active += 1; max = Math.max(max, active); await new Promise(r => setTimeout(r, x)); active -= 1; return x * 10; });
  assert.deepEqual(out, [50, 10, 30, 40, 20]);
  assert.ok(max <= 2);
});

test("readKey：env 优先；缺失返回提示；不走 fs 直连", () => {
  process.env.REMOTE_TEST_KEY = "sk-env";
  try { assert.deepEqual(readKey("REMOTE_TEST_KEY", ""), ["sk-env", "env:REMOTE_TEST_KEY"]); } finally { delete process.env.REMOTE_TEST_KEY; }
  const [k, src] = readKey("NO_SUCH_KEY_XYZ", "D:/nonexistent/.credentials.yaml");
  assert.equal(k, "");
  assert.match(src, /未找到 key|file:/);
});

test("配置：embed_concurrency/embed_retries 默认与 CLI", () => {
  const cfg = makeConfig();
  assert.equal(cfg.embed_concurrency, 4);
  assert.equal(cfg.embed_retries, 2);
  const r = parseCli(["--corpus", "c", "--out", "o", "--embed-concurrency", "8", "--embed-retries", "0"]);
  assert.equal(r.overrides.embed_concurrency, 8);
  assert.equal(r.overrides.embed_retries, 0);
});