"use strict";
import { exists, readJson } from "./io/read.js";
import { writeJson } from "./io/write.js";
function pairKey(a, b) { return [a, b].sort().join("|"); }
function load(p) {
  if (!p || !exists(p)) return {};
  try { return readJson(p); } catch (e) { return {}; }
}
function save(p, data) {
  if (!p) return;
  writeJson(p, data, { indent: 2 });
}
function mark(p, pairs, extra) {
  const data = load(p);
  const now = Math.trunc(Date.now() / 1000);
  for (const [a, b] of pairs) {
    const k = pairKey(a, b);
    const rec = data[k] || (data[k] = { seen_at: now, rounds: 0, meta: {} });
    rec.rounds = Number(rec.rounds || 0) + 1;
    rec.seen_at = now;
    if (extra) rec.meta = extra;
  }
  save(p, data);
  return Object.keys(data).length;
}
export { pairKey, load, save, mark };