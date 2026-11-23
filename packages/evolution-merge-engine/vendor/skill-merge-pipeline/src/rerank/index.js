"use strict";
// C19 / G5.1：④.5 精排（probe/local/vecfill + C6 partial + checkpoint 批量原子写 + 并发默认 1）。
import * as extract from "../extract.js";
import { atomicWrite } from "../io/write.js";
import { exists, readJson } from "../io/read.js";
import { classifyReason } from "../attempt.js";
import { mapLimit } from "../embed/remote.js";
import { proxiedFetch } from "../net/proxy.js";
import { throwIfAborted, withTimeout } from "../net/signal.js";
import { makeRankerProvider, RANKER_SCORE_RANGE } from "./provider.js";
import { withRetry } from "../net/retry.js";
import path from "node:path";
import crypto from "node:crypto";

const LIDS = []; for (let i = 32; i < 58; i += 1) LIDS.push(i);
const TEMP_CHOICE = 1.7565;
const SYSTEM = "Apply the criterion to the evidence. Choose exactly one listed option. Answer with its letter only.";
const QUESTION = "以下两个skill在职能和场景领域存在哪些共性？";
const OPTIONS = { a: "在场景方面存在共性，但职能上不存在共性", b: "职能存在共性，但在场景方面不存在共性", c: "在场景方面和职能上均存在共性", d: "在场景方面和职能上均不存在共性" };
class RankerUnavailable extends Error {}

const PROMPT_BASE = JSON.stringify({ system: SYSTEM, question: QUESTION, options: OPTIONS });
function promptShaOf(cap) { return crypto.createHash("sha256").update(PROMPT_BASE + "|cap=" + Number(cap)).digest("hex"); }
function checkpointKey(rankerId, cap, promptSha, row) { return String(rankerId) + "|cap=" + Number(cap) + "|prompt=" + promptSha + "|" + row.a_path + "|" + row.b_path; }

async function httpJson(url, body, timeout, signal) {
  const opts = { signal: withTimeout(signal, (timeout || 5.0) * 1000) };
  if (body === undefined) opts.method = "GET";
  else { opts.method = "POST"; opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}

async function probeLocal(cfg, signal) {
  const base = cfg.rank_server || "";
  if (!base) return [false, "rank_server 未配置"];
  try {
    const h = await httpJson(base.replace(/\/$/, "") + "/health", undefined, Number(cfg.rank_probe_timeout || 2.0), signal);
    if (String(h.status || "").toLowerCase() === "ok") return [true, ""];
    return [false, "health 返回 " + String(JSON.stringify(h)).slice(0, 120)];
  } catch (exc) { if (signal && signal.aborted) throw exc; return [false, "探活失败: " + String(exc).slice(0, 120)]; }
}

function state(byPath, aPath, bPath, cap) {
  function blk(tag, p) {
    const f = byPath.get(p);
    const body = f.body_core || f.body;
    return "<skill_" + tag + " name=\"" + f.name + "\">\n<description>" + f.description + "</description>\n<capability_and_triggers>\n" + extract.headExtract(f) + "\n</capability_and_triggers>\n<full_body>\n" + String(body).slice(0, cap) + "\n</full_body>\n</skill_" + tag + ">";
  }
  return blk("a", aPath) + "\n" + blk("b", bPath);
}

const EXP = Math.E;
async function askLocal(prompt, cfg, signal) {
  const base = String(cfg.rank_server || "").replace(/\/$/, "");
  const tmp = await httpJson(base + "/apply-template", { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], chat_template_kwargs: { enable_thinking: false } }, Number(cfg.rank_request_timeout || 120.0), signal);
  const out = await httpJson(base + "/completion", { prompt: tmp.prompt, n_predict: 1, temperature: -1, n_probs: 256, cache_prompt: false }, Number(cfg.rank_request_timeout || 120.0), signal);
  const rows = out.completion_probabilities || out.probs;
  if (!rows || !rows.length) throw new RankerUnavailable("返回无 completion_probabilities");
  const got = new Map();
  for (const t of rows[0].top_logprobs) got.set(t.id, t.logprob);
  const ids = Object.keys(OPTIONS);
  for (let i = 0; i < ids.length; i += 1) if (!got.has(LIDS[i])) throw new RankerUnavailable("返回缺少字母 token 概率");
  const sc = {};
  for (let i = 0; i < ids.length; i += 1) sc[i] = got.get(LIDS[i]) / TEMP_CHOICE;
  const mx = Math.max(...Object.values(sc));
  const ex = {}; let tot = 0;
  for (const k of Object.keys(sc)) { ex[k] = Math.pow(EXP, sc[k] - mx); tot += ex[k]; }
  const probs = {}; for (const k of Object.keys(ids)) probs[ids[k]] = ex[k] / tot;
  return probs.c + 0.5 * (probs.a + probs.b);
}

