"use strict";
// ④ 静态表：bulk vs stream 两种加载模式的载入/编码/RSS 对照。
import { performance } from "node:perf_hooks";
import * as corpus from "../../src/corpus.js";
import * as prefilter from "../../src/screening/prefilter.js";
import { makeConfig } from "../../src/config.js";
import { StaticTable } from "../../src/embed/static_table.js";
const CORPUS = process.env.SKILL_MERGE_CORPUS || "C:/Users/limengzhen/.dsh/skills";
const MODEL = process.env.SKILL_MERGE_EMBED_MODEL || "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const cfg = makeConfig();
const [skills] = corpus.loadCorpus([CORPUS]);
corpus.stripBoilerplate(skills, cfg);
const [kept] = prefilter.prefilter(skills, cfg);
const texts = [];
for (const s of kept) { texts.push(s.body_core || s.body); texts.push(s.summary); }
function ms(fn) { const t = performance.now(); const out = fn(); return { out, ms: performance.now() - t }; }
async function msAsync(fn) { const t = performance.now(); const out = await fn(); return { out, ms: performance.now() - t }; }
(async () => {
  const rss0 = process.memoryUsage().rss;
  const bulkLoad = ms(() => new StaticTable(MODEL, { streamMode: "bulk" }));
  const bulkEnc = await msAsync(() => bulkLoad.out.fitTransform(texts));
  const streamLoad = ms(() => new StaticTable(MODEL, { streamMode: "stream" }));
  const streamEnc = await msAsync(() => streamLoad.out.fitTransform(texts));
  const rss1 = process.memoryUsage().rss;
  let maxDiff = 0;
  for (let i = 0; i < texts.length; i += 1) for (let j = 0; j < bulkLoad.out.cols; j += 1) { const d = Math.abs(bulkEnc.out[i][j] - streamEnc.out[i][j]); if (d > maxDiff) maxDiff = d; }
  console.log("bulk  : 载入=" + Math.round(bulkLoad.ms) + "ms 编码=" + Math.round(bulkEnc.ms) + "ms 合计=" + Math.round(bulkLoad.ms + bulkEnc.ms) + "ms mode=" + bulkLoad.out.mode);
  console.log("stream: 载入=" + Math.round(streamLoad.ms) + "ms 编码=" + Math.round(streamEnc.ms) + "ms 合计=" + Math.round(streamLoad.ms + streamEnc.ms) + "ms mode=" + streamLoad.out.mode);
  console.log("max向量差=" + maxDiff.toExponential(2) + " | RSS 增量 ≈ " + Math.round((rss1 - rss0) / 1048576) + "MB（当前 " + Math.round(rss1 / 1048576) + "MB）");
  bulkLoad.out.close();
  streamLoad.out.close();
})();