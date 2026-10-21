"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolveModels } from "../src/models/firstrun.js";
import { validateRegistry } from "../src/models/registry.js";
import { StreamedStaticEmbedder } from "../src/screening/semantic.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIX = path.join(__dirname, "..", "parity", "fixtures", "build");
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = p => sha(fs.readFileSync(p));
const read = p => fs.readFileSync(p);
const tinyTok = Buffer.from(JSON.stringify({ version: "1.0", model: { type: "Unigram", unk_id: 0, vocab: [["\u2581", -1], ["a", -2], ["b", -3], ["ab", -1.5]] }, normalizer: null, pre_tokenizer: null }));
const BASE_MODEL = read(path.join(FIX, "base", "model.safetensors"));
const BASE_CFG = read(path.join(FIX, "base", "config.json"));
const PROJ = read(path.join(FIX, 'base', 'proj.f32'));
const EXP = path.join(FIX, "expected");
const TOK_SHA = sha(tinyTok);
const OPT = Buffer.from("OPTIONAL-RANKER");

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
    { id: "optional-x", kind: "source", origin: "hf", repo: "acme/opt", target: "opt", optional: true, files: [feB(OPT, "opt.bin")] },
    { id: "base-f16", kind: "derived", recipe: "fp16-cast", base: "base-f32", target: "base-f16", manifest: { dtype: "F16", dim: 4, rows: 7, tokenizerSha: TOK_SHA, builderVer: 1 }, files: [feF(path.join(EXP, "f16_model.safetensors"), "model.safetensors"), feF(path.join(EXP, "f16_config.json"), "config.json"), feB(tinyTok, "tokenizer.json")] },
    { id: "local:int8-256", kind: "derived", recipe: "int8-per-row", base: "base-f16", target: "int8", manifest: { dtype: "I8", dim: 4, rows: 7, tokenizerSha: TOK_SHA, scalesDtype: "F32", builderVer: 1 }, files: [feF(path.join(EXP, "int8_model.safetensors"), "model.safetensors"), feF(path.join(EXP, "int8_scales.f32"), "scales.f32"), feF(path.join(EXP, "int8_config.json"), "config.json"), feB(tinyTok, "tokenizer.json")] },
    { id: "local:pca64-int8", kind: "derived", recipe: "pca-project-int8", base: "base-f16", proj: "pca64-proj", target: "pca", manifest: { dtype: "I8", dim: 2, rows: 7, tokenizerSha: TOK_SHA, scalesDtype: "F32", projSha: sha(PROJ), builderVer: 1, reproducibility: "numeric" }, files: [feF(path.join(EXP, "pca_model.safetensors"), "model.safetensors"), feF(path.join(EXP, "pca_scales.f32"), "scales.f32"), feF(path.join(EXP, "pca_config.json"), "config.json"), feB(tinyTok, "tokenizer.json")] }
  ], models: [], tiers: [], calibration: null
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
  else if (last === "opt.bin") body = OPT;
  if (!body) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Length": body.length });
  res.end(body);
});
let ENDPOINT = "";
const tmps = [];
after(() => { server.close(); for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } } });

function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-first-"));
  tmps.push(dir);
  const modelsDir = path.join(dir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  const regFile = path.join(modelsDir, "registry.json");
  fs.writeFileSync(regFile, JSON.stringify(REG));
  return { dir, modelsDir, regFile };
}
function opts(extra) { return Object.assign({ registry: REG, registryFile: null, rootDir: null, endpoint: ENDPOINT, allowInsecure: true, autoProvision: true }, extra || {}); }

test("setup 服务器", async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  ENDPOINT = "http://127.0.0.1:" + server.address().port;
});

test("空目录 → 下载+构建 → int8/pca 可编码；进度事件齐全", async () => {
  const R = makeRoot();
  const progress = [];
  const r = await resolveModels(opts({ registryFile: R.regFile, rootDir: R.modelsDir, onProgress: e => progress.push(e) }));
  assert.deepEqual(r.verified, []);
  assert.ok(r.downloaded.includes("base-f32"));
  assert.ok(r.downloaded.includes("pca64-proj"));
  assert.deepEqual(r.built.sort(), ["base-f16", "local:int8-256", "local:pca64-int8"]);
  assert.equal(r.downloaded.includes("optional-x"), false);
  assert.deepEqual(r.optionalMissing, ["optional-x"]);
  assert.equal(Object.keys(r.dirs).length, 5);
  const int8 = new StreamedStaticEmbedder(r.dirs["local:int8-256"], { cache: false });
  const vecs = await int8.fitTransform(["ab", "a"]);
  assert.equal(vecs.length, 2);
  assert.equal(vecs[0].length, 4);
  for (const v of vecs) for (const x of v) assert.equal(Number.isFinite(x), true);
  const pca = new StreamedStaticEmbedder(r.dirs["local:pca64-int8"], { cache: false });
  const pv = await pca.fitTransform(["ab"]);
  assert.equal(pv[0].length, 2);
  assert.ok(progress.some(e => e.phase === "rows"), "缺构建进度");
  assert.ok(progress.some(e => e.file === "model.safetensors"), "缺下载进度");
});

test("二次运行：零网络、全 verified、仍可编码", async () => {
  const R = makeRoot();
  await resolveModels(opts({ registryFile: R.regFile, rootDir: R.modelsDir }));
  const before = state.requests;
  const r = await resolveModels(opts({ registryFile: R.regFile, rootDir: R.modelsDir, fetchImpl: () => { throw new Error("不应联网"); } }));
  assert.equal(state.requests, before);
  assert.equal(r.verified.length, 5);
  assert.deepEqual(r.downloaded, []);
  assert.deepEqual(r.built, []);
  const int8 = new StreamedStaticEmbedder(r.dirs["local:int8-256"], { cache: false });
  const v = await int8.fitTransform(["ab"]);
  assert.equal(v[0].length, 4);
});

test("offline 空目录：可操作 ModelMissingError（含路径/sha/bytes）", async () => {
  const R = makeRoot();
  await assert.rejects(resolveModels(opts({ registryFile: R.regFile, rootDir: R.modelsDir, offline: true, fetchImpl: () => { throw new Error("不应联网"); } })), err => {
    assert.equal(toDiagnostic(err).code, DiagnosticCode.MODEL_MISSING);
    assert.match(err.message, /offline 模式缺少模型/);
    assert.match(err.message, /sha256=/);
    assert.match(err.message, /bytes=/);
    assert.match(err.message, /手动放置/);
    return true;
  });
});

test("no-auto-provision：只校验并给 models ensure 提示", async () => {
  const R = makeRoot();
  await assert.rejects(resolveModels(opts({ registryFile: R.regFile, rootDir: R.modelsDir, autoProvision: false })), err => {
    assert.equal(toDiagnostic(err).code, DiagnosticCode.MODEL_MISSING);
    assert.match(err.message, /models ensure/);
    return true;
  });
});

test("配置：auto_provision 默认 false（离线优先），--auto-provision 置 true", () => {
  assert.equal(makeConfig().auto_provision, false);
  const r = parseCli(["--corpus", "c", "--out", "o", "--auto-provision"]);
  assert.equal(r.overrides.auto_provision, true);
});