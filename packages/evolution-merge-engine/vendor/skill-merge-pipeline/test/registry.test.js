"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  REGISTRY_SCHEMA_VERSION, validateRegistry, loadRegistry, modelsRootOf, artifactById, artifactDir, verifyArtifact
} from "../src/models/registry.js";

const LOCAL_ROOT = "D:/dsh/skill-merge/models";
const { file, registry } = loadRegistry();
const clone = () => JSON.parse(JSON.stringify(registry));

test("默认 registry：schema/分区/引用闭合", () => {
  assert.equal(registry.schemaVersion, REGISTRY_SCHEMA_VERSION);
  assert.equal(registry.artifacts.length, 7);
  assert.equal(Object.keys(registry.recipes).length, 3);
  const ids = registry.artifacts.map(a => a.id).sort();
  assert.deepEqual(ids, ["local:int8-256", "local:pca64-int8", "onnx:e5-small", "pca64-proj", "potion-base-f16", "potion-base-f32", "ranker:startlux-0.8b"]);
  const pca = artifactById(registry, "local:pca64-int8");
  assert.equal(pca.base, "potion-base-f16");
  assert.equal(pca.proj, "pca64-proj");
  assert.equal(pca.manifest.dim, 64);
  assert.equal(artifactById(registry, "local:int8-256").manifest.dim, 256);
});

test("严格校验：未知字段/重复 id/坏 sha/引用缺失/越界 target 均拒绝", () => {
  const cases = [];
  const c1 = clone(); c1.unknown = 1; cases.push([c1, /未知字段/]);
  const c2 = clone(); c2.artifacts[0].weird = 1; cases.push([c2, /未知字段/]);
  const c3 = clone(); c3.artifacts[1].id = c3.artifacts[0].id; cases.push([c3, /重复/]);
  const c4 = clone(); c4.artifacts[1].files[0].sha256 = "xyz"; cases.push([c4, /sha256/]);
  const c5 = clone(); delete c5.artifacts[1].manifest; cases.push([c5, /manifest/]);
  const c6 = clone(); c6.artifacts[1].recipe = "nope"; cases.push([c6, /recipe/]);
  const c7 = clone(); c7.artifacts[1].base = "nope"; cases.push([c7, /base 不存在/]);
  const c8 = clone(); c8.artifacts[1].target = "../evil"; cases.push([c8, /target/]);
  const c9 = clone(); delete c9.artifacts[0].repo; cases.push([c9, /repo/]);
  const c10 = clone(); c10.models = {}; cases.push([c10, /models/]);
  const c11 = clone(); const opt = c11.artifacts.find(a => a.id === "ranker:startlux-0.8b"); opt.optional = "yes"; cases.push([c11, /optional/]);
  for (const [c, re] of cases) assert.throws(() => validateRegistry(c), re);
});

test("modelsRoot：默认解析到 node/models，env 与显式 override 生效", () => {
  const def = modelsRootOf(registry, file);
  assert.equal(def, path.resolve(__dirname, "..", "models"));
  const old = process.env.SKILL_MERGE_MODELS_ROOT;
  process.env.SKILL_MERGE_MODELS_ROOT = LOCAL_ROOT;
  try { assert.equal(modelsRootOf(registry, file), path.resolve(LOCAL_ROOT)); } finally {
    if (old === undefined) delete process.env.SKILL_MERGE_MODELS_ROOT; else process.env.SKILL_MERGE_MODELS_ROOT = old;
  }
  assert.equal(modelsRootOf(registry, file, LOCAL_ROOT), path.resolve(LOCAL_ROOT));
});

test("路径安全：artifactDir 不越出 modelsRoot", () => {
  assert.equal(artifactDir(registry, file, "pca64-proj"), path.join(path.resolve(__dirname, "..", "models"), "pca64"));
  const c = clone(); c.artifacts[0].target = "../../escape";
  assert.throws(() => validateRegistry(c), /target/);
});

test("verifyArtifact：本地产物全文件 sha+bytes 一致（fp16/int8/pca64/proj）", () => {
  const opt = { rootDir: LOCAL_ROOT };
  for (const id of ["potion-base-f16", "local:int8-256", "local:pca64-int8"]) {
    const r = verifyArtifact(registry, file, id, opt);
    assert.equal(r.ok, true, id + " 校验失败: " + JSON.stringify(r));
  }
  const proj = verifyArtifact(registry, file, "pca64-proj");
  assert.equal(proj.ok, true);
  const base = verifyArtifact(registry, file, "potion-base-f32", { rootDir: LOCAL_ROOT, hash: false });
  assert.equal(base.ok, false);
  assert.ok(base.missing.includes("model.safetensors"));
});

test("verifyArtifact：size 不符可诊断", () => {
  const c = clone();
  c.artifacts.find(a => a.id === "local:int8-256").files[0].bytes += 1;
  const r = verifyArtifact(c, file, "local:int8-256", { rootDir: LOCAL_ROOT, hash: false });
  assert.equal(r.ok, false);
  assert.equal(r.mismatched[0].reason, "size");
});