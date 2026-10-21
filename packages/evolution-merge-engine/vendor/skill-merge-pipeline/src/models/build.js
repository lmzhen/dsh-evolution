"use strict";
// G2.3：确定性构建 fp16-cast / int8-per-row / pca-project-int8；C9 ensureModels（provision + build）。
import path from "node:path";
import { InvalidDataError, ModelMissingError } from "../errors.js";
import { readBinary } from "../io/read.js";
import { writeFileBytes, ensureDir, readAt } from "../io/bytes.js";
import { writeText, atomicWrite } from "../io/write.js";
import { openTensor, writeTensor, f16ToF32, f32ToF16 } from "./safetensors.js";
import { artifactById, artifactDir, verifyArtifact } from "./registry.js";
import { roundHalfEven } from "../numeric.js";
import * as provision from "./provision.js";

const CHUNK_ROWS = 40000;

function fileMap(artifact) {
  const m = {};
  for (const f of artifact.files) m[path.basename(f.path)] = f.path;
  return m;
}
function requiredPath(dir, files, name, ctx) {
  const rel = files[name];
  if (!rel) throw new InvalidDataError("artifact 缺少文件 " + name + "（" + ctx + "）", { where: "build" });
  return path.join(dir, rel);
}
function patchConfig(baseCfg, patch) {
  const out = Object.assign({}, baseCfg);
  if (patch) for (const k of Object.keys(patch)) out[k] = patch[k];
  return out;
}
function writeConfig(outDir, files, baseDir, baseFiles, patch) {
  const baseCfg = JSON.parse(readBinary(requiredPath(baseDir, baseFiles, "config.json", "base")).toString("utf8"));
  const cfg = patchConfig(baseCfg, patch);
  writeText(requiredPath(outDir, files, "config.json", "output"), JSON.stringify(cfg, null, 2), { eol: "crlf" });
}
function copyTokenizer(outDir, files, baseDir, baseFiles) {
  atomicWrite(requiredPath(outDir, files, "tokenizer.json", "output"), readBinary(requiredPath(baseDir, baseFiles, "tokenizer.json", "base")));
}

async function buildFp16Cast(ctx) {
  const t = openTensor(ctx.baseModelPath);
  try {
    const { rows, cols } = t;
    if (ctx.manifest.rows !== rows || ctx.manifest.dim !== cols) throw new InvalidDataError("base 形状与 manifest 不符", { where: "build:" + ctx.id });
    const bytesPerRow = cols * 4;
    await writeTensor(ctx.outModelPath, {
      dtype: "F16", rows, cols,
      writeChunk: async write => {
        for (let i = 0; i < rows; i += CHUNK_ROWS) {
          const n = Math.min(CHUNK_ROWS, rows - i);
          const raw = Buffer.alloc(n * bytesPerRow);
          readAt(t.fd, raw, 0, raw.length, t.dataOffset + i * bytesPerRow);
          const out = Buffer.alloc(n * cols * 2);
          for (let j = 0; j < n * cols; j += 1) out.writeUInt16LE(f32ToF16(raw.readFloatLE(j * 4)), j * 2);
          await write(out);
          if (ctx.onProgress) ctx.onProgress({ id: ctx.id, phase: "rows", done: i + n, total: rows });
        }
      }
    });
  } finally { t.close(); }
  writeConfig(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles, ctx.params.configPatch);
  copyTokenizer(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles);
}

