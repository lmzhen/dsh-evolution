"use strict";
import test from "node:test";
import { verifyArtifact } from "../src/models/registry.js";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { buildArtifact, ensureModels } from "../src/models/build.js";
import { validateRegistry } from "../src/models/registry.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIX = path.join(__dirname, "..", "parity", "fixtures", "build");
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = p => sha(fs.readFileSync(p));
const bytes = p => fs.readFileSync(p);
const fileEntry = (p, name) => ({ path: name, sha256: fileSha(p), bytes: fs.statSync(p).size });

const BASE_MODEL = path.join(FIX, "base", "model.safetensors");
const BASE_CFG = path.join(FIX, "base", "config.json");
const BASE_TOK = path.join(FIX, "base", "tokenizer.json");
const PROJ = path.join(FIX, "base", "proj.f32");
const EXP = path.join(FIX, "expected");
const META = JSON.parse(fs.readFileSync(path.join(EXP, "meta.json"), "utf8"));
const TOK_SHA = fileSha(BASE_TOK);

const RECIPES = {
  "fp16-cast": { builderVer: 1, params: { configPatch: { embedding_dtype: "float16" } } },
  "int8-per-row": { builderVer: 1, params: { scalesFile: "scales.f32", configPatch: { embedding_dtype: "int8", quantization: "per_row_symmetric", scales_file: "scales.f32", source_model: "potion-multilingual-128M-F16" } } },
  "pca-project-int8": { builderVer: 1, params: { dims: 2, scalesFile: "scales.f32", configPatch: { hidden_dim: 2, embedding_dtype: "int8", quantization: "per_row_symmetric", scales_file: "scales.f32", pca_proj_file: "pca_proj.f32", pca_dims: 2, orig_hidden_dim: 4, source_model: "potion-multilingual-128M-F16", pca_fit: "fixture" } } }
};

function makeRegistry() {
  return validateRegistry({
    schemaVersion: 1, modelsRoot: "models", recipes: RECIPES,
    artifacts: [
      { id: "base-f32", kind: "source", origin: "repo", target: "base-f32", files: [fileEntry(BASE_MODEL, "model.safetensors"), fileEntry(BASE_CFG, "config.json"), fileEntry(BASE_TOK, "tokenizer.json")] },
      { id: "pca64-proj", kind: "source", origin: "repo", target: "pca64", files: [fileEntry(PROJ, "proj.f32")] },
      { id: "base-f16", kind: "derived", recipe: "fp16-cast", base: "base-f32", target: "base-f16",
        manifest: { dtype: "F16", dim: 4, rows: 7, tokenizerSha: TOK_SHA, builderVer: 1 },
        files: [fileEntry(path.join(EXP, "f16_model.safetensors"), "model.safetensors"), fileEntry(path.join(EXP, "f16_config.json"), "config.json"), fileEntry(BASE_TOK, "tokenizer.json")] },
      { id: "int8", kind: "derived", recipe: "int8-per-row", base: "base-f16", target: "int8",
        manifest: { dtype: "I8", dim: 4, rows: 7, tokenizerSha: TOK_SHA, scalesDtype: "F32", builderVer: 1 },
        files: [fileEntry(path.join(EXP, "int8_model.safetensors"), "model.safetensors"), fileEntry(path.join(EXP, "int8_scales.f32"), "scales.f32"), fileEntry(path.join(EXP, "int8_config.json"), "config.json"), fileEntry(BASE_TOK, "tokenizer.json")] },
      { id: "pca", kind: "derived", recipe: "pca-project-int8", base: "base-f16", proj: "pca64-proj", target: "pca",
        manifest: { dtype: "I8", dim: 2, rows: 7, tokenizerSha: TOK_SHA, scalesDtype: "F32", projSha: fileSha(PROJ), builderVer: 1 },
        files: [fileEntry(path.join(EXP, "pca_model.safetensors"), "model.safetensors"), fileEntry(path.join(EXP, "pca_scales.f32"), "scales.f32"), fileEntry(path.join(EXP, "pca_config.json"), "config.json"), fileEntry(BASE_TOK, "tokenizer.json")] }
    ],
    models: [], tiers: [], calibration: null
  });
}

function makeRoot(seedSources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-build-"));
  const modelsDir = path.join(dir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  const regFile = path.join(modelsDir, "registry.json");
  const reg = makeRegistry();
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const place = (sub, map) => {
    fs.mkdirSync(path.join(modelsDir, sub), { recursive: true });
    for (const [name, src] of Object.entries(map)) fs.copyFileSync(src, path.join(modelsDir, sub, name));
  };
  if (seedSources !== false) {
    place("base-f32", { "model.safetensors": BASE_MODEL, "config.json": BASE_CFG, "tokenizer.json": BASE_TOK });
    place("pca64", { "proj.f32": PROJ });
  }
  return { dir, modelsDir, regFile, reg };
}

function cos(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i += 1) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); }
function dataOffsetOf(modelBytes) { const hlen = Number(modelBytes.readBigUInt64LE(0)); const pad = (8 - ((8 + hlen) % 8)) % 8; return 8 + hlen + pad; }
function dequant(modelBytes, scalesBytes) {
  const off = dataOffsetOf(modelBytes);
  const n = scalesBytes.length / 4; const dims = (modelBytes.length - off) / n;
  const out = []; for (let r = 0; r < n; r += 1) { const sc = scalesBytes.readFloatLE(r * 4); const row = []; for (let d = 0; d < dims; d += 1) row.push(modelBytes.readInt8(off + r * dims + d) * sc); out.push(row); }
  return out;
}

