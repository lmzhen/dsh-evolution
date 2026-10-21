"use strict";
// 分词与 shingle：CJK 感知（与 Python textutil.py 等价）
const CJK_RE = /^[\u4e00-\u9fff]+$/;
const TOKEN_RE = /[A-Za-z0-9_]+|[\u4e00-\u9fff]+/g;
function tokens(text) {
  const out = [];
  const s0 = String(text).toLowerCase();
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s0)) !== null) {
    const s = m[0];
    if (CJK_RE.test(s)) {
      if (s.length === 1) out.push(s);
      else for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
    } else out.push(s);
  }
  return out;
}
function tokenSet(text) { return new Set(tokens(text)); }
function shingles(text, k) {
  const toks = tokens(text);
  const out = new Set();
  if (!toks.length) return out;
  if (toks.length < k) { out.add(toks.join(" ")); return out; }
  for (let i = 0; i <= toks.length - k; i += 1) out.add(toks.slice(i, i + k).join(" "));
  return out;
}
function jaccardSets(a, b) {
  if (!a || !b || !a.size || !b.size) return 0.0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
export { tokens, tokenSet, shingles, jaccardSets };