class Checkpoint {
  constructor(filePath, batchSize) {
    this.file = filePath || "";
    this.batch = Math.max(1, Number(batchSize) || 25);
    this.data = this._load();
    this.pending = 0;
    this.writes = 0;
    this.hits = 0;
  }
  _load() {
    try {
      if (this.file && exists(this.file)) {
        const j = readJson(this.file);
        if (j && typeof j === "object" && !Array.isArray(j)) return j;
      }
    } catch (e) { /* 损坏的 checkpoint 视为空，重算 */ }
    return {};
  }
  has(key) { const h = Object.prototype.hasOwnProperty.call(this.data, key); if (h) this.hits += 1; return h; }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; this.pending += 1; if (this.pending >= this.batch) this.flush(); }
  flush() {
    if (!this.file) return;
    atomicWrite(this.file, JSON.stringify(this.data, null, 1));
    this.pending = 0;
    this.writes += 1;
  }
  size() { return Object.keys(this.data).length; }
}

function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function apiKeyConfigured(cfg) {
  const envName = String(cfg.rank_api_key_env || "BAMBOO_API_KEY").trim() || "BAMBOO_API_KEY";
  return Boolean(process.env[envName]);
}

function localTiers(cfg) {
  const raw = String(cfg.rank_local_chain === undefined ? "q8,q4" : cfg.rank_local_chain || "").trim();
  if (!raw) return cfg.rank_server ? [{ name: "local", url: String(cfg.rank_server) }] : [];
  const legacy = cfg.rank_server ? String(cfg.rank_server) : "";
  const out = [];
  for (const token of raw.split(",").map(x => x.trim()).filter(Boolean)) {
    if (token === "q8") { const url = String(cfg.rank_server_q8 || legacy || "").trim(); if (url) out.push({ name: "q8", url }); }
    else if (token === "q4") { const url = String(cfg.rank_server_q4 || "").trim(); if (url) out.push({ name: "q4", url }); }
    else if (token === "local" || token === "default") { const url = legacy.trim(); if (url) out.push({ name: token === "default" ? "local" : token, url }); }
    else if (token.includes("=")) { const i = token.indexOf("="); const name = token.slice(0, i).trim(); const url = token.slice(i + 1).trim(); if (name && url) out.push({ name, url }); }
  }
  return out;
}

function tierCheckpointPath(cfg, tier, index) {
  const base = String(cfg.rank_checkpoint || "");
  if (!base || index === 0) return base;
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) + "." + tier.name + ext : base + "." + tier.name;
}

async function scoreTier(tier, rows, byPath, cfg, checkpoint, signal) {
  const tcfg = Object.assign({}, cfg, { rank_server: tier.url });
  const ckpt = new Checkpoint(checkpoint, cfg.rank_ckpt_batch);
  const cap = Number(cfg.rank_cap || 5000);
  const promptSha = promptShaOf(cap);
  const keyOf = r => checkpointKey(tier.name, cap, promptSha, r);
  const allCached = rows.every(r => Object.prototype.hasOwnProperty.call(ckpt.data, keyOf(r)));
  let probeOk = true;
  let probeReason = "";
  if (!allCached) { const pr = await probeLocal(tcfg, signal); probeOk = pr[0]; probeReason = pr[1]; }
  if (!probeOk) return { tier, ckpt, allCached, probeOk: false, probeReason, scored: [], failures: [], retries: 0, requestedConc: 1, conc: 1, slotsInfo: null };
  const requestedConc = Math.max(1, Math.min(8, Number(cfg.rank_concurrency || 1)));
  let conc = requestedConc;
  let slotsInfo = { slots: null, reason: requestedConc > 1 ? "" : "默认 1，不探测" };
  if (requestedConc > 1) { slotsInfo = await probeSlots(tcfg, signal); if (slotsInfo.slots) conc = Math.min(requestedConc, slotsInfo.slots); }
  const [scored, failures, retries] = await scoreLocal(rows, byPath, tcfg, ckpt, conc, signal, tier.name);
  ckpt.flush();
  return { tier, ckpt, allCached, probeOk: true, probeReason: "", scored, failures, retries: retries || 0, requestedConc, conc, slotsInfo };
}

