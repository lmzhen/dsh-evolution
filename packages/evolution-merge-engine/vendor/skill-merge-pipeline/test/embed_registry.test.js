"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, validateRegistry } from "../src/models/registry.js";
import { resolveChain, floorsFor } from "../src/embed/registry.js";
import { makeConfig } from "../src/config.js";
import { makeEmbedder } from "../src/screening/semantic.js";

const { registry } = loadRegistry();
const clone = () => JSON.parse(JSON.stringify(registry));

test("registry：models/tiers 数据齐备", () => {
  assert.equal(registry.models.length, 4);
  assert.equal(registry.tiers.length, 4);
  assert.deepEqual(registry.tiers.map(t => t.id), ["qwen3-embedding-8b", "bge-m3", "local:int8-256", "local:pca64-int8"]);
  assert.equal(registry.models.find(m => m.id === "local:int8-256").artifactRef, "local:int8-256");
});

test("resolveChain(chain)：顺序/kind/override/effectiveModel 与现状一致", () => {
  const cfg = makeConfig({ embed_backend: "chain" });
  const res = resolveChain(cfg, registry);
  assert.equal(res.mode, "chain");
  assert.deepEqual(res.tiers.map(t => t.tier), ["qwen3-embedding-8b", "bge-m3", "local:int8-256", "local:pca64-int8"]);
  assert.deepEqual(res.tiers.map(t => t.kind), ["remote", "remote", "local", "local"]);
  assert.equal(res.tiers[0].effectiveModel, "Qwen/Qwen3-Embedding-8B");
  assert.equal(res.tiers[1].effectiveModel, "BAAI/bge-m3");
  assert.equal(res.tiers[3].overrideField, "embedder_model_last");
  const over = resolveChain(makeConfig({ embed_backend: "chain", embed_primary: "X/Qwen", embed_fallback: "X/bge" }), registry);
  assert.equal(over.tiers[0].effectiveModel, "X/Qwen");
  assert.equal(over.tiers[1].effectiveModel, "X/bge");
});

test("resolveChain(local/remote)：单档语义与 Python 一致", () => {
  const local = resolveChain(makeConfig({ embed_backend: "local" }), registry);
  assert.equal(local.tiers.length, 1);
  assert.equal(local.tiers[0].tier, "local:int8-256");
  assert.equal(local.tiers[0].kind, "local");
  const remote = resolveChain(makeConfig({ embed_backend: "remote" }), registry);
  assert.equal(remote.tiers.length, 1);
  assert.equal(remote.tiers[0].tier, "qwen3-embedding-8b");
  assert.equal(remote.tiers[0].kind, "remote");
});

test("数据驱动：改 tiers 顺序无需改代码", () => {
  const r = clone();
  r.tiers.reverse();
  const res = resolveChain(makeConfig({ embed_backend: "chain" }), r);
  assert.deepEqual(res.tiers.map(t => t.tier), ["local:pca64-int8", "local:int8-256", "bge-m3", "qwen3-embedding-8b"]);
});

test("floorsFor：cfg 预设优先；缺预设时用 registry.floors；再退 local 预设", () => {
  const cfg = makeConfig();
  assert.deepEqual(floorsFor(cfg, registry, "local:int8-256"), { body_core: 0.95, summary: 0.6 });
  const r = clone();
  r.models.find(m => m.id === "local:int8-256").floors = { body: 0.11, summary: 0.22 };
  assert.deepEqual(floorsFor(makeConfig({ embed_floor_presets: {} }), r, "local:int8-256"), { body_core: 0.11, summary: 0.22 });
  assert.deepEqual(floorsFor(makeConfig(), r, "local:int8-256"), { body_core: 0.95, summary: 0.6 });
  const f = floorsFor(makeConfig({ embed_floor_presets: {}, semantic_body_floor: 0.7, semantic_summary_floor: 0.4 }), r, "unknown-tier");
  assert.deepEqual(f, { body_core: 0.7, summary: 0.4 });
});

test("floorsFor：calibration 优先级高于 model.floors，cfg 预设仍最高", () => {
  const r = clone();
  r.calibration = { version: 1, samplesSha: "a".repeat(64), n: 50, floors: { "local:int8-256": { body: 0.33, summary: 0.44 } } };
  assert.deepEqual(floorsFor(makeConfig({ embed_floor_presets: {} }), r, "local:int8-256"), { body_core: 0.33, summary: 0.44 });
  assert.deepEqual(floorsFor(makeConfig(), r, "local:int8-256"), { body_core: 0.95, summary: 0.6 });
});

test("calibration 校验：坏字段/未知 tier 拒绝", () => {
  const cases = [];
  const c1 = clone(); c1.calibration = { version: 1, samplesSha: "a".repeat(64), n: 10, floors: { "local:int8-256": { body: 0.3, summary: 0.4 } } }; cases.push([c1, null]);
  const c2 = clone(); c2.calibration = { version: 1, samplesSha: "short", n: 10, floors: { "local:int8-256": { body: 0.3, summary: 0.4 } } }; cases.push([c2, /samplesSha/]);
  const c3 = clone(); c3.calibration = { version: 1, samplesSha: "a".repeat(64), n: 10, floors: { "nope-tier": { body: 0.3, summary: 0.4 } } }; cases.push([c3, /未知 tier/]);
  const c4 = clone(); c4.calibration = { version: 1, samplesSha: "a".repeat(64), n: 10, floors: { "local:int8-256": { body: 0.3 } } }; cases.push([c4, /floors/]);
  for (const [r, re] of cases) { if (!re) assert.doesNotThrow(() => validateRegistry(r)); else assert.throws(() => validateRegistry(r), re); }
});

test("registry 校验：坏 modelRef / 缺 floors / 坏 compute / 重复 model id 均拒绝", () => {
  const cases = [];
  const c1 = clone(); c1.tiers[0].modelRef = "nope"; cases.push([c1, /modelRef/]);
  const c2 = clone(); delete c2.models[0].floors; cases.push([c2, /floors/]);
  const c3 = clone(); c3.models[0].compute = "gpu"; cases.push([c3, /compute/]);
  const c4 = clone(); c4.models[1].id = c4.models[0].id; cases.push([c4, /重复/]);
  const c5 = clone(); c5.models[2].artifactRef = "nope"; cases.push([c5, /artifactRef/]);
  for (const [r, re] of cases) assert.throws(() => validateRegistry(r), re);
});

test("makeEmbedder(chain) 惰性构造（不触发网络/模型加载）", () => {
  const emb = makeEmbedder(makeConfig({ embed_backend: "chain" }));
  assert.equal(emb.constructor.name, "ChainEmbedder");
  assert.equal(emb.chosen, null);
});