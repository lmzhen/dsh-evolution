"use strict";
import { performance } from "node:perf_hooks";
import { makeConfig } from "../../src/config.js";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import * as candidates from "../../src/screening/candidates.js";
import { minhashSignature } from "../../src/minhash/signature.js";
import { tokenSet, shingles } from "../../src/textutil.js";
const CORPUS = process.env.SKILL_MERGE_CORPUS || "C:/Users/limengzhen/.dsh/skills";
const [skills] = corpus.loadCorpus([CORPUS]);
{ const cfg = makeConfig(); corpus.stripBoilerplate(skills, cfg); }
const [kept] = prefilter.prefilter(skills, makeConfig());
function ms(label, fn) { const t = performance.now(); const out = fn(); console.log(label + " = " + Math.round(performance.now() - t) + "ms"); return out; }
const sigs = ms("签名 90 技能×2 投影（各 1 次）", () => {
  const out = [];
  for (const s of kept) for (const proj of ["summary", "body"]) { const text = proj === "summary" ? s.summary : (s.body_core || s.body); out.push(minhashSignature(tokenSet(text))); }
  return out;
});
console.log("  签名样例[0]=" + JSON.stringify(sigs[0].slice(0, 4)));
ms("② generateCandidates rounds=1", () => candidates.generateCandidates(kept, makeConfig({ seed_mode: "fixed", round_count: 1 })));
ms("② generateCandidates rounds=10", () => candidates.generateCandidates(kept, makeConfig({ seed_mode: "fixed", round_count: 10 })));