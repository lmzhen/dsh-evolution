"use strict";
// G5.1：Ranker provider 契约（id/modelId/scoreRange/score + 可注入 fake 链）。
import { InvalidDataError } from "../errors.js";

const RANKER_SCORE_RANGE = Object.freeze([0, 1]);

function round4(v) { return Math.round(Number(v) * 10000) / 10000; }

function makeRankerProvider(spec) {
  const s = spec || {};
  const provider = {
    id: String(s.id || ""),
    modelId: String(s.modelId || s.id || ""),
    scoreRange: Array.isArray(s.scoreRange) ? s.scoreRange.slice() : RANKER_SCORE_RANGE.slice(),
    score: s.score
  };
  return assertRankerProvider(provider);
}

function assertRankerProvider(provider) {
  if (!provider || typeof provider !== "object") throw new InvalidDataError("ranker provider 必须是对象", { where: "ranker-provider" });
  if (!provider.id) throw new InvalidDataError("ranker provider 缺少 id", { where: "ranker-provider" });
  if (!provider.modelId) throw new InvalidDataError("ranker provider 缺少 modelId: " + provider.id, { where: "ranker-provider" });
  if (!Array.isArray(provider.scoreRange) || provider.scoreRange.length !== 2 || Number(provider.scoreRange[0]) !== 0 || Number(provider.scoreRange[1]) !== 1) {
    throw new InvalidDataError("ranker provider scoreRange 必须是 [0,1]: " + provider.id, { where: "ranker-provider" });
  }
  if (typeof provider.score !== "function") throw new InvalidDataError("ranker provider 缺少 score(rows): " + provider.id, { where: "ranker-provider" });
  return provider;
}

function normalizeScore(value, provider) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new InvalidDataError("ranker 分数越界: " + value + " (" + provider.id + ")", { where: "ranker-provider" });
  return round4(n);
}

async function runRankerChain(providers, rows, byPath, opts) {
  const list = (providers || []).map(assertRankerProvider);
  let remaining = (rows || []).slice();
  const scored = [];
  const failures = [];
  const attempts = [];
  for (const provider of list) {
    if (!remaining.length) break;
    const r = await provider.score(remaining, byPath, opts);
    const okRows = (r && r.scored) || [];
    const bad = (r && r.failures) || [];
    for (const row of okRows) { row.rank_score = normalizeScore(row.rank_score, provider); row.rank_provider = provider.id; scored.push(row); }
    attempts.push({ id: provider.id, scored: okRows.length, failed: bad.length, reason: (r && r.reason) || "" });
    for (const f of bad) failures.push(f);
    const badKeys = new Set(bad.map(f => f.a_path + "\u0000" + f.b_path));
    remaining = remaining.filter(row => badKeys.has(row.a_path + "\u0000" + row.b_path));
  }
  const unresolved = new Set(remaining.map(row => row.a_path + "\u0000" + row.b_path));
  for (const row of remaining) failures.push({ a: row.a, b: row.b, a_path: row.a_path, b_path: row.b_path, error: "no-ranker" });
  return { scored, failures: failures.filter(f => unresolved.has(f.a_path + "\u0000" + f.b_path)), attempts };
}

export { RANKER_SCORE_RANGE, makeRankerProvider, assertRankerProvider, normalizeScore, runRankerChain };