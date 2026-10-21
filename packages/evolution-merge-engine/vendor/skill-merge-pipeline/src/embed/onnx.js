// G7.1：可选 ONNX embedding 后端（onnxruntime-node 动态 import + 能力探针；默认路径零影响）。
import path from "node:path";
import { UnavailableError, InvalidDataError } from "../errors.js";
import { exists } from "../io/read.js";
import { loadRegistry, artifactDir } from "../models/registry.js";
import { Tokenizer } from "../text/tokenizer.js";

const ONNX_ARTIFACT = "onnx:e5-small";
const INSTALL_HINT = "embed_backend=onnx 需要可选依赖 onnxruntime-node（npm install onnxruntime-node）与 ONNX 模型（skill-merge models ensure --include onnx）";
let probeCache = null;

export async function probeOnnx() {
  if (probeCache) return probeCache;
  try {
    const mod = await import("onnxruntime-node");
    probeCache = { available: true, version: (mod && mod.env && mod.env.versions && mod.env.versions.common) || "unknown" };
  } catch (err) {
    probeCache = { available: false, error: String(err && err.message ? err.message : err) };
  }
  return probeCache;
}

export class OnnxEmbedder {
  constructor(cfg) {
    this.cfg = cfg || {};
    this.name = "onnx:e5-small";
    this.maxTokens = Math.max(8, Number(this.cfg.onnx_max_tokens || 512));
    this.batch = Math.max(1, Number(this.cfg.onnx_batch || 8));
    this.dir = null;
    this.session = null;
    this.tok = null;
    this.ort = null;
  }
  _resolveDir() {
    const cfg = this.cfg;
    if (cfg.onnx_model_dir) return cfg.onnx_model_dir;
    const loaded = loadRegistry();
    return artifactDir(loaded.registry, loaded.file, ONNX_ARTIFACT, cfg.models_dir || undefined);
  }
  async _ensure() {
    if (this.session) return;
    const probe = await probeOnnx();
    if (!probe.available) throw new UnavailableError(INSTALL_HINT + "（" + String(probe.error).slice(0, 160) + "）", { where: "embed-onnx" });
    const dir = this._resolveDir();
    this.dir = dir;
    const modelPath = path.join(dir, "onnx", "model_quantized.onnx");
    const tokPath = path.join(dir, "tokenizer.json");
    if (!exists(modelPath) || !exists(tokPath)) {
      throw new UnavailableError("缺少 ONNX 模型文件: " + dir + "\n请先下载: skill-merge models ensure --include onnx", { where: "embed-onnx" });
    }
    const ort = await import("onnxruntime-node");
    this.ort = ort;
    this.session = await ort.InferenceSession.create(modelPath);
    this.tok = new Tokenizer(tokPath, { cache: false });
    this.hasMask = Array.isArray(this.session.inputNames) && this.session.inputNames.includes("attention_mask");
  }
  async _runBatch(texts) {
    const idsList = this.tok.encodeBatch(texts || []).map(ids => ids.slice(0, this.maxTokens));
    const maxLen = Math.max(1, ...idsList.map(x => x.length));
    const n = idsList.length;
    const ids = new BigInt64Array(n * maxLen);
    const mask = new BigInt64Array(n * maxLen);
    for (let i = 0; i < n; i += 1) {
      const row = idsList[i];
      for (let j = 0; j < maxLen; j += 1) {
        ids[i * maxLen + j] = BigInt(j < row.length ? row[j] : 0);
        mask[i * maxLen + j] = BigInt(j < row.length ? 1 : 0);
      }
    }
    const feeds = { input_ids: new this.ort.Tensor("int64", ids, [n, maxLen]) };
    if (this.hasMask) feeds.attention_mask = new this.ort.Tensor("int64", mask, [n, maxLen]);
    const results = await this.session.run(feeds);
    const outName = (this.session.outputNames && this.session.outputNames[0]) || Object.keys(results)[0];
    const hidden = results[outName];
    const dims = hidden.dims;
    if (!dims || dims.length !== 3) throw new InvalidDataError("ONNX 输出维度非法: " + JSON.stringify(dims), { where: "embed-onnx" });
    const seq = dims[1];
    const dim = dims[2];
    const data = hidden.data;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const acc = new Float64Array(dim);
      let count = 0;
      for (let j = 0; j < seq; j += 1) {
        if (!mask[i * maxLen + j]) continue;
        count += 1;
        for (let d = 0; d < dim; d += 1) acc[d] += Number(data[(i * seq + j) * dim + d]);
      }
      if (!count) count = 1;
      let n2 = 0;
      for (let d = 0; d < dim; d += 1) { acc[d] /= count; n2 += acc[d] * acc[d]; }
      const nrm = Math.sqrt(n2);
      if (nrm > 0) for (let d = 0; d < dim; d += 1) acc[d] /= nrm;
      out.push(Float32Array.from(acc));
    }
    return out;
  }
  async fitTransform(texts) {
    await this._ensure();
    const list = texts || [];
    const out = [];
    for (let i = 0; i < list.length; i += this.batch) out.push(...(await this._runBatch(list.slice(i, i + this.batch))));
    return out;
  }
  async encode(texts) { return (await this.fitTransform(texts)).map(v => Array.from(v)); }
  async transform(texts) { return this.fitTransform(texts); }
  close() { if (this.session && typeof this.session.release === "function") this.session.release(); this.session = null; }
}