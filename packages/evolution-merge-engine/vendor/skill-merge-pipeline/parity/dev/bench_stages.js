"use strict";
// ① ② ③ 段基准：import 正式实现（无内联副本）。
import { performance } from "node:perf_hooks";
import { makeConfig } from "../../src/config.js";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import * as candidates from "../../src/screening/candidates.js";
import * as lexical from "../../src/screening/lexical.js";
const CORPUS = process.env.SKILL_MERGE_CORPUS || "C:/Users/limengzhen/.dsh/skills";
const cfg = makeConfig();
function ms(label, fn) { const t = performance.now(); const out = fn(); console.log(label + " = " + Math.round(performance.now() - t) + "ms"); return out; }
const tLoad = performance.now();
const [skills] = corpus.loadCorpus([CORPUS]);
console.log("语料: " + skills.length + " 技能 | 载入 = " + Math.round(performance.now() - tLoad) + "ms");
ms("公共前言剥离", () => corpus.stripBoilerplate(skills, cfg));
const kept = ms("① 预过滤", () => prefilter.prefilter(skills, cfg)[0]);
const cfgFixed = makeConfig({ seed_mode: "fixed", round_count: 1 });
const one = ms("② candidates rounds=1", () => candidates.generateCandidates(kept, cfgFixed));
const ten = ms("② candidates rounds=10", () => candidates.generateCandidates(kept, makeConfig({ seed_mode: "fixed", round_count: 10 })));
const pairs = one[0];
const passed = ms("③ lexical", () => lexical.lexicalGate(kept, pairs, makeConfig({ seed_mode: "fixed", round_count: 1 })));
console.log("漏斗: ② " + pairs.size + " → ③ " + passed[0].length);