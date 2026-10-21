"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DEFAULTS, makeConfig } from "../src/config.js";
import { resolveConfiguredDir, embedRegistry } from "../src/embed/registry.js";
import { artifactDir, defaultRegistryPath } from "../src/models/registry.js";

test("G3.2 schema 默认模型路径不含作者机绝对路径", () => {
  assert.equal(DEFAULTS.embedder_model, "");
  assert.equal(DEFAULTS.embedder_model_last, "");
  assert.doesNotMatch(JSON.stringify(DEFAULTS), /"embedder_model(?:_last)?":"[A-Za-z]:[\\/]/);
});

test("G3.2 resolveConfiguredDir：空值回退 registry artifactDir，显式值优先", () => {
  const cfg = makeConfig({ embed_backend: "local" });
  const reg = embedRegistry();
  const expected = artifactDir(reg, defaultRegistryPath(), "local:int8-256", undefined);
  assert.equal(resolveConfiguredDir(cfg, "embedder_model"), expected);
  assert.equal(resolveConfiguredDir({ ...cfg, embedder_model: "C:/custom-model" }, "embedder_model"), "C:/custom-model");
  assert.equal(resolveConfiguredDir(cfg, "not_a_model_field"), "");
  assert.ok(path.isAbsolute(resolveConfiguredDir(cfg, "embedder_model_last")));
});

test("G3.2 registry models 的 local artifact 有 sha/bytes 事实", () => {
  const reg = embedRegistry();
  for (const id of ["local:int8-256", "local:pca64-int8"]) {
    const a = reg.artifacts.find(x => x.id === id);
    assert.ok(a, "缺 artifact " + id);
    assert.ok(a.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0), id + " 文件缺少 sha/bytes");
  }
});