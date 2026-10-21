"use strict";
// G4.3：远程 embedding（SiliconFlow 兼容端点）——mapLimit 并发/重试退避/保序/计费。
import path from "node:path";
import os from "node:os";
import { exists, readText } from "../io/read.js";
import { proxiedFetch } from "../net/proxy.js";
import { throwIfAborted, withTimeout } from "../net/signal.js";

const USAGE = { calls: 0, input_tokens: 0, ms: 0, cost_cny: 0 };

function readKey(envName, credPath) {
  const envVal = process.env[envName] || "";
  if (envVal) return [envVal, "env:" + envName];
  const cands = [];
  if (credPath) cands.push(credPath);
  cands.push(path.join(os.homedir(), ".dsh", ".credentials.yaml"));
  for (const p of cands) {
    if (!p || !exists(p)) continue;
    try {
      const txt = readText(p);
      const m = new RegExp(envName + "\\s*:\\s*(\\S+)").exec(txt);
      if (m) return [m[1].trim().replace(/^["']|["']$/g, "").replace(/[,;]+$/, "").trim(), "file:" + p];
    } catch (e) { /* 忽略凭据文件读取失败 */ }
  }
  return ["", "未找到 key"];
}

function normalizeVec(v) {
  let n2 = 0;
  for (let i = 0; i < v.length; i += 1) n2 += v[i] * v[i];
  const n = Math.sqrt(n2);
  if (n > 0) for (let i = 0; i < v.length; i += 1) v[i] /= n;
  return v;
}

function priceOf(cfg, priceKey) {
  const table = cfg.embed_price_cny_per_ktok || {};
  return Number(table[priceKey] || 0);
}

async function mapLimit(items, limit, fn, signal) {
  const results = new Array(items.length);
  const n = Math.max(1, Math.min(Number(limit) || 1, items.length));
  let next = 0;
  async function worker() {
    for (;;) {
      throwIfAborted(signal);
      const i = next; next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i, signal);
    }
  }
  const workers = [];
  for (let i = 0; i < n; i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

class RemoteEmbedError extends Error {}

class RemoteEmbedder {
  constructor(model, cfg, opts) {
    const o = opts || {};
    this.model = model;
    this.name = "remote:" + model;
    this.url = cfg.embed_remote_url || "https://api.siliconflow.cn/v1/embeddings";
    this.maxChars = Number(cfg.embed_max_chars || 8000);
    this.batch = Math.max(1, Number(cfg.embed_batch || 16));
    this.timeout = Number(cfg.embed_timeout || 60.0);
    this.dimensions = Number(cfg.embed_dimensions || 0);
    this.concurrency = Math.max(1, Math.min(32, Number(cfg.embed_concurrency || 4)));
    this.retries = Math.max(0, Math.min(5, Number(cfg.embed_retries === undefined ? 2 : cfg.embed_retries)));
    this.signal = o.signal || null;
    this.priceKey = o.priceKey || model;
    this.pricePerKtok = priceOf(cfg, this.priceKey);
    this._sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this._fetch = o.fetch || ((u, i) => proxiedFetch(u, i));
    if (o.key) { this.key = o.key; this.keySource = "explicit"; }
    else {
      const envName = cfg.embed_api_key_env || "SILICONFLOW_API_KEY";
      const [k, src] = readKey(envName, cfg.embed_cred_path || "");
      this.key = k; this.keySource = src;
    }
    if (!this.key) throw new RemoteEmbedError("缺少 API key（env " + (cfg.embed_api_key_env || "SILICONFLOW_API_KEY") + " 或 ~/.dsh/.credentials.yaml refs）");
  }

  _backoff(attempt, retryAfter) {
    if (retryAfter !== null && retryAfter !== undefined) return Number(retryAfter);
    return 200 * Math.pow(2, attempt);
  }

  async _postOnce(inputs) {
    const body = { model: this.model, input: inputs, encoding_format: "float" };
    if (this.dimensions) body.dimensions = this.dimensions;
    const t0 = Date.now();
    let resp;
    try {
      resp = await this._fetch(this.url, {
        method: "POST",
        headers: { "Authorization": "Bearer " + this.key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: withTimeout(this.signal, this.timeout * 1000)
      });
    } catch (exc) {
      const err = new RemoteEmbedError("请求失败(" + this.model + "): " + String(exc && exc.message ? exc.message : exc).slice(0, 160));
      err.retryable = true;
      throw err;
    }
    USAGE.ms += Date.now() - t0;
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      const err = new RemoteEmbedError("HTTP " + resp.status + " " + String(txt).slice(0, 120));
      err.retryable = resp.status === 429 || resp.status >= 500;
      const ra = resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("retry-after") : null;
      err.retryAfter = ra === null || ra === undefined ? null : Number(ra) * 1000;
      throw err;
    }
    const data = await resp.json();
    USAGE.calls += 1;
    const u = data.usage || {};
    const tokens = Number(u.prompt_tokens || u.total_tokens || 0);
    USAGE.input_tokens += tokens;
    USAGE.cost_cny += (tokens / 1000) * this.pricePerKtok;
    let items = data.data || [];
    if (items.length !== inputs.length) throw new RemoteEmbedError("返回条数不符: " + items.length + " != " + inputs.length);
    if (items.every(it => it.index !== undefined)) items = items.slice().sort((a, b) => a.index - b.index);
    return items.map(it => Float32Array.from(it.embedding));
  }

  async _post(inputs) {
    let lastErr = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      throwIfAborted(this.signal);
      try { return await this._postOnce(inputs); } catch (err) {
        lastErr = err;
        if (!err.retryable || attempt >= this.retries) break;
        await this._sleep(this._backoff(attempt, err.retryAfter));
      }
    }
    throw (lastErr instanceof RemoteEmbedError ? lastErr : new RemoteEmbedError("请求失败(" + this.model + "): " + String(lastErr && lastErr.message ? lastErr.message : lastErr).slice(0, 160)));
  }

  async fitTransform(texts) {
    const cleaned = texts.map(t => { let s = String(t); if (!s.trim()) s = " "; return s.slice(0, this.maxChars); });
    if (!cleaned.length) return [];
    const batches = [];
    for (let i = 0; i < cleaned.length; i += this.batch) batches.push(cleaned.slice(i, i + this.batch));
    const results = await mapLimit(batches, this.concurrency, b => this._post(b), this.signal);
    return results.flat().map(v => normalizeVec(v));
  }

  async encode(texts) { return (await this.fitTransform(texts)).map(v => Array.from(v)); }
  async transform(texts) { return this.fitTransform(texts); }
  close() { /* 远程无句柄 */ }
}

export { USAGE, readKey, RemoteEmbedError, RemoteEmbedder, normalizeVec, mapLimit, priceOf };