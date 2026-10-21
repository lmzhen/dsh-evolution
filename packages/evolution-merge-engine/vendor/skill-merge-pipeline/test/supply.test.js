"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { supplyLocalModels, dirsReady, configuredDirs } from "../src/models/supply.js";
import { validateRegistry } from "../src/models/registry.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";
import { makeConfig } from "../src/config.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIX = path.join(__dirname, "..", "parity", "fixtures", "build");
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = p => sha(fs.readFileSync(p));
const read = p => fs.readFileSync(p);
const tinyTok = Buffer.from(JSON.stringify({ version: "1.0", model: { type: "Unigram", unk_id: 0, vocab: [["\u2581", -1], ["a", -2], ["b", -3], ["ab", -1.5]] }, normalizer: null, pre_tokenizer: null }));
const BASE_MODEL = read(path.join(FIX, "base", "model.safetensors"));
const BASE_CFG = read(path.join(FIX, "base", "config.json"));
const PROJ = read(path.join(FIX, "base", "proj.f32"));
const EXP = path.join(FIX, "expected");
const TOK_SHA = sha(tinyTok);
const RECIPES = {
  "fp16-cast": { builderVer: 1, params: { configPatch: { embedding_dtype: "float16" } } },
  "int8-per-row": { builderVer: 1, params: { scalesFile: "scales.f32", configPatch: { embedding_dtype: "int8", quantization: "per_row_symmetric", scales_file: "scales.f32", source_model: "potion-multilingual-128M-F16" } } },
  "pca-project-int8": { builderVer: 1, params: { dims: 2, scalesFile: "scales.f32", configPatch: { hidden_dim: 2, embedding_dtype: "int8", quantization: "per_row_symmetric", scales_file: "scales.f32", pca_proj_file: "pca_proj.f32", pca_dims: 2, orig_hidden_dim: 4, source_model: "potion-multilingual-128M-F16", pca_fit: "fixture" } } }
};
const feB = (buf, name) => ({ path: name, sha256: sha(buf), bytes: buf.length });
const feF = (p, name) => ({ path: name, sha256: fileSha(p), bytes: fs.statSync(p).size });
const REG = validateRegistry({
  schemaVersion: 1, modelsRoot: "models", recipes: RECIPES,
  artifacts: [
    { id: "base-f32", kind: "source", origin: "hf", repo: "acme/base", target: "base-f32", files: [feB(BASE_MODEL, "model.safetensors"), feB(BASE_CFG, "config.json"), feB(tinyTok, "tokenizer.json")] },
    { id: "pca64-proj", kind: "source", origin: "hf", repo: "acme/proj", target: "pca64", files: [feB(PROJ, "proj.f32")] },
    { id: "base-f16", kind: "derived", recipe: "fp16-cast", base: "base-f32", target: "base-f16", manifest: { dtype: "F16", dim: 4, rows: 7, tokenizerSha: TOK_SHA, builderVer: 1 }, files: [feF(path.join(EXP, "f16_model.safetensors"), "model.safetensors"), feF(path.join(EXP, "f16_config.json"), "config.json"), feB(tinyTok, "tokenizer.json")] },
    { id: "local:int8-256", kind: "derived", recipe: "int8-per-row", base: "base-f16", target: "int8", manifest: { dtype: "I8", dim: 4, rows: 7, tokenizerSha: TOK_SHA, scalesDtype: "F32", builderVer: 1 }, files: [feF(path.join(EXP, "int8_model.safetensors"), "model.safetensors"), feF(path.join(EXP, "int8_scales.f32"), "scales.f32"), feF(path.join(EXP, "int8_config.json"), "config.json"), feB(tinyTok, "tokenizer.json")] },
    { id: "local:pca64-int8", kind: "derived", recipe: "pca-project-int8", base: "base-f16", proj: "pca64-proj", target: "pca", manifest: { dtype: "I8", dim: 2, rows: 7, tokenizerSha: TOK_SHA, scalesDtype: "F32", projSha: sha(PROJ), builderVer: 1, reproducibility: "numeric" }, files: [feF(path.join(EXP, "pca_model.safetensors"), "model.safetensors"), feF(path.join(EXP, "pca_scales.f32"), "scales.f32"), feF(path.join(EXP, "pca_config.json"), "config.json"), feB(tinyTok, "tokenizer.json")] }
  ],
  models: [
    { id: "local:int8-256", provider: "local", compute: "local-static", artifactRef: "local:int8-256", overrideField: "embedder_model", floors: { body: 0.95, summary: 0.6 } },
    { id: "local:pca64-int8", provider: "local", compute: "local-static", artifactRef: "local:pca64-int8", overrideField: "embedder_model_last", floors: { body: 0.95, summary: 0.6 } }
  ],
  tiers: [
    { id: "local:int8-256", modelRef: "local:int8-256", floorPreset: "local:int8-256" },
    { id: "local:pca64-int8", modelRef: "local:pca64-int8", floorPreset: "local:pca64-int8" }
  ],
  calibration: null
});
const state = { requests: 0 };
const server = http.createServer((req, res) => {
  state.requests += 1;
  const last = req.url.split("/").pop();
  let body = null;
  if (last === "model.safetensors") body = BASE_MODEL;
  else if (last === "config.json") body = BASE_CFG;
  else if (last === "tokenizer.json") body = tinyTok;
  else if (last === "proj.f32") body = PROJ;
  if (!body) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Length": body.length });
  res.end(body);
});
let ENDPOINT = "";
const tmps = [];
after(() => { server.close(); for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } } });
function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-supply-"));
  tmps.push(dir);
  const modelsDir = path.join(dir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  const regFile = path.join(modelsDir, "registry.json");
  fs.writeFileSync(regFile, JSON.stringify(REG));
  return { dir, modelsDir, regFile };
}
function mgdCfg(modelsDir) { return makeConfig({ models_dir: modelsDir, embedder_model: "D:/nonexistent-int8", embedder_model_last: "D:/nonexistent-pca", offline: false, auto_provision: true }); }

