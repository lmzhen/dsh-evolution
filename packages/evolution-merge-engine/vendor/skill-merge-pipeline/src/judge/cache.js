"use strict";
// C18 / G5.5：verdict 缓存（opt-in，默认关）。键 = promptSha + modelId + params。
import crypto from "node:crypto";
import path from "node:path";
import { exists, readJson } from "../io/read.js";
import { writeJson } from "../io/write.js";

const CACHE_VERSION = 1;

function cacheKey(promptSha, model, params) {
  return crypto.createHash("sha256").update(JSON.stringify({ promptSha: String(promptSha), model: String(model || ""), params: params || {} })).digest("hex");
}

class VerdictCache {
  constructor(filePath) {
    this.file = filePath || "";
    this.data = {};
    this.stats = { enabled: true, hits: 0, misses: 0, size: 0 };
    this.dirty = false;
    this._load();
  }
  _load() {
    try {
      if (this.file && exists(this.file)) {
        const j = readJson(this.file);
        if (j && typeof j === "object" && j.entries && typeof j.entries === "object" && !Array.isArray(j.entries)) {
          this.data = j.entries;
          this.stats.size = Object.keys(this.data).length;
        }
      }
    } catch (e) { this.data = {}; /* 损坏缓存按空处理 */ }
  }
  get(key) {
    const e = this.data[key];
    if (e && e.verdict !== undefined) {
      this.stats.hits += 1;
      return { verdict: e.verdict, reason: e.reason || "", evidence: e.evidence || [], cached: true };
    }
    this.stats.misses += 1;
    return null;
  }
  put(key, verdict) {
    this.data[key] = { verdict: verdict.verdict, reason: verdict.reason || "", evidence: verdict.evidence || [] };
    this.dirty = true;
    this.stats.size = Object.keys(this.data).length;
  }
  flush() {
    if (!this.dirty || !this.file) return;
    writeJson(this.file, { version: CACHE_VERSION, entries: this.data });
    this.dirty = false;
  }
}

function openVerdictCache(cfg, promptDir) {
  if (!cfg || !cfg.judge_cache) return null;
  const file = cfg.judge_cache_path ? String(cfg.judge_cache_path) : path.join(promptDir, "judge_cache.json");
  return new VerdictCache(file);
}

export { CACHE_VERSION, cacheKey, VerdictCache, openVerdictCache };