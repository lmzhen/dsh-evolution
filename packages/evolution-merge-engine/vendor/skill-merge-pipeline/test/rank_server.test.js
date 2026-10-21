import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as rankServer from "../tools/rank-server.js";
import { loadRegistry } from "../src/models/registry.js";
import { makeConfig } from "../src/config.js";
import { runPipeline, defaultStages } from "../src/pipeline/index.js";
import * as corpus from "../src/corpus.js";

const TOOL = path.join(import.meta.dirname, "..", "tools", "rank-server.js");
const NODE = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-rks-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

test("rankerFile/resolveRankerPath/buildArgs/healthUrl 单元", () => {
  const loaded = loadRegistry();
  const meta = rankServer.rankerFile(loaded.registry);
  assert.equal(meta.file, "StartLux-Decision-0.8B-Q8_0.gguf");
  assert.match(rankServer.resolveRankerPath({ modelsDir: tmp }), /StartLux-Decision-0\.8B-Q8_0\.gguf$/);
  const args = rankServer.buildArgs("m.gguf", { host: "127.0.0.1", port: 9000, ctxSize: 2048, slots: 2 });
  assert.deepEqual(args, ["-m", "m.gguf", "--host", "127.0.0.1", "--port", "9000", "--ctx-size", "2048", "--slots", "2"]);
  assert.equal(rankServer.healthUrl({ port: 9000 }), "http://127.0.0.1:9000/health");
});

test("findLlamaServer：显式 bin 生效；PATH 为空且无 bin ⇒ null", () => {
  assert.equal(rankServer.findLlamaServer({ bin: NODE, env: { PATH: "" } }), NODE);
  assert.equal(rankServer.findLlamaServer({ env: { PATH: "" } }), null);
});

test("parseArgs：--port/--slots/--dry-run/--download", () => {
  const o = rankServer.parseArgs(["--port", "8094", "--slots", "2", "--dry-run", "--download"]);
  assert.equal(o.port, 8094);
  assert.equal(o.slots, 2);
  assert.equal(o.dryRun, true);
  assert.equal(o.download, true);
  const o2 = rankServer.parseArgs(["--gguf", "custom.gguf", "--port", "8095"]);
  assert.equal(o2.gguf, "custom.gguf");
  assert.equal(o2.port, 8095);
});

test("waitHealthy：失败后恢复；始终失败超时", async () => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls += 1;
    if (calls < 3) { res.writeHead(500); res.end("no"); return; }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const ok = await rankServer.waitHealthy(base + "/health", { timeoutMs: 5000, intervalMs: 20 });
    assert.equal(ok.ok, true);
    assert.ok(ok.attempts >= 3);
  } finally { server.close(); }
  const dead = await rankServer.waitHealthy("http://127.0.0.1:1/health", { timeoutMs: 250, intervalMs: 50 });
  assert.equal(dead.ok, false);
});

test("CLI --dry-run：输出将执行命令 JSON", () => {
  const r = spawnSync(NODE, [TOOL, "--dry-run", "--bin", NODE, "--models-dir", tmp], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.binExists, true);
  assert.equal(j.healthUrl, "http://127.0.0.1:8093/health");
  assert.deepEqual(j.args.slice(0, 2), ["-m", j.gguf]);
});

test("CLI：缺 GGUF 给 fetch-models 提示 exit 2", () => {
  const r = spawnSync(NODE, [TOOL, "--models-dir", path.join(tmp, "empty")], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /fetch-models\.js --include ranker/);
});

test("CLI：缺 llama-server 给安装提示 exit 2", () => {
  const models = path.join(tmp, "models");
  const ggufDir = path.join(models, "startlux");
  fs.mkdirSync(ggufDir, { recursive: true });
  fs.writeFileSync(path.join(ggufDir, "StartLux-Decision-0.8B-Q8_0.gguf"), "fake");
  const r = spawnSync(NODE, [TOOL, "--models-dir", models], { encoding: "utf8", env: Object.assign({}, process.env, { PATH: "", Path: "" }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /llama-server/);
});
test("④.5 local e2e（假 llama-server）：pipeline 精排走 local", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }
    if (req.url === "/apply-template") {
      let raw = "";
      req.on("data", c => { raw += c; });
      req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ prompt: "P" })); });
      return;
    }
    if (req.url === "/completion") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [{ id: 32, logprob: -0.1 }, { id: 33, logprob: -2 }, { id: 34, logprob: -0.05 }, { id: 35, logprob: -3 }] }] }));
      return;
    }
    res.writeHead(404); res.end("nf");
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const FIX = path.join(import.meta.dirname, "..", "parity", "fixtures", "corpus");
    const INT8 = process.env.SKILL_MERGE_INT8 || "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
    const cfg = makeConfig({ seed_mode: "fixed", round_count: 1, embed_backend: "local", embedder_model: INT8, embedder_model_last: INT8, rank_mode: "local", rank_server: base, rank_n: 20 });
    const [skills] = corpus.loadCorpus([FIX]);
    corpus.stripBoilerplate(skills, cfg);
    const baseStages = defaultStages();
    const stages = [baseStages[0], baseStages[1], baseStages[2], baseStages[3], baseStages[4]];
    const res = await runPipeline({ cfg, out: path.join(tmp, "e2e"), stages, input: { skills } });
    assert.equal(res.ok, true, res.error && res.error.message);
    const ranked = res.data.rerank.ranked;
    assert.ok(ranked.length > 0);
    assert.ok(ranked.every(r => r.rank_source === "local_quad"), "存在非 local_quad 行");
    const rerankStats = res.stages.find(s => s.id === "rerank").stats;
    assert.equal(rerankStats.mode_used, "local");
  } finally { server.close(); }
});