async function buildInt8(ctx) {
  const t = openTensor(ctx.baseModelPath);
  try {
    const { rows, cols } = t;
    if (ctx.manifest.rows !== rows || ctx.manifest.dim !== cols) throw new InvalidDataError("base 形状与 manifest 不符", { where: "build:" + ctx.id });
    const scales = new Float32Array(rows);
    const bytesPerRow = cols * 2;
    await writeTensor(ctx.outModelPath, {
      dtype: "I8", rows, cols,
      writeChunk: async write => {
        for (let i = 0; i < rows; i += CHUNK_ROWS) {
          const n = Math.min(CHUNK_ROWS, rows - i);
          const raw = Buffer.alloc(n * bytesPerRow);
          readAt(t.fd, raw, 0, raw.length, t.dataOffset + i * bytesPerRow);
          const q = Buffer.alloc(n * cols);
          for (let r = 0; r < n; r += 1) {
            let mx = 0;
            for (let c = 0; c < cols; c += 1) { const v = f16ToF32(raw.readUInt16LE((r * cols + c) * 2)); const a = Math.abs(v); if (a > mx) mx = a; }
            let sc = Math.fround(mx / 127.0);
            if (sc === 0) sc = Math.fround(1e-8);
            scales[i + r] = sc;
            for (let c = 0; c < cols; c += 1) {
              const v = f16ToF32(raw.readUInt16LE((r * cols + c) * 2));
              const qf = Math.fround(v / sc);
              let qi = roundHalfEven(qf);
              if (qi > 127) qi = 127; else if (qi < -127) qi = -127;
              q[r * cols + c] = qi & 0xFF;
            }
          }
          await write(q);
          if (ctx.onProgress) ctx.onProgress({ id: ctx.id, phase: "rows", done: i + n, total: rows });
        }
      }
    });
    writeFileBytes(requiredPath(ctx.outDir, ctx.outFiles, ctx.params.scalesFile || "scales.f32", "output"), Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength));
  } finally { t.close(); }
  writeConfig(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles, ctx.params.configPatch);
  copyTokenizer(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles);
}

async function buildPca64(ctx) {
  const t = openTensor(ctx.baseModelPath);
  const dims = Number(ctx.manifest.dim);
  const projBytes = readBinary(ctx.projPath);
  if (projBytes.length !== t.cols * dims * 4) throw new InvalidDataError("proj 尺寸不符: " + projBytes.length + " != " + (t.cols * dims * 4), { where: "build:" + ctx.id });
  const proj = new Float32Array(t.cols * dims);
  Buffer.from(proj.buffer).set(projBytes);
  try {
    const { rows, cols } = t;
    if (ctx.manifest.rows !== rows) throw new InvalidDataError("base 行数与 manifest 不符", { where: "build:" + ctx.id });
    const scales = new Float32Array(rows);
    const bytesPerRow = cols * 2;
    await writeTensor(ctx.outModelPath, {
      dtype: "I8", rows, cols: dims,
      writeChunk: async write => {
        for (let i = 0; i < rows; i += CHUNK_ROWS) {
          const n = Math.min(CHUNK_ROWS, rows - i);
          const raw = Buffer.alloc(n * bytesPerRow);
          readAt(t.fd, raw, 0, raw.length, t.dataOffset + i * bytesPerRow);
          const q = Buffer.alloc(n * dims);
          for (let r = 0; r < n; r += 1) {
            const projRow = new Float64Array(dims);
            let mx = 0;
            for (let c = 0; c < cols; c += 1) {
              const v = f16ToF32(raw.readUInt16LE((r * cols + c) * 2));
              const base = c * dims;
              for (let d = 0; d < dims; d += 1) projRow[d] += v * proj[base + d];
            }
            for (let d = 0; d < dims; d += 1) { projRow[d] = Math.fround(projRow[d]); const a = Math.abs(projRow[d]); if (a > mx) mx = a; }
            let sc = Math.fround(mx / 127.0);
            if (sc === 0) sc = Math.fround(1e-8);
            scales[i + r] = sc;
            for (let d = 0; d < dims; d += 1) {
              const qf = Math.fround(projRow[d] / sc);
              let qi = roundHalfEven(qf);
              if (qi > 127) qi = 127; else if (qi < -127) qi = -127;
              q[r * dims + d] = qi & 0xFF;
            }
          }
          await write(q);
          if (ctx.onProgress) ctx.onProgress({ id: ctx.id, phase: "rows", done: i + n, total: rows });
        }
      }
    });
    writeFileBytes(requiredPath(ctx.outDir, ctx.outFiles, ctx.params.scalesFile || "scales.f32", "output"), Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength));
  } finally { t.close(); }
  writeConfig(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles, ctx.params.configPatch);
  copyTokenizer(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles);
}

