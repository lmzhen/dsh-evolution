"use strict";
// G4.2：静态表加载（bulk 默认 / stream 回退）+ 唯一 id 合并 + tokenizer 单例 + close。
import path from "node:path";
import { readJson, readBinary, fileMeta } from "../io/read.js";
import { openTensor, f16ToF32 } from "../models/safetensors.js";
import { readAt, closeFile } from "../io/bytes.js";
import { sharedTokenizer } from "../text/tokenizer.js";
import { InvalidDataError } from "../errors.js";
import { poolDecision, poolSize, runEncodePool, tableSab } from "../workers/pool.js";

const DEFAULT_CACHE_ROWS = 20000;

function copyView(Ctor, raw, offset, count) {
  const bytes = count * Ctor.BYTES_PER_ELEMENT;
  const ab = new ArrayBuffer(bytes);
  Buffer.from(ab).set(raw.subarray(offset, offset + bytes));
  return new Ctor(ab);
}

class StaticTable {
  constructor(modelDir, opts) {
    const o = opts || {};
    this.dir = modelDir;
    this.cfg = readJson(path.join(modelDir, "config.json"));
    this.dim = Number(this.cfg.hidden_dim || 256);
    this.normalize = this.cfg.normalize !== false;
    this.tok = sharedTokenizer(path.join(modelDir, "tokenizer.json"), { cache: o.cache !== false, cacheDir: o.cacheDir || "" });
    const modelPath = path.join(modelDir, "model.safetensors");
    const meta = fileMeta(modelPath);
    if (!meta.exists) throw new InvalidDataError("模型文件缺失: " + modelPath, { where: "static_table" });
    const t = openTensor(modelPath);
    this.dtype = t.dtype;
    this.rows = t.rows;
    this.cols = t.cols;
    this.itemsize = t.itemsize;
    if (this.cols !== this.dim) throw new InvalidDataError("hidden_dim 与表列数不符: " + this.dim + " != " + this.cols, { where: "static_table" });
    this.scales = null;
    if (this.dtype === "I8" || this.dtype === "U8") {
      const sp = path.join(modelDir, this.cfg.scales_file || "scales.f32");
      const sb = readBinary(sp);
      const arr = new Float32Array(sb.length / 4);
      Buffer.from(arr.buffer).set(sb);
      if (arr.length !== this.rows) throw new InvalidDataError("scales 长度不符", { where: "static_table" });
      this.scales = arr;
    }
    const maxBytes = Number(o.maxTableBytes || 0);
    const wantStream = String(o.streamMode || "bulk") === "stream";
    this.warnings = [];
    this.mode = wantStream ? "stream" : (maxBytes > 0 && meta.bytes > maxBytes ? "stream" : "bulk");
    if (this.mode === "stream" && maxBytes > 0 && meta.bytes > maxBytes) this.warnings.push({ code: "BUDGET", detail: "表 " + meta.bytes + " B 超过预算 " + maxBytes + " B，回退 stream" });
    this.workerPool = String(o.workerPool || "off");
    this.workerPoolSize = Number(o.workerPoolSize || 0);
    this.workerPoolMinItems = Number(o.workerPoolMinItems || 500);
    this.workerPoolMinMs = Number(o.workerPoolMinMs || 1500);
    this.workerPoolForce = !!o.workerPoolForce;
    if (this.workerPool !== "off" && this.mode !== "bulk") {
      this.warnings.push({ code: "BUDGET", detail: "stream 模式不支持 worker 池，回退单线程" });
      this.workerPool = "off";
    }
    this._shared = null;
    this.lastStats = null;
    this.closed = false;
    this.fd = -1;
    this.data = null;
    this.cache = null;
    if (this.mode === "bulk") {
      const raw = readBinary(modelPath);
      t.close();
      this.raw = raw;
      const off = t.dataOffset;
      const n = this.rows * this.cols;
      if (this.dtype === "I8") this.view = new Int8Array(raw.buffer, raw.byteOffset + off, n);
      else if (this.dtype === "U8") this.view = new Uint8Array(raw.buffer, raw.byteOffset + off, n);
      else if (this.dtype === "F16") this.view = ((raw.byteOffset + off) % 2 === 0) ? new Uint16Array(raw.buffer, raw.byteOffset + off, n) : copyView(Uint16Array, raw, off, n);
      else if (this.dtype === "F32") this.view = ((raw.byteOffset + off) % 4 === 0) ? new Float32Array(raw.buffer, raw.byteOffset + off, n) : copyView(Float32Array, raw, off, n);
      else throw new InvalidDataError("不支持的 dtype: " + this.dtype, { where: "static_table" });
    } else {
      this.fd = t.fd;
      this.tensor = t;
      this.cache = new Map();
      this.cacheCap = DEFAULT_CACHE_ROWS;
    }
  }

