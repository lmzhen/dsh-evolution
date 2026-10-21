"use strict";
import { pairScore } from "./candidates.js";
import { viaFromNets, assertSelectedPairs } from "./contract.js";
function lexicalGate(skills, pairs, cfg) {
  const byPath = new Map(skills.map(s => [s.path, s]));
  const rows = [];
  for (const [k, via] of pairs) {
    const [pa, pb] = k.split("\u0000");
    const js = Number(via.jaccard_summary || 0.0);
    const jb = Number(via.jaccard_body || 0.0);
    rows.push({ a: byPath.get(pa).name, b: byPath.get(pb).name, a_path: pa, b_path: pb, jaccard_summary: js, jaccard_body: jb, score: pairScore(js, jb), via: via.via || viaFromNets(via.nets), arm: Array.isArray(via.arm) ? via.arm.slice() : ["lsh"] });
  }
  const n = rows.length;
  const absArm = new Set();
  for (let i = 0; i < n; i += 1) if (rows[i].jaccard_body >= cfg.body_gate || rows[i].jaccard_summary >= cfg.summary_gate) absArm.add(i);
  const budget = n ? Math.min(Math.trunc(n * cfg.gate_global_frac), cfg.gate_global_cap) : 0;
  const armsTop1 = {}, armsGlobal = {};
  const top1 = new Set(), glob = new Set();
  for (const metric of ["jaccard_summary", "jaccard_body"]) {
    const perSkill = new Map();
    for (let i = 0; i < n; i += 1) {
      const r = rows[i];
      for (const p of [r.a_path, r.b_path]) { let arr = perSkill.get(p); if (!arr) { arr = []; perSkill.set(p, arr); } arr.push([r[metric], i]); }
    }
    const k = cfg.gate_per_skill_topk || 1;
    const picked1 = new Set();
    for (const arr of perSkill.values()) { arr.sort((x, y) => (y[0] - x[0]) || (x[1] - y[1])); for (const [, idx] of arr.slice(0, k)) picked1.add(idx); }
    armsTop1[metric] = picked1.size;
    for (const idx of picked1) top1.add(idx);
    const order = [...Array(n).keys()].sort((x, y) => (rows[y][metric] - rows[x][metric]) || (x - y));
    const pickedg = new Set(order.slice(0, budget));
    armsGlobal[metric] = pickedg.size;
    for (const idx of pickedg) glob.add(idx);
  }
  for (const i of absArm) rows[i].arm.push("absolute");
  for (const i of top1) rows[i].arm.push("topk");
  for (const i of glob) rows[i].arm.push("global");
  const passedIdx = [...new Set([...absArm, ...top1, ...glob])].sort((a, b) => a - b);
  const passed = passedIdx.map(i => { const r = rows[i]; r.arm = [...new Set(r.arm)]; return r; });
  assertSelectedPairs(passed, "lexical");
  return [passed, rows, {
    candidates: n, passed_lexical: passed.length, arm_absolute: absArm.size,
    arm_topk_per_projection: top1.size, arm_topk_detail: armsTop1, gate_per_skill_topk: cfg.gate_per_skill_topk || 1,
    arm_top1_per_projection: top1.size, arm_top1_detail: armsTop1,
    arm_global_per_projection: glob.size, arm_global_detail: armsGlobal,
    gate_global_budget_per_projection: budget, gate_global_cap: cfg.gate_global_cap,
    gate_global_denominator: "candidates", body_gate: cfg.body_gate, summary_gate: cfg.summary_gate
  }];
}
export { lexicalGate };