const roots = [];
after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (e) { /* ignore */ } } });

test("fp16-cast：与 Python 产物字节一致 + 确定性 + 缓存命中", async () => {
  const R = makeRoot(); roots.push(R.dir);
  const out = path.join(R.modelsDir, "base-f16");
  const r1 = await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "base-f16" });
  assert.equal(r1.built, true);
  assert.deepEqual(bytes(path.join(out, "model.safetensors")), bytes(path.join(EXP, "f16_model.safetensors")));
  assert.deepEqual(bytes(path.join(out, "config.json")), bytes(path.join(EXP, "f16_config.json")));
  assert.deepEqual(bytes(path.join(out, "tokenizer.json")), bytes(BASE_TOK));
  const r2 = await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "base-f16" });
  assert.equal(r2.built, false);
  const h1 = fileSha(path.join(out, "model.safetensors"));
  const r3 = await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "base-f16", force: true });
  assert.equal(r3.built, true);
  assert.equal(fileSha(path.join(out, "model.safetensors")), h1);
});

test("int8-per-row：字节级等于 Python（model/scales/config）", async () => {
  const R = makeRoot(); roots.push(R.dir);
  await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "base-f16" });
  const out = path.join(R.modelsDir, "int8");
  await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "int8" });
  assert.deepEqual(bytes(path.join(out, "model.safetensors")), bytes(path.join(EXP, "int8_model.safetensors")));
  assert.deepEqual(bytes(path.join(out, "scales.f32")), bytes(path.join(EXP, "int8_scales.f32")));
  assert.deepEqual(bytes(path.join(out, "config.json")), bytes(path.join(EXP, "int8_config.json")));
});

test("pca-project-int8：确定性 + dtype/dim/scales/余弦达标", async () => {
  const R = makeRoot(); roots.push(R.dir);
  await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "base-f16" });
  const out = path.join(R.modelsDir, "pca");
  await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "pca" });
  assert.deepEqual(bytes(path.join(out, "config.json")), bytes(path.join(EXP, "pca_config.json")));
  const modelBytes = bytes(path.join(out, "model.safetensors"));
  assert.equal(modelBytes.readUInt32LE(0) > 0, true);
  const off = dataOffsetOf(modelBytes);
  assert.equal(modelBytes.length, off + 7 * 2);
  const scales = bytes(path.join(out, "scales.f32"));
  assert.equal(scales.length, 7 * 4);
  const jsRows = dequant(modelBytes, scales);
  const pyRows = META.pca_rows;
  assert.ok(cos(jsRows.flat(), pyRows.flat()) > 0.9999, "pca 余弦过低");
  const h1 = fileSha(path.join(out, "model.safetensors"));
  await buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "pca", force: true });
  assert.equal(fileSha(path.join(out, "model.safetensors")), h1);
});

test("numeric 可复现产物：sha 差异不影响校验，但尺寸不符仍拒绝", () => {
  const R = makeRoot(); roots.push(R.dir);
  const numericReg = JSON.parse(JSON.stringify(R.reg));
  const pcaArt = numericReg.artifacts.find(a => a.id === "pca");
  pcaArt.manifest.reproducibility = "numeric";
  pcaArt.files[0].sha256 = "b".repeat(64);
  fs.mkdirSync(path.join(R.modelsDir, "pca"), { recursive: true });
  for (const f of pcaArt.files) {
    const srcName = f.path === "model.safetensors" ? "pca_model.safetensors" : f.path === "config.json" ? "pca_config.json" : f.path === "scales.f32" ? "pca_scales.f32" : null;
    fs.copyFileSync(srcName ? path.join(FIX, "expected", srcName) : path.join(FIX, "base", "tokenizer.json"), path.join(R.modelsDir, "pca", path.basename(f.path))); }
  const ok = verifyArtifact(numericReg, R.regFile, "pca", { rootDir: R.modelsDir });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  pcaArt.files[0].bytes += 1;
  const bad = verifyArtifact(numericReg, R.regFile, "pca", { rootDir: R.modelsDir });
  assert.equal(bad.ok, false);
  assert.equal(bad.ok, false, "应拒绝尺寸不符");
  assert.equal(bad.mismatched[0] ? bad.mismatched[0].reason : "none", "size", JSON.stringify(bad));
});

test("缺少 base：可操作 ModelMissingError", async () => {
  const R = makeRoot(false); roots.push(R.dir);
  await assert.rejects(buildArtifact({ registry: R.reg, registryFile: R.regFile, id: "int8" }), err => {
    assert.equal(toDiagnostic(err).code, DiagnosticCode.MODEL_MISSING);
    assert.match(err.message, /缺少 base/);
    assert.match(err.message, /离线手动放置/);
    return true;
  });
});

test("ensureModels（offline）：source 就位时构建 f16/int8/pca 并返回 manifest", async () => {
  const R = makeRoot(); roots.push(R.dir);
  const r = await ensureModels({ registry: R.reg, registryFile: R.regFile, offline: true });
  assert.deepEqual(r.built.sort(), ["base-f16", "int8", "pca"]);
  assert.deepEqual(r.manifests["base-f16"].dtype, "F16");
  assert.equal(r.manifests["int8"].dim, 4);
  assert.equal(r.manifests["pca"].dim, 2);
  assert.deepEqual(bytes(path.join(R.modelsDir, "int8", "model.safetensors")), bytes(path.join(EXP, "int8_model.safetensors")));
  assert.deepEqual(bytes(path.join(R.modelsDir, "base-f16", "model.safetensors")), bytes(path.join(EXP, "f16_model.safetensors")));
});