function vecSelect(rows, cfg) {
  const k = Number(cfg.rank_vec_topk || 10);
  if (!rows.length) return [];
  const acc = new Map();
  for (const [projection, key] of [["body_core", "body_core_cosine"], ["summary", "summary_cosine"]]) {
    const order = [...Array(rows.length).keys()].sort((a, b) => ((Number(rows[b][key]) || 0) - (Number(rows[a][key]) || 0)) || (a - b));
    for (const i of order.slice(0, k)) {
      const r = rows[i];
      const kk = r.a_path + "\u0000" + r.b_path;
      let row = acc.get(kk);
      if (!row) { row = Object.assign({}, r); acc.set(kk, row); }
      row.rank_arms = row.rank_arms || []; row.rank_arms.push(projection + "_top");
    }
  }
  const picked = [...acc.keys()].sort().map(x => acc.get(x));
  for (const r of picked) {
    const s = Number(r.body_core_cosine || r.summary_cosine || 0.0);
    r.rank_score = Math.round(s * 10000) / 10000;
    r.rank_source = "vec_top" + k;
  }
  picked.sort((a, b) => (Number(b.rank_score) || 0) - (Number(a.rank_score) || 0));
  return picked;
}

async function probeSlots(cfg, signal) {
  const base = String(cfg.rank_server || "").replace(/\/$/, "");
  if (!base) return { slots: null, reason: "rank_server 未配置" };
  const timeout = Number(cfg.rank_probe_timeout || 2.0);
  for (const p of ["/props", "/slots"]) {
    try {
      const data = await httpJson(base + p, undefined, timeout, signal);
      let slots = null;
      if (data && Number.isInteger(data.total_slots) && data.total_slots > 0) slots = data.total_slots;
      else if (data && Array.isArray(data.slots) && data.slots.length) slots = data.slots.length;
      else if (data && Array.isArray(data.slot_list) && data.slot_list.length) slots = data.slot_list.length;
      if (slots) return { slots: slots, reason: "探测 " + p + " 成功" };
    } catch (e) { if (signal && signal.aborted) throw e; /* 尝试下一个端点 */ }
  }
  return { slots: null, reason: "slots 探测失败/不支持" };
}

async function plan(cfg, opts) {
  const requested = String(cfg.rank_mode || "auto");
  if (requested === "vec") return { requested: requested, use_local: false, reason: "显式指定 vec" };
  const [ok, reason] = await probeLocal(cfg, opts && opts.signal);
  return { requested: requested, use_local: !!ok, reason: ok ? "探活通过" : reason };
}

