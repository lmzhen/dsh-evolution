"use strict";
// G4.1：screening 纯逻辑入口（① 预过滤 / ② 候选 / ③ 词面门限 / ④ 向量相似度）。
// 输入 Skill[]/Pair[]，输出纯数据；不直接写文件；stage 只调用本入口。
export { nameEntropy, prefilter } from "./prefilter.js";
export { projectionText, pairScore, generateCandidates, roundParams, runSeedOf, lshParams } from "./candidates.js";
export { lexicalGate } from "./lexical.js";
export { makeEmbedder, semanticSelect, StreamedStaticEmbedder, TfidfEmbedder, dot, projectionOf } from "./semantic.js";