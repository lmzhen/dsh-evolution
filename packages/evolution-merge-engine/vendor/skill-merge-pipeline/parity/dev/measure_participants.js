"use strict";
// 只嵌 participants 的 token 成本对比（fixture 语料口径）。
import path from "node:path";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import * as candidates from "../../src/screening/candidates.js";
import * as lexical from "../../src/screening/lexical.js";
import { makeConfig } from "../../src/config.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = path.join(__dirname, "..", "fixtures", "corpus");
const cfg = makeConfig();
const [skills] = corpus.loadCorpus([CFG]);
corpus.stripBoilerplate(skills, cfg);
const [kept] = prefilter.prefilter(skills, cfg);
const fixed = makeConfig({ seed_mode: "fixed", round_count: 1 });
const [pairs] = candidates.generateCandidates(kept, fixed);
const [passed] = lexical.lexicalGate(kept, pairs, fixed);
const participants = new Set();
for (const r of passed) { participants.add(r.a_path); participants.add(r.b_path); }
const byPath = new Map(kept.map(s => [s.path, s]));
const projText = (s, p) => p === "summary" ? s.summary : (s.body_core || s.body);
let allChars = 0, partChars = 0;
for (const s of kept) for (const p of ["body_core", "summary"]) allChars += projText(s, p).length;
for (const p of participants) { const s = byPath.get(p); for (const proj of ["body_core", "summary"]) partChars += projText(s, proj).length; }
console.log("技能: " + kept.length + " | participants: " + participants.size + " (" + (participants.size / kept.length * 100).toFixed(1) + "%)");
console.log("两投影字符: 全量=" + allChars + " 参与者=" + partChars + " | 节省=" + (100 - partChars / allChars * 100).toFixed(1) + "%");