"use strict";
import * as ledger from "../ledger.js";
// ② 候选生成：LSH 收网 + 三条渠道并集（与 Python candidates.py 等价）
import { tokenSet, shingles, jaccardSets } from "../textutil.js";
import { minhashSignature } from "../minhash/signature.js";
import { lshParams } from "../minhash/lsh.js";
import { roundHalfEven } from "../numeric.js";
import { PyRandom } from "../pyrandom.js";
import { viaFromNets, assertSelectedPairs } from "./contract.js";
function projectionText(s, projection) { return projection === "summary" ? s.summary : (s.body_core || s.body); }
function pairScore(js, jb) { return Math.max(js, jb); }

function roundParams(cfg, rnd, useRng, rng) {
  let seed, floor;
  if (useRng) seed = rng.randint(1, 1000000);
  else seed = cfg.minhash_seed + rnd;
  if (cfg.floor_jitter > 0) {
    if (useRng) floor = cfg.lsh_floor + rng.uniform(-cfg.floor_jitter, cfg.floor_jitter);
    else floor = cfg.lsh_floor + (rnd % 2 ? cfg.floor_jitter : -cfg.floor_jitter);
  } else floor = cfg.lsh_floor;
  floor = Math.max(0.01, roundHalfEven(floor, 4));
  return [seed, floor];
}
function pairCmp(ka, kb) { const a = ka.split("\u0000"), b = kb.split("\u0000"); return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; }
function reach(skills, projection, sigs, floor, onSnap) {
  const [b, r] = lshParams(floor, onSnap);
  const buckets = new Map();
  for (const s of skills) {
    const sig = sigs.get(s.path);
    if (!sig) continue;
    for (let bi = 0; bi < b; bi += 1) {
      const key = bi + "|" + sig.slice(bi * r, (bi + 1) * r).join(",");
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(s.path);
    }
  }
  const pairs = new Set();
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i += 1) for (let j = i + 1; j < arr.length; j += 1) {
      const a = arr[i], bb = arr[j];
      pairs.add(a < bb ? a + "\u0000" + bb : bb + "\u0000" + a);
    }
  }
  return pairs;
}
function selectPerProjection(poolKeys, exactOne, totalPairs, cfg) {
  const armStrong = new Set();
  for (const k of poolKeys) if (exactOne.get(k) >= cfg.select_jaccard_min) armStrong.add(k);
  const perSkill = new Map();
  for (const k of poolKeys) {
    const sc = exactOne.get(k);
    for (const p of k.split("\u0000")) { let arr = perSkill.get(p); if (!arr) { arr = []; perSkill.set(p, arr); } arr.push([sc, k]); }
  }
  const armTopk = new Set();
  for (const arr of perSkill.values()) {
    arr.sort((x, y) => (y[0] - x[0]) || pairCmp(x[1], y[1]));
    for (const [, k] of arr.slice(0, cfg.top_k)) armTopk.add(k);
  }
  const budget = Math.min(Math.trunc(totalPairs * cfg.global_frac), cfg.global_cap);
  const ranked = [...poolKeys].sort((x, y) => (exactOne.get(y) - exactOne.get(x)) || pairCmp(x, y));
  const armGlobal = new Set(ranked.slice(0, budget));
  return [new Set([...armStrong, ...armTopk, ...armGlobal]), { arm_strong: armStrong.size, arm_topk: armTopk.size, arm_global: armGlobal.size, global_budget: budget }];
}
function selectMerged(poolKeys, exact, totalPairs, cfg) {
  const armStrong = new Set();
  for (const k of poolKeys) { const [js, jb] = exact.get(k); if (js >= cfg.select_jaccard_min || jb >= cfg.select_jaccard_min) armStrong.add(k); }
  const perSkill = new Map();
  for (const k of poolKeys) {
    const [js, jb] = exact.get(k); const sc = pairScore(js, jb);
    for (const p of k.split("\u0000")) { let arr = perSkill.get(p); if (!arr) { arr = []; perSkill.set(p, arr); } arr.push([sc, k]); }
  }
  const armTopk = new Set();
  for (const arr of perSkill.values()) {
    arr.sort((x, y) => (y[0] - x[0]) || pairCmp(x[1], y[1]));
    for (const [, k] of arr.slice(0, cfg.top_k)) armTopk.add(k);
  }
  const budget = Math.min(Math.trunc(totalPairs * cfg.global_frac), cfg.global_cap);
  const ranked = [...poolKeys].sort((x, y) => (pairScore(...exact.get(y)) - pairScore(...exact.get(x))) || pairCmp(x, y));
  const armGlobal = new Set(ranked.slice(0, budget));
  return [new Set([...armStrong, ...armTopk, ...armGlobal]), { arm_strong: armStrong.size, arm_topk: armTopk.size, arm_global: armGlobal.size, global_budget: budget }];
}
function runSeedOf(cfg) {
  if (cfg.seed_mode === "fixed") return cfg.minhash_seed;
  return (Date.now() ^ ((process.pid << 8) >>> 0)) & 0x7FFFFFFF;
}
function generateCandidates(skills, cfg) {
  const byPath = new Map(skills.map(s => [s.path, s]));
  const totalPairs = Math.trunc(skills.length * (skills.length - 1) / 2);
  const projections = [];
  if (cfg.use_summary_index) projections.push("summary");
  if (cfg.use_body_index) projections.push("body");
  const seed0 = runSeedOf(cfg);
  const useRng = cfg.randomize_seed || cfg.seed_mode === "run";
  const rng = new PyRandom(seed0);
  const tok = new Map();
  for (const s of skills) { const m = {}; for (const proj of projections) m[proj] = tokenSet(projectionText(s, proj)); tok.set(s.path, m); }
  // 签名外提：特征与签名只算一次，多轮只重新分桶（Node 签名与轮次 seed 无关）
  const sigByProj = new Map(projections.map(p => [p, new Map()]));
  for (const s of skills) {
    for (const proj of projections) {
      const text = projectionText(s, proj);
      if (!String(text).trim()) continue;
      const feats = cfg.net_vocabulary === "shingle" ? shingles(text, cfg.shingle_size) : tok.get(s.path)[proj];
      sigByProj.get(proj).set(s.path, minhashSignature(feats));
    }
  }
  const snapWarnings = [];
  const onSnap = info => { if (!snapWarnings.some(w => w.requested === info.requested)) snapWarnings.push(info); };
  const selected = new Map();
  const roundsMeta = [];
  let prev = 0;
  for (let rnd = 0; rnd < cfg.round_count; rnd += 1) {
    const [seed, floor] = roundParams(cfg, rnd, useRng, rng);
    const netOf = new Map();
    const reachByProj = {};
    const pool = new Set();
    for (const proj of projections) {
      const r = reach(skills, proj, sigByProj.get(proj), floor, onSnap);
      reachByProj[proj] = r;
      for (const k of r) { let arr = netOf.get(k); if (!arr) { arr = new Set(); netOf.set(k, arr); } arr.add(proj); pool.add(k); }
    }
    const exact = new Map();
    for (const k of pool) {
      const [pa, pb] = k.split("\u0000");
      const js = projections.includes("summary") ? jaccardSets(tok.get(pa).summary, tok.get(pb).summary) : 0.0;
      const jb = projections.includes("body") ? jaccardSets(tok.get(pa).body, tok.get(pb).body) : 0.0;
      exact.set(k, [js, jb]);
    }
    let chosen, arms;
    if (cfg.topk_mode === "merged") { [chosen, arms] = selectMerged(pool, exact, totalPairs, cfg); }
    else {
      chosen = new Set();
      arms = { arm_strong: 0, arm_topk: 0, arm_global: 0, global_budget: 0 };
      for (const proj of projections) {
        const one = new Map();
        for (const k of reachByProj[proj]) one.set(k, proj === "summary" ? exact.get(k)[0] : exact.get(k)[1]);
        const [selP, armsP] = selectPerProjection([...one.keys()], one, totalPairs, cfg);
        for (const k of selP) chosen.add(k);
        arms.arm_strong += armsP.arm_strong; arms.arm_topk += armsP.arm_topk; arms.arm_global += armsP.arm_global;
        arms.global_budget = armsP.global_budget;
      }
    }
    for (const k of chosen) {
      let row = selected.get(k);
      if (!row) { row = { jaccard_summary: 0.0, jaccard_body: 0.0, rounds: [], nets: [] }; selected.set(k, row); }
      const [pa, pb] = k.split("\u0000");
      row.a = byPath.get(pa).name; row.b = byPath.get(pb).name;
      row.a_path = pa; row.b_path = pb;
      for (const p of [...(netOf.get(k) || [])].sort()) if (!row.nets.includes(p)) row.nets.push(p);
      const [js, jb] = exact.get(k);
      row.jaccard_summary = Math.max(row.jaccard_summary, Math.round(js * 10000) / 10000);
      row.jaccard_body = Math.max(row.jaccard_body, Math.round(jb * 10000) / 10000);
      row.via = viaFromNets(row.nets);
      row.arm = ["lsh"];
      row.score = Math.max(row.jaccard_summary, row.jaccard_body);
      if (!row.rounds.includes(rnd)) row.rounds.push(rnd);
    }
    const reachCounts = {};
    for (const proj of projections) reachCounts[proj] = reachByProj[proj].size;
    const meta = { round: rnd, seed: seed, floor: floor, reach_by_projection: reachCounts, pool: pool.size, selected: chosen.size, cumulative_pairs: selected.size, new_pairs: selected.size - prev };
    Object.assign(meta, arms);
    prev = selected.size;
    roundsMeta.push(meta);
  }
  const stats = {
    skills_indexed: skills.length, possible_pairs: totalPairs,
    floor_base: cfg.lsh_floor, floor_jitter: cfg.floor_jitter, net_vocabulary: cfg.net_vocabulary,
    rounds: cfg.round_count, randomize_seed: cfg.randomize_seed, top_k: cfg.top_k,
    run_seed: seed0, seed_mode: cfg.seed_mode, rounds_detail: roundsMeta, candidate_pairs: selected.size,
    budget_ratio: skills.length ? Math.round((selected.size / skills.length) * 100) / 100 : 0.0,
    via_summary: [...selected.values()].filter(v => v.nets.includes("summary")).length,
    via_body: [...selected.values()].filter(v => v.nets.includes("body")).length,
    via_both: [...selected.values()].filter(v => v.nets.length > 1).length,
    found_in_multiple_rounds: [...selected.values()].filter(v => v.rounds.length > 1).length
  };
  if (snapWarnings.length) stats.lsh_snapped = snapWarnings;
  if (cfg.ledger_path) {
    const seen = ledger.load(cfg.ledger_path);
    let known = 0;
    for (const [k, row] of selected) {
      const [a, b] = k.split("\u0000");
      const lk = ledger.pairKey(a, b);
      row.known = Object.prototype.hasOwnProperty.call(seen, lk);
      if (row.known) known += 1;
    }
    stats.ledger_total_before = Object.keys(seen).length;
    stats.known_pairs = known;
    stats.unseen_pairs = selected.size - known;
    if (cfg.emit_only_new) {
      for (const k of [...selected.keys()]) if (selected.get(k).known) selected.delete(k);
      stats.emitted_pairs = selected.size;
    }
  }
  stats.candidate_pairs = selected.size;
  assertSelectedPairs([...selected.values()], "candidates");
  return [selected, stats, byPath];
}
export { projectionText, pairScore, generateCandidates, roundParams, runSeedOf, lshParams };