async function scoreLocal(rows, byPath, cfg, ckpt, concurrencyOverride, signal, rankerId) {
  const cap = Number(cfg.rank_cap || 5000);
  const ranker = rankerId || "local";
  const promptSha = promptShaOf(cap);
  const keyOf = r => checkpointKey(ranker, cap, promptSha, r);
  const concurrency = concurrencyOverride !== undefined
    ? Math.max(1, Math.min(8, Number(concurrencyOverride) || 1))
    : Math.max(1, Math.min(8, Number(cfg.rank_concurrency || 1)));
  const results = await mapLimit(rows, concurrency, async (r) => {
    const key = keyOf(r);
    if (ckpt.has(key)) return { r, score: Number(ckpt.get(key)), source: "local_quad_ckpt", retries: 0 };
    let retries = 0;
    try {
      const st = state(byPath, r.a_path, r.b_path, cap);
      const prompt = "Evidence:\n" + st + "\n\nQuestion: " + QUESTION + "\nOptions:\n" + Object.values(OPTIONS).map((v, k) => String.fromCharCode(65 + k) + ") " + v).join("\n") + "\nAnswer:";
      const score = Math.round((await withRetry(() => askLocal(prompt, cfg, signal), {
        retries: cfg.rank_retries, baseMs: cfg.rank_retry_backoff_ms, signal, onRetry: () => { retries += 1; }
      })) * 10000) / 10000;
      return { r, score, source: "local_quad", retries };
    } catch (exc) { if (signal && signal.aborted) throw exc; return { r, error: String(exc).slice(0, 140), retries }; }
  }, signal);
  const scored = [];
  const failures = [];
  let retries = 0;
  for (const x of results) {
    retries += Number(x.retries || 0);
    if (x.error) failures.push({ a: x.r.a, b: x.r.b, error: x.error });
    else { const r2 = Object.assign({}, x.r); r2.rank_score = x.score; r2.rank_source = x.source; scored.push(r2); }
  }
  for (const x of results) if (!x.error && x.source === "local_quad") { ckpt.set(keyOf(x.r), x.score); }
  return [scored, failures, retries];
}