test("setup", async () => { await new Promise(r => server.listen(0, "127.0.0.1", r)); ENDPOINT = "http://127.0.0.1:" + server.address().port; });

test("managed 空目录：下载+构建+回写 cfg；二次零网络", async () => {
  const R = makeRoot();
  const cfg = mgdCfg(R.modelsDir);
  const before = state.requests;
  const res = await supplyLocalModels({ cfg, registry: REG, registryFile: R.regFile, rootDir: R.modelsDir, endpoint: ENDPOINT, allowInsecure: true });
  assert.equal(state.requests > before, true);
  assert.ok(res.downloaded.includes("base-f32"));
  assert.ok(res.built.includes("local:int8-256"));
  assert.equal(cfg.embedder_model, path.join(R.modelsDir, "int8"));
  assert.equal(cfg.embedder_model_last, path.join(R.modelsDir, "pca"));
  assert.equal(dirsReady(configuredDirs(cfg)), true);
  const afterFirst = state.requests;
  const cfg2 = mgdCfg(R.modelsDir);
  const res2 = await supplyLocalModels({ cfg: cfg2, registry: REG, registryFile: R.regFile, rootDir: R.modelsDir, endpoint: ENDPOINT, allowInsecure: true });
  assert.equal(state.requests, afterFirst, "二次供给不得联网");
  assert.equal(res2.built.length, 0);
});

test("offline 空目录：ModelMissingError，exitCode=2，可操作信息", async () => {
  const R = makeRoot();
  const cfg = makeConfig({ models_dir: R.modelsDir, offline: true, auto_provision: true, embedder_model: "D:/nonexistent-int8", embedder_model_last: "D:/nonexistent-pca" });
  await assert.rejects(supplyLocalModels({ cfg, registry: REG, registryFile: R.regFile, rootDir: R.modelsDir }), err => {
    const d = toDiagnostic(err);
    assert.equal(d.code, DiagnosticCode.MODEL_MISSING);
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /offline 模式缺少模型/);
    return true;
  });
});

test("no-auto-provision：只校验并提示", async () => {
  const R = makeRoot();
  const cfg = makeConfig({ models_dir: R.modelsDir, auto_provision: false, embedder_model: "D:/nonexistent-int8", embedder_model_last: "D:/nonexistent-pca" });
  await assert.rejects(supplyLocalModels({ cfg, registry: REG, registryFile: R.regFile, rootDir: R.modelsDir }), err => {
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /models ensure/);
    return true;
  });
});

test("fast path：配置目录就绪且未 managed ⇒ 跳过，零网络", async () => {
  const INT8 = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
  const PCA = "D:/dsh/skill-merge/models/potion-multilingual-128M-pca64-int8";
  if (!fs.existsSync(path.join(INT8, "config.json"))) return;
  const cfg = makeConfig({ embedder_model: INT8, embedder_model_last: PCA });
  const before = state.requests;
  const res = await supplyLocalModels({ cfg, fetchImpl: () => { throw new Error("不应联网"); } });
  assert.equal(res.skipped, true);
  assert.equal(res.managed, false);
  assert.equal(state.requests, before);
  assert.deepEqual(res.dirs, { int8: INT8, pca: PCA });
});