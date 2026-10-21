"use strict";
// ④ 向量相似度：本机流式静态模型 / 远程 SiliconFlow / 四档链 + 按档位阈值（与 Python semantic.py 等价）
import { StaticTable } from "../embed/static_table.js";
import { RemoteEmbedder, USAGE } from "../embed/remote.js";
import { ChainEmbedder } from "../embed/chain.js";
import { embedRegistry, resolveChain, floorsFor, resolveConfiguredDir } from "../embed/registry.js";
import { OnnxEmbedder } from "../embed/onnx.js";
import { throwIfAborted } from "../net/signal.js";
import { assertKnownBackend } from "../embed/provider.js";
import { InvalidDataError } from "../errors.js";
import { viaFromNets, assertSelectedPairs } from "./contract.js";
class StreamedStaticEmbedder {
  constructor(modelDir, opts) { this.name = "model2vec-stream"; this.m = new StaticTable(modelDir, opts || {}); this.model = this.m; }
  async fitTransform(texts) { return this.m.fitTransform(texts); }
  async encode(texts) { return (await this.fitTransform(texts)).map(v => Array.from(v)); }
  async transform(texts) { return this.fitTransform(texts); }
  close() { if (this.m) this.m.close(); }
}
class TfidfEmbedder {
  constructor() { this.name = "tfidf"; this.vocab = new Map(); this.idf = null; }
  _analyze(text) {
    const s = String(text).toLowerCase();
    const grams = new Map();
    for (let n = 3; n <= 5; n += 1) {
      for (let i = 0; i + n <= s.length + 1; i += 1) {
        const piece = s.slice(i, i + n);
        if (piece.length < n) continue;
        if (/^\s*$/.test(piece)) continue;
        grams.set(piece, (grams.get(piece) || 0) + 1);
      }
    }
    return grams;
  }
  async fitTransform(texts) {
    const docs = texts.map(t => this._analyze(t));
    const df = new Map();
    for (const g of docs) for (const k of g.keys()) df.set(k, (df.get(k) || 0) + 1);
    const N = docs.length;
    this.idf = new Map();
    for (const [k, c] of df) this.idf.set(k, Math.log((1 + N) / (1 + c)) + 1);
    let idx = 0;
    for (const k of this.idf.keys()) this.vocab.set(k, idx++);
    return docs.map(g => this._vec(g));
  }
  _vec(grams) {
    const v = new Float64Array(this.vocab.size);
    for (const [k, c] of grams) { const i = this.vocab.get(k); if (i !== undefined) v[i] = (1 + Math.log(c)) * this.idf.get(k); }
    let n2 = 0; for (const x of v) n2 += x * x;
    const n = Math.sqrt(n2); if (n > 0) for (let i = 0; i < v.length; i += 1) v[i] /= n;
    return v;
  }
  async encode(texts) { return (await this.fitTransform(texts)).map(v => Array.from(v)); }
  async transform(texts) { return texts.map(t => this._vec(this._analyze(t))); }
}
class SentenceTransformerEmbedder {
  constructor() { throw new Error("Node 版不支持 sentence-transformers 后端（请用 model2vec-stream / chain）"); }
}
function tokenizerOpts(cfg) { return { cache: cfg.tokenizer_cache !== false, cacheDir: cfg.tokenizer_cache_dir || "" }; }
function localEmbedder(cfg, modelDir) {
  const dir = modelDir || cfg.embedder_model;
  if (cfg.embedder === "model2vec-stream") return new StreamedStaticEmbedder(dir, Object.assign({}, tokenizerOpts(cfg), { streamMode: cfg.stream_mode, maxTableBytes: (Number(cfg.max_table_mb) || 0) * 1024 * 1024, workerPool: cfg.worker_pool, workerPoolSize: cfg.worker_pool_size, workerPoolMinItems: cfg.worker_pool_min_items, workerPoolMinMs: cfg.worker_pool_min_ms }));
  if (cfg.embedder === "tfidf") return new TfidfEmbedder();
  if (cfg.embedder === "tfidf-svd") throw new Error("Node 版暂不支持 tfidf-svd（需 sklearn SVD）");
  if (cfg.embedder === "model2vec") throw new Error("Node 版暂不支持 model2vec 直载（用 model2vec-stream）");
  if (cfg.embedder === "sentence-transformers") return new SentenceTransformerEmbedder();
  throw new InvalidDataError("未知 embedder provider: " + String(cfg.embedder) + "（可选: model2vec-stream/tfidf/tfidf-svd/model2vec/sentence-transformers）", { where: "embed-provider" });
}
function buildTier(tier, cfg, opts) {
  if (tier.kind === "remote") return new RemoteEmbedder(tier.effectiveModel, cfg, { priceKey: tier.modelId, signal: opts && opts.signal });
  const dir = cfg[tier.overrideField] || resolveConfiguredDir(cfg, tier.overrideField) || cfg.embedder_model;
  return localEmbedder(cfg, dir);
}
function makeEmbedder(cfg, opts) {
  const backend = assertKnownBackend(cfg);
  if (backend === "onnx") return new OnnxEmbedder(cfg);
  const chain = resolveChain(cfg, embedRegistry());
  if (chain.mode === "chain") return new ChainEmbedder(chain.tiers.map(t => [t.tier, async () => buildTier(t, cfg, opts)]), opts);
  return buildTier(chain.tiers[0], cfg, opts);
}
function projectionOf(skill, projection) { return projection === "summary" ? skill.summary : (skill.body_core || skill.body); }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; }
async function semanticSelect(passed, byPath, cfg, opts) {
  const signal = opts && opts.signal;
  throwIfAborted(signal);
  const stats = { pairs_in: passed.length, top_n: cfg.semantic_top_n, body_floor: cfg.semantic_body_floor, summary_floor: cfg.semantic_summary_floor, embedder: cfg.embedder, model: cfg.embedder_model, per_projection: {} };
  if (!passed.length) return [[], [], stats];
  const emb = makeEmbedder(cfg, opts);
  try {
    const participants = [...new Set(passed.flatMap(r => [r.a_path, r.b_path]))].sort();
    const paths = participants;
    stats.embed_inputs = { participants: participants.length, total_skills: byPath.size };
  const valsByProj = {};
  for (const projection of ["body_core", "summary"]) {
    throwIfAborted(signal);
    const texts = paths.map(p => projectionOf(byPath.get(p), projection));
    const vecs = await emb.fitTransform(texts);
    const idx = new Map(paths.map((p, i) => [p, i]));
    valsByProj[projection] = passed.map(r => dot(vecs[idx.get(r.a_path)], vecs[idx.get(r.b_path)]));
  }
  stats.embedder = emb.name;
  const tier = emb.chosen || "local";
  const floors = floorsFor(cfg, embedRegistry(), tier);
  stats.floors_used = { tier: tier, body: floors.body_core, summary: floors.summary };
  const acc = new Map();
  for (const projection of ["body_core", "summary"]) {
    const vals = valsByProj[projection];
    const floor = floors[projection];
    const order = [...Array(vals.length).keys()].sort((a, b) => (vals[b] - vals[a]) || (a - b));
    const top = new Set(order.slice(0, cfg.semantic_top_n));
    const flr = new Set(vals.map((v, i) => i).filter(i => vals[i] >= floor));
    const picked = new Set([...top, ...flr]);
    for (const i of [...picked].sort((a, b) => a - b)) {
      const r = passed[i];
      const key = r.a_path + "\u0000" + r.b_path;
      let row = acc.get(key);
      if (!row) { row = Object.assign({}, r); acc.set(key, row); }
      row[projection + "_cosine"] = Math.round(vals[i] * 10000) / 10000;
      row.arms = row.arms || [];
      row.arms.push(projection + (flr.has(i) ? "_floor" : "_top"));
      if (!Array.isArray(row.arm)) row.arm = [];
      const semanticArm = "semantic:" + projection + (flr.has(i) ? "_floor" : "_top");
      if (!row.arm.includes(semanticArm)) row.arm.push(semanticArm);
      row.via = row.via || viaFromNets(row.nets);
      if (typeof row.score !== "number" || !Number.isFinite(row.score)) row.score = Math.max(Number(row.body_core_cosine) || 0, Number(row.summary_cosine) || 0);
    }
    const cut = order.length >= cfg.semantic_top_n ? Math.round(vals[order[cfg.semantic_top_n - 1]] * 10000) / 10000 : null;
    stats.per_projection[projection] = { top_n_count: top.size, floor_count: flr.size, union_count: picked.size, floor: floor, cutoff_cosine: cut };
  }
  const out = [...acc.keys()].sort().map(k => acc.get(k));
  assertSelectedPairs(out, "semantic");
  stats.selected = out.length;
  if (emb.attempts) { stats.embedder_used = emb.chosen; stats.embedder_chain = emb.attempts; }
  if (typeof emb.degrade === "function") {
    const d = emb.degrade();
    if (d && d.degraded) { stats.embedder_degraded = true; stats.embedder_reason = d.reasonCode; }
  }
  if (USAGE.calls) stats.remote_usage = Object.assign({}, USAGE);
  return [out, out, stats];
  } finally {
    if (emb && typeof emb.close === "function") emb.close();
  }
}
export { makeEmbedder, semanticSelect, StreamedStaticEmbedder, TfidfEmbedder, dot, projectionOf };