  _rowInto(acc, id, count) {
    const cols = this.cols;
    if (this.mode === "bulk") {
      const base = id * cols;
      const scale = this.scales ? this.scales[id] : 1;
      if (this.dtype === "I8") { const v = this.view; for (let j = 0; j < cols; j += 1) acc[j] += v[base + j] * scale * count; }
      else if (this.dtype === "U8") { const v = this.view; for (let j = 0; j < cols; j += 1) acc[j] += v[base + j] * scale * count; }
      else if (this.dtype === "F16") { const v = this.view; for (let j = 0; j < cols; j += 1) acc[j] += f16ToF32(v[base + j]) * count; }
      else { const v = this.view; for (let j = 0; j < cols; j += 1) acc[j] += v[base + j] * count; }
      return;
    }
    let row = this.cache.get(id);
    if (!row) {
      const raw = Buffer.alloc(cols * this.itemsize);
      readAt(this.fd, raw, 0, raw.length, this.tensor.dataOffset + id * cols * this.itemsize);
      row = new Float32Array(cols);
      if (this.dtype === "I8") { const sc = this.scales[id]; for (let j = 0; j < cols; j += 1) row[j] = raw.readInt8(j) * sc; }
      else if (this.dtype === "U8") { const sc = this.scales ? this.scales[id] : 1; for (let j = 0; j < cols; j += 1) row[j] = raw.readUInt8(j) * sc; }
      else if (this.dtype === "F16") { for (let j = 0; j < cols; j += 1) row[j] = f16ToF32(raw.readUInt16LE(j * 2)); }
      else { for (let j = 0; j < cols; j += 1) row[j] = raw.readFloatLE(j * 4); }
      if (this.cache.size < this.cacheCap) this.cache.set(id, row);
    }
    for (let j = 0; j < cols; j += 1) acc[j] += row[j] * count;
  }

  _encodeInline(idsList) {
    const out = [];
    for (const ids of idsList) {
      const acc = new Float64Array(this.cols);
      if (!ids.length) { out.push(new Float32Array(this.cols)); continue; }
      const counts = new Map();
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
      for (const [id, count] of counts) this._rowInto(acc, id, count);
      for (let j = 0; j < this.cols; j += 1) acc[j] /= ids.length;
      if (this.normalize) {
        let n2 = 0;
        for (let j = 0; j < this.cols; j += 1) n2 += acc[j] * acc[j];
        const nrm = Math.sqrt(n2);
        if (nrm > 0) for (let j = 0; j < this.cols; j += 1) acc[j] /= nrm;
      }
      out.push(Float32Array.from(acc));
    }
    return out;
  }
  _shareTable() {
    if (!this._shared) this._shared = tableSab(this.view, this.cols, this.rows, this.itemsize, this.scales, this.normalize, this.dtype);
    return this._shared;
  }
  async fitTransform(texts) {
    if (this.closed) throw new InvalidDataError("static_table 已关闭，不能继续编码", { where: "static_table" });
    const list = texts || [];
    const tTok = performance.now();
    const idsList = this.tok.encodeBatch(list);
    const tokenizeMs = performance.now() - tTok;
    const stats = { mode: "inline", pool_used: false, workers: 0, items: idsList.length, tokenize_ms: Math.round(tokenizeMs), encode_ms: 0, est_ms: null };
    if (this.workerPool !== "off" && this.mode === "bulk" && idsList.length >= this.workerPoolMinItems) {
      const sampleN = Math.min(20, idsList.length);
      const tS = performance.now();
      this._encodeInline(idsList.slice(0, sampleN));
      const sampleMs = performance.now() - tS;
      const estMs = sampleMs * (idsList.length / sampleN);
      const d = poolDecision({ n: idsList.length, estimatedMs: estMs, minItems: this.workerPoolMinItems, minMs: this.workerPoolMinMs });
      stats.est_ms = Math.round(estMs);
      if (d.use || this.workerPoolForce) {
        const shared = this._shareTable();
        const tE = performance.now();
        const pooled = await runEncodePool({ sab: shared.sab, meta: shared.meta, idsList: idsList, workers: poolSize(this.workerPoolSize) });
        stats.mode = "pool";
        stats.pool_used = true;
        stats.workers = pooled.workers;
        stats.encode_ms = Math.round(performance.now() - tE);
        stats.reason = this.workerPoolForce ? "force" : d.reason;
        this.lastStats = stats;
        return pooled.vectors;
      }
      stats.reason = d.reason;
    }
    const tE = performance.now();
    const out = this._encodeInline(idsList);
    stats.encode_ms = Math.round(performance.now() - tE);
    this.lastStats = stats;
    return out;
  }

  async encode(texts) { return (await this.fitTransform(texts)).map(v => Array.from(v)); }
  async transform(texts) { return this.fitTransform(texts); }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.fd >= 0) { closeFile(this.fd); this.fd = -1; }
    this.raw = null;
    this.view = null;
    this.cache = null;
    this.tensor = null;
    this._shared = null;
  }
}

export { StaticTable };