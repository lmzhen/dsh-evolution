"use strict";
import path from "node:path";
import crypto from "node:crypto";
import { readText, listDir, realPath } from "./io/read.js";
const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
class Skill {
  constructor(p, name, description, body) {
    this.path = p; this.name = name; this.description = description; this.body = body; this.body_core = "";
  }
  get summary() { return (this.name + " " + this.description).trim(); }
}
function frontmatter(text) {
  const m = FM_RE.exec(text);
  if (!m) return [{}, text];
  const fm = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    const mm = /^(name|description|tags)\s*:\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.length >= 2 && (v[0] === "\"" || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    fm[mm[1]] = v;
  }
  return [fm, text.slice(m[0].length)];
}
function loadCorpus(roots) {
  const skip = new Set(["node_modules", "__pycache__"]);
  const skills = [];
  const seen = new Set();
  let skippedDirs = 0, nestedPruned = 0;
  for (const root of roots) { walk(path.resolve(root)); }
  function walk(dir) {
    let entries;
    try { entries = listDir(dir); } catch (e) { return; }
    const dirs = entries.filter(e => e.isDirectory).map(e => e.name);
    const files = entries.filter(e => e.isFile).map(e => e.name);
    const keep = [];
    for (const d of dirs) {
      if (skip.has(d) || d.startsWith(".")) skippedDirs += 1;
      else keep.push(d);
    }
    if (files.includes("SKILL.md")) {
      if (keep.length) nestedPruned += keep.length;
      let p;
      try { p = realPath(path.join(dir, "SKILL.md")); } catch (e) { return; }
      if (seen.has(p)) return;
      seen.add(p);
      let text;
      try { text = readText(p); } catch (e) { return; }
      const [fm, body] = frontmatter(text);
      const name = fm.name || path.basename(dir);
      skills.push(new Skill(p, name, fm.description || "", body));
      return;
    }
    for (const d of keep) walk(path.join(dir, d));
  }
  skills.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return [skills, { skipped_archive_dirs: skippedDirs, pruned_nested_dirs: nestedPruned }];
}
function corpusStats(skills, skippedDirs) {
  const names = {};
  for (const s of skills) names[s.name] = (names[s.name] || 0) + 1;
  const dup = {};
  for (const [n, c] of Object.entries(names)) if (c > 1) dup[n] = c;
  return { skills: skills.length, skipped_archive_dirs: skippedDirs, duplicate_names: dup };
}
function paragraphs(body) {
  return String(body).split(/\n\s*\n/).map(x => x.trim()).filter(x => x);
}
function round3(x) { return Math.round(x * 1000) / 1000; }
function stripBoilerplate(skills, cfg) {
  const counts = {};
  const rows = [];
  for (const s of skills) {
    const seen = new Set();
    for (const para of paragraphs(s.body)) {
      const key = crypto.createHash("sha256").update(para.replace(/\s+/g, " ").toLowerCase()).digest("hex").slice(0, 16);
      rows.push([s, para, key]);
      if (!seen.has(key)) { seen.add(key); counts[key] = (counts[key] || 0) + 1; }
    }
  }
  const floor = Math.max(cfg.boilerplate_min_docs, Math.floor(skills.length * cfg.boilerplate_min_ratio));
  const common = new Set(Object.entries(counts).filter(([k, c]) => c >= floor).map(([k]) => k));
  const kept = {};
  let total = 0, dropped = 0;
  for (const [s, para, key] of rows) {
    total += 1;
    if (common.has(key)) { dropped += 1; continue; }
    (kept[s.path] = kept[s.path] || []).push(para);
  }
  for (const s of skills) s.body_core = (kept[s.path] || []).join("\n\n");
  return { paragraphs: total, boilerplate_paragraphs: dropped, floor: floor, kinds: common.size };
}
export { Skill, frontmatter, loadCorpus, corpusStats, stripBoilerplate, paragraphs, round3 };