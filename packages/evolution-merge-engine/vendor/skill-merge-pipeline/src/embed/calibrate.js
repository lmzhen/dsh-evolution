"use strict";
// G4.5：语料 → quantile+margin → 版本化校准产物（确定性、可逐字节复现）。
import path from "node:path";
import crypto from "node:crypto";
import * as corpus from "../corpus.js";
import * as prefilter from "../screening/prefilter.js";
import * as candidates from "../screening/candidates.js";
import * as lexical from "../screening/lexical.js";
import { artifactDir } from "../models/registry.js";
import { StaticTable } from "./static_table.js";
import { makeConfig } from "../config.js";
import { InvalidDataError } from "../errors.js";

function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

function canonicalStringify(value) {
  function norm(v) {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  }
  return JSON.stringify(norm(value), null, 2) + "\n";
}

function quantileLinear(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

function round4(x) { return Math.round(x * 10000) / 10000; }
function clip01(x) { return Math.max(0, Math.min(1, x)); }

function normalizeRel(p, roots) {
  const abs = path.resolve(p);
  for (const root of roots) {
    const rr = path.resolve(root);
    const rel = path.relative(rr, abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  }
  return abs.split(path.sep).join("/");
}

function projectionText(skill, projection) { return projection === "summary" ? skill.summary : (skill.body_core || skill.body); }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; }

function localTiers(registry, requested) {
  const modelOf = id => registry.models.find(m => m.id === id);
  const local = registry.tiers.filter(t => modelOf(t.modelRef).compute === "local-static");
  if (!requested || !requested.length) return local;
  const out = [];
  for (const id of requested) {
    const t = registry.tiers.find(x => x.id === id);
    if (!t) throw new InvalidDataError("未知档位: " + id, { where: "calibrate" });
    const m = modelOf(t.modelRef);
    if (m.compute !== "local-static") throw new InvalidDataError("远程档不在校准工具范围（需联网/付费）: " + id, { where: "calibrate" });
    if (!m.artifactRef) throw new InvalidDataError("档位缺少 artifactRef: " + id, { where: "calibrate" });
    out.push(t);
  }
  return out;
}

async function calibrateCorpus(opts) {
  const o = opts || {};
  const registry = o.registry;
  const registryFile = o.registryFile;
  const rootDir = o.rootDir;
  const roots = Array.isArray(o.corpus) ? o.corpus : [o.corpus];
  if (!roots.length || !roots[0]) throw new InvalidDataError("calibrate 需要 --corpus", { where: "calibrate" });
  const quantile = o.quantile === undefined ? 0.95 : Number(o.quantile);
  const margin = o.margin === undefined ? 0 : Number(o.margin);
  if (!(quantile >= 0 && quantile <= 1)) throw new InvalidDataError("quantile 必须在 [0,1]: " + quantile, { where: "calibrate" });
  if (!Number.isFinite(margin)) throw new InvalidDataError("margin 必须是数值", { where: "calibrate" });
  const minPairs = o.minPairs === undefined ? 10 : Number(o.minPairs);
  const cfg = o.cfg || makeConfig();
  const [skills] = corpus.loadCorpus(roots);
  corpus.stripBoilerplate(skills, cfg);
  const [kept] = prefilter.prefilter(skills, cfg);
  const fixedCfg = makeConfig({ seed_mode: "fixed", round_count: 1 });
  const [pairs] = candidates.generateCandidates(kept, fixedCfg);
  const [passed] = lexical.lexicalGate(kept, pairs, fixedCfg);
  if (passed.length < minPairs) throw new InvalidDataError("样本对不足: " + passed.length + " < " + minPairs + "（换更大语料或调低 --min-pairs）", { where: "calibrate" });
  const byPath = new Map(kept.map(s => [s.path, s]));
  const participants = [...new Set(passed.flatMap(r => [r.a_path, r.b_path]))].sort();
  const skillsForSha = kept.map(s => ({ path: normalizeRel(s.path, roots), bodySha: sha256(projectionText(s, "body_core")), summarySha: sha256(projectionText(s, "summary")) })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const pairsForSha = passed.map(r => [normalizeRel(r.a_path, roots), normalizeRel(r.b_path, roots)]).sort((a, b) => (a[0] + "\u0000" + a[1] < b[0] + "\u0000" + b[1] ? -1 : 1));
  const samplesSha = sha256(canonicalStringify({ version: 1, skills: skillsForSha, pairs: pairsForSha }));
  const tiers = localTiers(registry, o.tiers);
  if (!tiers.length) throw new InvalidDataError("registry 中没有可校准的本地档", { where: "calibrate" });
  const floors = {};
  for (const tier of tiers) {
    const m = registry.models.find(x => x.id === tier.modelRef);
    const dir = artifactDir(registry, registryFile, m.artifactRef, rootDir);
    const table = new StaticTable(dir, { cache: true });
    try {
      const perProjection = {};
      for (const projection of ["body_core", "summary"]) {
        const texts = participants.map(p => projectionText(byPath.get(p), projection));
        const vecs = await table.fitTransform(texts);
        const idx = new Map(participants.map((p, i) => [p, i]));
        const cosines = passed.map(r => dot(vecs[idx.get(r.a_path)], vecs[idx.get(r.b_path)]));
        const sorted = cosines.slice().sort((a, b) => a - b);
        perProjection[projection] = round4(clip01(quantileLinear(sorted, quantile) + margin));
      }
      floors[tier.id] = { body: perProjection.body_core, summary: perProjection.summary };
    } finally { table.close(); }
  }
  const artifact = { schemaVersion: 1, calibration: { version: 1, samplesSha, n: passed.length, quantile, margin, floors } };
  return { artifact, canonical: canonicalStringify(artifact), samples: { skills: kept.length, pairs: passed.length, participants: participants.length }, floors };
}

export { calibrateCorpus, canonicalStringify, quantileLinear, sha256, normalizeRel };