async function scoreRemote(rows, byPath, cfg, signal) {
  const url = String(cfg.rank_api_url || "").trim();
  const envName = String(cfg.rank_api_key_env || "BAMBOO_API_KEY").trim() || "BAMBOO_API_KEY";
  const key = process.env[envName] || "";
  if (!url) return [[], rows.map(r => ({ a: r.a, b: r.b, error: "rank_api_url 未配置" })), "rank_api_url 未配置"];
  if (!key) return [[], rows.map(r => ({ a: r.a, b: r.b, error: "环境变量 " + envName + " 未设置" })), "环境变量 " + envName + " 未设置"];
  const cap = Number(cfg.rank_cap || 5000);
  const concurrency = Math.max(1, Math.min(8, Number(cfg.rank_concurrency || 1)));
  const model = String(cfg.rank_api_model || "startlux-decision-27b-autothink");
  const thinkMode = String(cfg.rank_api_think_mode || "never");
  const timeoutMs = Math.max(1000, Number(cfg.rank_api_timeout || 120) * 1000);
  const results = await mapLimit(rows, concurrency, async (r) => {
    let retries = 0;
    try {
      const score = await withRetry(async () => {
        const st = state(byPath, r.a_path, r.b_path, cap);
        const body = {
          model,
          state: st,
          questions: { pair: { type: "choice", instructions: QUESTION, criteria: OPTIONS } },
          think_mode: thinkMode,
          allow_none: false,
          none_check: false,
        };
        const resp = await proxiedFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify(body),
          signal: withTimeout(signal, timeoutMs),
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 160));
        const data = await resp.json();
        const probabilities = data && data.answers && data.answers.pair && data.answers.pair.probabilities;
        if (!probabilities) throw new Error("返回缺少 answers.pair.probabilities");
        const a = Number(probabilities.a);
        const b = Number(probabilities.b);
        const c = Number(probabilities.c);
        const d = Number(probabilities.d);
        if (![a, b, c, d].every(Number.isFinite)) throw new Error("probabilities 缺少 a/b/c/d");
        return Math.round((c + 0.5 * (a + b)) * 10000) / 10000;
      }, { retries: cfg.rank_retries, baseMs: cfg.rank_retry_backoff_ms, signal, onRetry: () => { retries += 1; } });
      return { r, score, source: "api_quad", retries };
    } catch (exc) { if (signal && signal.aborted) throw exc; return { r, error: String(exc).slice(0, 160), retries }; }
  }, signal);
  const scored = [];
  const failures = [];
  let retries = 0;
  for (const x of results) {
    retries += Number(x.retries || 0);
    if (x.error) failures.push({ a: x.r.a, b: x.r.b, error: x.error });
    else { const r2 = Object.assign({}, x.r); r2.rank_score = x.score; r2.rank_source = x.source; scored.push(r2); }
  }
  const reason = failures.length ? failures[0].error : "";
  return [scored, failures, reason, retries];
}
async function rerank(rows, byPath, cfg, opts) {
  const signal = opts && opts.signal;
  throwIfAborted(signal);
  const t0 = Date.now();
  const requested = String(cfg.rank_mode || "auto");
  const stats = {
    mode_requested: requested, mode_used: null, degraded: false, reason: "", reason_code: null,
    n_in: rows.length, n_out: 0, n: Number(cfg.rank_n || 20), cap: Number(cfg.rank_cap || 5000),
    ckpt_hits: 0, ckpt_all: false, attempts: [], local_scored: 0, local_failed: 0, rank_retries: 0, failures: [],
    vec_ranker: { id: "vec", modelId: "vec:cosine", scoreRange: [0, 1] }
  };
  let apiPartial = null;
  if (!rows.length) { stats.mode_used = "none"; stats.reason = "无候选"; stats.secs = (Date.now() - t0) / 1000; return [[], stats]; }
  if (requested === "api" || (requested === "auto" && apiKeyConfigured(cfg))) {
    const apiModelId = String(cfg.rank_api_model || "startlux-decision-27b-autothink");
    const apiProvider = makeRankerProvider({ id: "api:" + apiModelId, modelId: apiModelId, scoreRange: RANKER_SCORE_RANGE, score: async (rs, bp, o) => { const [scored, failures, reason, retries] = await scoreRemote(rs, bp, cfg, o && o.signal); return { scored, failures, reason, retries }; } });
    stats.api_ranker = { id: apiProvider.id, modelId: apiProvider.modelId, scoreRange: apiProvider.scoreRange };
    const apiRes = await apiProvider.score(rows, byPath, { signal });
    const apiScored = apiRes.scored || [];
    const apiFailures = apiRes.failures || [];
    const apiReason = apiRes.reason || "";
    stats.rank_retries += Number(apiRes.retries || 0);
    stats.api_scored = apiScored.length;
    stats.api_failed = apiFailures.length;
    stats.api_reason = apiReason;
    if (apiFailures.length === 0 && apiScored.length === rows.length) {
      apiScored.sort((x, y) => ((Number(y.rank_score) || 0) - (Number(x.rank_score) || 0)) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      const picked = apiScored.slice(0, stats.n);
      picked.forEach((r, i) => { r.rank_rank = i + 1; });
      stats.mode_used = "api"; stats.reason = "API 精排可用";
      stats.n_out = picked.length; stats.secs = Math.round((Date.now() - t0) / 100) / 10;
      return [picked, stats];
    }
    stats.attempts.push({ tier: "api", phase: "run", ok: false, reasonCode: "api-unavailable", error: apiReason || "unknown" });
    if (apiScored.length > 0) {
      apiPartial = { scored: apiScored, failures: apiFailures };
      stats.api_partial = true;
      stats.degraded = true;
      stats.reason_code = "api-partial";
      stats.reason = "API 部分成功，仅失败行回退本地/向量";
      stats.attempts.push({ tier: "api", phase: "run", ok: true, reasonCode: "partial", error: (apiFailures.length + " 对失败") });
    }
  }
  const apiScoredKeys = new Set((apiPartial ? apiPartial.scored : []).map(r => r.a_path + "\u0000" + r.b_path));
  const workRows = apiPartial ? rows.filter(r => !apiScoredKeys.has(r.a_path + "\u0000" + r.b_path)) : rows;
  let picked = null;
  if (requested === "vec") {
    picked = vecSelect(rows, cfg);
    stats.mode_used = "vec"; stats.reason = "显式指定 vec";
  } else {
    const tiers = localTiers(cfg);
    stats.local_chain = tiers.map(t => t.name);
    let firstFailReason = "";
    let used = null;
    for (let ti = 0; ti < tiers.length; ti += 1) {
      const tier = tiers[ti];
      const r = await scoreTier(tier, workRows, byPath, cfg, tierCheckpointPath(cfg, tier, ti), signal);
      stats.ckpt_hits += r.ckpt.hits;
      stats.rank_retries += Number(r.retries || 0);
      if (!r.probeOk) {
        stats.attempts.push({ tier: tier.name, phase: "probe", ok: false, reasonCode: classifyReason(r.probeReason), error: r.probeReason });
        if (!firstFailReason) firstFailReason = r.probeReason;
        continue;
      }
      stats.rank_concurrency_requested = r.requestedConc;
      stats.rank_concurrency_used = r.conc;
      stats.rank_slots = r.slotsInfo && r.slotsInfo.slots;
      stats.rank_slots_reason = r.slotsInfo && r.slotsInfo.reason;
      stats.local_scored += r.scored.length;
      stats.local_failed += r.failures.length;
      stats.attempts.push(...r.failures.map(f => ({ tier: tier.name, phase: "run", ok: false, reasonCode: classifyReason(f.error), error: f.error })).slice(0, 20));
      if (!r.scored.length) {
        if (!firstFailReason) firstFailReason = r.failures.length ? r.failures[0].error : "本地打分全部失败";
        continue;
      }
      used = r;
      stats.local_tier_used = tier.name;
      stats.local_ranker = { id: "local:" + tier.name, modelId: tier.name, scoreRange: [0, 1] };
      break;
    }
    if (!used) {
      picked = vecSelect(workRows, cfg);
      stats.mode_used = "vec"; stats.degraded = true;
      stats.reason_code = firstFailReason ? classifyReason(firstFailReason) : "all-down";
      stats.reason = "本地精排链全部不可用 ⇒ 向量口径: " + String(firstFailReason || "无本地候选").slice(0, 160);
    } else if (used.allCached && !used.failures.length) {
      const scored = used.scored.slice().sort((x, y) => ((Number(y.rank_score) || 0) - (Number(x.rank_score) || 0)) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      picked = scored.slice(0, stats.n);
      stats.ckpt_all = true;
      stats.mode_used = "local"; stats.reason = "全部命中 checkpoint（0 调用，tier=" + used.tier.name + "）";
    } else if (used.failures.length) {
      const scored = used.scored.slice().sort((x, y) => ((Number(y.rank_score) || 0) - (Number(x.rank_score) || 0)) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      picked = scored.slice(0, stats.n);
      const have = new Set(picked.map(x => x.a_path + "\u0000" + x.b_path));
      const rest = workRows.filter(x => !have.has(x.a_path + "\u0000" + x.b_path));
      const fill = vecSelect(rest, cfg);
      for (const x of fill) x.rank_source = "vec_fallback";
      picked = picked.concat(fill.slice(0, stats.n - picked.length));
      stats.mode_used = "local_partial"; stats.degraded = true; stats.reason_code = "partial-fill";
      stats.reason = used.failures.length + " 对本地打分失败（tier=" + used.tier.name + "），其余按向量口径补位";
      stats.failures = used.failures.slice(0, 10);
    } else {
      const scored = used.scored.slice().sort((x, y) => ((Number(y.rank_score) || 0) - (Number(x.rank_score) || 0)) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      picked = scored.slice(0, stats.n);
      stats.mode_used = "local"; stats.reason = "本地精排可用（tier=" + used.tier.name + "）";
    }
  }
  if (apiPartial) {
    const localMode = stats.mode_used;
    const seen = new Set();
    const combined = [];
    for (const row of apiPartial.scored.concat(picked || [])) {
      const key = row.a_path + "\u0000" + row.b_path;
      if (seen.has(key)) continue;
      seen.add(key); combined.push(row);
    }
    combined.sort((x, y) => ((Number(y.rank_score) || 0) - (Number(x.rank_score) || 0)) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
    picked = combined.slice(0, stats.n);
    stats.mode_used = "api_partial";
    stats.degraded = true;
    stats.reason_code = "api-partial";
    stats.reason = "API 部分成功，仅 " + apiPartial.failures.length + " 对失败行回退（" + localMode + "）";
  }
  picked.forEach((r, i) => { r.rank_rank = i + 1; });
  stats.n_out = picked.length;
  stats.secs = Math.round((Date.now() - t0) / 100) / 10;
  return [picked, stats];
}
export { probeLocal, probeSlots, askLocal, scoreLocal, vecSelect, plan, rerank, Checkpoint, RankerUnavailable, LIDS, TEMP_CHOICE, OPTIONS, QUESTION, SYSTEM };