const RECIPES = { "fp16-cast": buildFp16Cast, "int8-per-row": buildInt8, "pca-project-int8": buildPca64 };

async function buildArtifact(params) {
  const { registry, registryFile, id, rootDir, force, onProgress } = params;
  const a = artifactById(registry, id);
  if (a.kind !== "derived") throw new InvalidDataError("只能构建 derived artifact: " + id, { where: "build" });
  if (!force) {
    const v = verifyArtifact(registry, registryFile, id, { rootDir, hash: true });
    if (v.ok) return { id, built: false, manifest: a.manifest };
  }
  const base = artifactById(registry, a.base);
  const baseDir = artifactDir(registry, registryFile, a.base, rootDir);
  const baseCheck = verifyArtifact(registry, registryFile, a.base, { rootDir, hash: true });
  if (!baseCheck.ok) {
    throw new ModelMissingError("构建 " + id + " 缺少 base " + a.base + "（" + baseDir + "）: " + JSON.stringify({ missing: baseCheck.missing, mismatched: baseCheck.mismatched }) + "；先 ensureArtifacts 下载或离线手动放置", { where: "build:" + id });
  }
  const recipe = registry.recipes[a.recipe];
  if (!recipe) throw new InvalidDataError("recipe 未定义: " + a.recipe, { where: "build" });
  const builder = RECIPES[a.recipe];
  if (!builder) throw new InvalidDataError("Node 不支持的 recipe: " + a.recipe, { where: "build" });
  const outDir = artifactDir(registry, registryFile, id, rootDir);
  ensureDir(outDir);
  const baseFiles = fileMap(base);
  const outFiles = fileMap(a);
  const ctx = {
    id, params: recipe.params || {}, manifest: a.manifest, onProgress,
    baseDir, baseFiles, outDir, outFiles,
    baseModelPath: requiredPath(baseDir, baseFiles, "model.safetensors", "base"),
    outModelPath: requiredPath(outDir, outFiles, "model.safetensors", "output")
  };
  if (a.proj) {
    const projArtifact = artifactById(registry, a.proj);
    const projDir = artifactDir(registry, registryFile, a.proj, rootDir);
    const projCheck = verifyArtifact(registry, registryFile, a.proj, { rootDir, hash: true });
    if (!projCheck.ok) throw new ModelMissingError("构建 " + id + " 缺少 proj " + a.proj + "（" + projDir + "）", { where: "build:" + id });
    ctx.projPath = path.join(projDir, projArtifact.files[0].path);
  }
  await builder(ctx);
  const v = verifyArtifact(registry, registryFile, id, { rootDir, hash: true });
  if (!v.ok) throw new InvalidDataError("构建后校验失败: " + id + " " + JSON.stringify({ missing: v.missing, mismatched: v.mismatched }), { where: "build:" + id });
  return { id, built: true, manifest: a.manifest };
}

async function ensureModels(params) {
  const p = params || {};
  const registry = p.registry;
  const ids = p.ids && p.ids.length ? p.ids.slice() : registry.artifacts.map(a => a.id);
  const prov = await provision.ensureArtifacts(Object.assign({}, p, { ids }));
  const built = [];
  const skipped = prov.skipped.slice();
  for (const id of prov.needsBuild) {
    const r = await buildArtifact(Object.assign({}, p, { id }));
    if (r.built) built.push(id); else skipped.push(id);
  }
  const manifests = {};
  for (const id of ids) manifests[id] = artifactById(registry, id).manifest || null;
  return { manifests, downloaded: prov.downloaded, built, skipped };
}

export { CHUNK_ROWS, buildArtifact, ensureModels, patchConfig };