// G9-S0：从 ⑤ 的 pairs/evidence + 语料构建 MergeCard（确定性，0 token）。
import path from "node:path";
import { loadCorpus, stripBoilerplate } from "../corpus.js";
import { listDir } from "../io/read.js";
import { MERGE_SCHEMA_VERSION } from "./schema.js";

const MAX_UNIT_CHARS = 1500;
const MAX_SUPPORT_FILES = 50;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export function loadCorpusSkills(roots, cfg) {
  const [all] = loadCorpus(roots);
  stripBoilerplate(all, cfg);
  const byName = new Map();
  for (const s of all) byName.set(s.name, s);
  return byName;
}

export function supportFilesOf(skillPath) {
  const out = [];
  const dir = path.dirname(skillPath);
  const tops = ["references", "templates", "scripts", "assets"];
  function walk(base, rel, depth) {
    if (out.length >= MAX_SUPPORT_FILES) return;
    let entries;
    try { entries = listDir(base); } catch (e) { return; }
    for (const e of entries) {
      const nextRel = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory) { if (depth < 2) walk(path.join(base, e.name), nextRel, depth + 1); }
      else out.push(nextRel);
    }
  }
  for (const t of tops) {
    const p = path.join(dir, t);
    let ok = false;
    try { listDir(p); ok = true; } catch (e) { ok = false; }
    if (ok) walk(p, t, 0);
  }
  return out.sort();
}

export function segmentUnits(prefix, skill) {
  const body = String(skill.body_core || skill.body || "");
  const units = [];
  let cur = { heading: "", level: 0, lines: [] };
  const flush = () => {
    const text = cur.lines.join("\n").trim();
    if (!text && !cur.heading) return;
    const uid = prefix + String(units.length + 1).padStart(3, "0");
    const heading = cur.heading;
    const fullChars = text.length;
    units.push({ uid, kind: heading ? "section" : "preamble", heading, level: cur.level, chars: fullChars, text: text.slice(0, MAX_UNIT_CHARS), truncated: fullChars > MAX_UNIT_CHARS });
  };
  for (const line of body.split("\n")) {
    const m = HEADING_RE.exec(line);
    if (m) { flush(); cur = { heading: line.trim(), level: m[1].length, lines: [] }; } else { cur.lines.push(line); }
  }
  flush();
  if (!units.length) {
    const text = body.trim();
    if (text) units.push({ uid: prefix + "001", kind: "preamble", heading: "", level: 0, chars: text.length, text: text.slice(0, MAX_UNIT_CHARS), truncated: text.length > MAX_UNIT_CHARS });
  }
  return units;
}

function evidenceOf(pair) {
  const out = [];
  const trail = Array.isArray(pair.trail) ? pair.trail : [];
  for (const t of trail) {
    if (!t || !t.reason) continue;
    out.push({ level: t.level, verdict: t.verdict, reason: String(t.reason).slice(0, 600) });
    for (const e of (t.evidence || []).slice(0, 3)) {
      if (e && e.quote) out.push({ level: t.level + ":evidence", path: e.path, quote: String(e.quote).slice(0, 300) });
    }
  }
  return out.slice(0, 12);
}

export function buildCard(pair, byName) {
  const a = byName.get(pair.a);
  const b = byName.get(pair.b);
  const notes = [];
  if (!a) notes.push("语料中找不到技能 a: " + pair.a);
  if (!b) notes.push("语料中找不到技能 b: " + pair.b);
  const sk = (s) => ({
    name: s.name, path: s.path, description: String(s.description || ""),
    chars: String(s.body_core || s.body || "").length,
    support_files: supportFilesOf(s.path),
    units: segmentUnits(s === a ? "A" : "B", s)
  });
  const card = {
    schemaVersion: MERGE_SCHEMA_VERSION,
    pair: {
      a: pair.a, b: pair.b, level: pair.level || null, verdict_id: pair.verdict_id, action: pair.action || null,
      reason: pair.reason || "", scores: { jaccard_summary: pair.jaccard_summary, jaccard_body: pair.jaccard_body, summary_cosine: pair.summary_cosine, body_core_cosine: pair.body_core_cosine, score: pair.score }
    },
    skills: { a: a ? sk(a) : null, b: b ? sk(b) : null },
    evidence: evidenceOf(pair),
    compat: {
      both_found: !!(a && b),
      a_support_files: a ? supportFilesOf(a.path).length : 0,
      b_support_files: b ? supportFilesOf(b.path).length : 0,
      suggested_mode: a && b && !supportFilesOf(a.path).length && !supportFilesOf(b.path).length ? "append" : "reference"
    },
    notes
  };
  return card;
}

export function cardDigest(card, unitTextChars) {
  const cap = unitTextChars || 220;
  const skillDigest = (s) => ({
    name: s.name, description: s.description.slice(0, 300), chars: s.chars,
    support_files: s.support_files.slice(0, 20),
    units: s.units.map(u => ({ uid: u.uid, kind: u.kind, heading: u.heading, chars: u.chars, text: u.text.slice(0, cap) }))
  });
  return {
    pair: card.pair,
    a: skillDigest(card.skills.a), b: skillDigest(card.skills.b),
    evidence: card.evidence,
    compat: card.compat
  };
}