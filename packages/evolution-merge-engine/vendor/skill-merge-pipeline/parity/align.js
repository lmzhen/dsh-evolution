"use strict";
// 候选顺序对齐（从 run.js 生产分支移出，仅供 parity cases 使用）。
// test-only patch: canonicalize corpus paths so clean checkouts align with
// ref_stages.json generated on the author's absolute root.
const MARKER = "/parity/fixtures/corpus/";
function canon(p) {
  const s = String(p).replace(/\\/g, "/");
  const i = s.toLowerCase().lastIndexOf(MARKER);
  if (i >= 0) return s.slice(i + MARKER.length);
  const parts = s.split("/");
  return parts.slice(-2).join("/");
}
function pairKeyFromRef(r) { return [canon(r.a_path), canon(r.b_path)].sort().join("|"); }
function pairKeyFromMapKey(k) { return k.split("\u0000").map(canon).sort().join("|"); }
function alignCandidates(pairs, refCandidates) {
  const order = new Map(refCandidates.map((r, i) => [pairKeyFromRef(r), i]));
  const matched = [...pairs.keys()].filter(k => order.has(pairKeyFromMapKey(k))).length;
  if (matched !== refCandidates.length) {
    throw new Error("alignCandidates: " + matched + "/" + refCandidates.length + " ref pairs matched (corpus root differs?)");
  }
  return new Map([...pairs.entries()].sort((x, y) => {
    const kx = pairKeyFromMapKey(x[0]);
    const ky = pairKeyFromMapKey(y[0]);
    const ox = order.has(kx) ? order.get(kx) : 1e9;
    const oy = order.has(ky) ? order.get(ky) : 1e9;
    return ox - oy;
  }));
}
export { alignCandidates, pairKeyFromRef, pairKeyFromMapKey };
