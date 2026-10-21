import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { probeOnnx, OnnxEmbedder } from "../src/embed/onnx.js";
import { makeEmbedder } from "../src/screening/semantic.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";
import { loadRegistry } from "../src/models/registry.js";

const TOOL = path.join(import.meta.dirname, "..", "tools", "fetch-models.js");

test("registry：onnx:e5-small 为 optional 且 pin 了 model/tokenizer", () => {
  const { registry } = loadRegistry();
  const a = registry.artifacts.find(x => x.id === "onnx:e5-small");
  assert.ok(a);
  assert.equal(a.optional, true);
  assert.equal(a.repo, "Xenova/multilingual-e5-small");
  const model = a.files.find(f => f.path === "onnx/model_quantized.onnx");
  assert.equal(model.bytes, 118308185);
  assert.match(model.sha256, /^f80102d3/);
  const tok = a.files.find(f => f.path === "tokenizer.json");
  assert.equal(tok.bytes, 17082730);
});

test("probeOnnx：能力探针可用性判定（未装依赖时给错误）", async () => {
  const probe = await probeOnnx();
  assert.equal(typeof probe.available, "boolean");
  if (!probe.available) assert.match(probe.error, /onnxruntime-node/);
});

test("embed_backend=onnx 未装依赖：可操作错误（含安装/下载提示）", async () => {
  const probe = await probeOnnx();
  const emb = makeEmbedder(makeConfig({ embed_backend: "onnx" }));
  if (!probe.available) {
    await assert.rejects(emb.fitTransform(["x"]), err => {
      assert.match(String(err.message), /onnxruntime-node/);
      assert.match(String(err.message), /models ensure --include onnx/);
      return true;
    });
  } else {
    // 已安装依赖的环境：只断言能构造（模型未下载时也应给可操作错误）
    await assert.rejects(emb.fitTransform(["x"]), err => /models ensure --include onnx|onnxruntime/.test(String(err.message)));
  }
});

test("default 路径不变：embed_backend 默认 chain；--embed-backend onnx 可解析", () => {
  assert.equal(makeConfig().embed_backend, "chain");
  const parsed = parseCli(["--corpus", "c", "--out", "o", "--embed-backend", "onnx"]);
  assert.equal(parsed.overrides.embed_backend, "onnx");
  const cfg = makeConfig();
  assert.equal(typeof OnnxEmbedder, "function");
  assert.ok(cfg.onnx_max_tokens >= 8);
});

test("fetch-models --include onnx --dry-run：列出 pinned URL/sha 且不联网", () => {
  const r = spawnSync(process.execPath, [TOOL, "--include", "onnx", "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /resolve\/main\/onnx\/model_quantized\.onnx/);
  assert.match(r.stdout, /sha256=f80102d3/);
  assert.match(r.stdout, /可选/);
});