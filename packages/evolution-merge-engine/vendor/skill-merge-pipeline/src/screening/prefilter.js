"use strict";
import { round3 } from "../corpus.js";
function nameEntropy(name) {
  const s = String(name).toLowerCase().replace(/\s+/g, "");
  if (!s) return 0.0;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  const n = s.length;
  let h = 0;
  for (const c of Object.values(freq)) { const p = c / n; h -= p * Math.log2(p); }
  return h;
}
function prefilter(skills, cfg) {
  const kept = [], dropped = [];
  for (const s of skills) {
    const raw = String(s.name).trim();
    const toks = raw.split(/[-_\s]+/).filter(x => x);
    const ent = nameEntropy(s.name);
    let reason = null;
    if (raw.length < cfg.min_name_len && toks.length < cfg.min_name_tokens) reason = "name 过短且 token 数不足";
    else if (ent < cfg.min_name_entropy) reason = "name 熵过低（疑似占位/流水号）";
    if (reason) dropped.push({ name: s.name, path: s.path, entropy: round3(ent), tokens: toks.length, reason: reason });
    else kept.push(s);
  }
  const ents = skills.map(s => nameEntropy(s.name)).sort((a, b) => a - b);
  const stats = {
    input: skills.length, kept: kept.length, dropped: dropped.length,
    entropy_min: ents.length ? round3(ents[0]) : 0.0,
    entropy_median: ents.length ? round3(ents[Math.floor(ents.length / 2)]) : 0.0
  };
  return [kept, dropped, stats];
}
export { nameEntropy, prefilter };