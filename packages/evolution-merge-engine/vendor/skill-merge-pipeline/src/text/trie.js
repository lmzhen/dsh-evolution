"use strict";
// CSR trie（Unigram Viterbi）：两遍构建（LCP 精确节点数 → typed arrays）；F64 分数保平局语义。

function buildTrie(scores, ids) {
  const pieces = [...ids.keys()].sort();
  let nodes = 1;
  let prev = "";
  for (const p of pieces) {
    let lcp = 0;
    const m = Math.min(prev.length, p.length);
    while (lcp < m && prev.charCodeAt(lcp) === p.charCodeAt(lcp)) lcp += 1;
    nodes += p.length - lcp;
    prev = p;
  }
  const ch = new Int32Array(nodes);
  const first = new Int32Array(nodes).fill(-1);
  const next = new Int32Array(nodes).fill(-1);
  const last = new Int32Array(nodes).fill(-1);
  const pid = new Int32Array(nodes).fill(-1);
  const score = new Float64Array(nodes);
  let n = 1;
  let path = [];
  prev = "";
  for (const piece of pieces) {
    let lcp = 0;
    const m = Math.min(prev.length, piece.length);
    while (lcp < m && prev.charCodeAt(lcp) === piece.charCodeAt(lcp)) lcp += 1;
    path.length = lcp;
    let parent = lcp > 0 ? path[lcp - 1] : 0;
    for (let d = lcp; d < piece.length; d += 1) {
      const node = n; n += 1;
      ch[node] = piece.charCodeAt(d);
      if (first[parent] === -1) first[parent] = node; else next[last[parent]] = node;
      last[parent] = node;
      path.push(node);
      parent = node;
    }
    pid[parent] = ids.get(piece);
    score[parent] = scores.get(piece);
    prev = piece;
  }
  const rootMap = new Map();
  for (let c = first[0]; c !== -1; c = next[c]) rootMap.set(ch[c], c);
  return { ch, first, next, pid, score, rootMap, nodes: n, pieces: pieces.length };
}

function tokenizeWithTrie(trie, tok, text) {
  const s = tok.applyPreTokenizer(tok.applyNormalizer(String(text)));
  const n = s.length;
  const best = new Float64Array(n + 1).fill(Infinity);
  const back = new Int32Array(n + 1).fill(-1);
  const backId = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < n; i += 1) {
    if (best[i] === Infinity) continue;
    let node = trie.rootMap.get(s.charCodeAt(i));
    let len = 1;
    while (node !== undefined) {
      const id = trie.pid[node];
      if (id !== -1) {
        const cand = best[i] - trie.score[node];
        if (cand < best[i + len] - 1e-12) { best[i + len] = cand; back[i + len] = i; backId[i + len] = id; }
      }
      if (i + len >= n) break;
      const code = s.charCodeAt(i + len);
      let c = trie.first[node];
      while (c !== -1 && trie.ch[c] !== code) c = trie.next[c];
      if (c === -1) break;
      node = c;
      len += 1;
    }
    const candU = best[i] - tok.unkScore;
    if (candU < best[i + 1] - 1e-12) { best[i + 1] = candU; back[i + 1] = i; backId[i + 1] = tok.unkId; }
  }
  const ids = [];
  let pos = n;
  while (pos > 0) {
    const p = back[pos];
    if (p < 0) break;
    ids.push(backId[pos]);
    pos = p;
  }
  ids.reverse();
  return ids;
}

export { buildTrie, tokenizeWithTrie };