"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../src/config.js";
import { StaticTable } from "../src/embed/static_table.js";
import { RemoteEmbedder } from "../src/embed/remote.js";
import { OnnxEmbedder } from "../src/embed/onnx.js";
import { ChainEmbedder } from "../src/embed/chain.js";
import { KNOWN_EMBED_BACKENDS, assertKnownBackend, assertEmbedderContract } from "../src/embed/provider.js";
import { makeEmbedder, StreamedStaticEmbedder, TfidfEmbedder } from "../src/screening/semantic.js";

test("G4.2 四个核心 provider 都有 encode 方法", () => {
  for (const C of [StaticTable, RemoteEmbedder, OnnxEmbedder, ChainEmbedder, StreamedStaticEmbedder, TfidfEmbedder]) {
    assert.equal(typeof C.prototype.encode, "function", C.name + " 缺 encode");
  }
});

test("G4.2 backend 白名单与未知值点名", () => {
  assert.deepEqual([...KNOWN_EMBED_BACKENDS], ["chain", "local", "remote", "onnx"]);
  assert.equal(assertKnownBackend({ embed_backend: "chain" }), "chain");
  assert.throws(() => assertKnownBackend({ embed_backend: "bogus" }), /未知 embed_backend: bogus/);
  const fake = { fitTransform: async () => [] };
  assert.throws(() => assertEmbedderContract(fake), /encode/);
});

test("G4.2 tfidf provider 的 encode 返回 number[][]", async () => {
  const emb = makeEmbedder(makeConfig({ embed_backend: "local", embedder: "tfidf" }));
  const out = await emb.encode(["alpha", "beta"]);
  assert.equal(out.length, 2);
  assert.equal(Array.isArray(out[0]), true);
  assert.equal(out[0].length > 0, true);
});

test("G4.2 未知 embedder/backend 启动即错", () => {
  const cfg = makeConfig({ embed_backend: "local", embedder: "tfidf" });
  assert.throws(() => makeEmbedder({ ...cfg, embedder: "bogus" }), /未知 embedder provider: bogus/);
  assert.throws(() => makeEmbedder({ ...cfg, embed_backend: "bogus" }), /未知 embed_backend: bogus/);
});