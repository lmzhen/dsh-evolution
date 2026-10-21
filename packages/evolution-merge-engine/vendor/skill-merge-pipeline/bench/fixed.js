// G8.2：固定口径基准（45 技能 / 90 文本；④ 静态表载入+编码；int8-256 档）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as corpus from "../src/corpus.js";
import * as prefilter from "../src/screening/prefilter.js";
import { makeConfig } from "../src/config.js";
import { StaticTable } from "../src/embed/static_table.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXED = Object.freeze({ skills: 45, texts: 90, corpus: path.join(__dirname, "..", "parity", "fixtures", "corpus") });
export const MODEL = process.env.SKILL_MERGE_INT8 || "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";

export function buildTexts() {
  const cfg = makeConfig();
  const [all] = corpus.loadCorpus([FIXED.corpus]);
  corpus.stripBoilerplate(all, cfg);
  const [kept] = prefilter.prefilter(all, cfg);
  const skills = kept.slice(0, FIXED.skills);
  const texts = [];
  for (const s of skills) { texts.push(s.body_core || s.body); texts.push(s.summary); }
  return { skills: skills.length, texts: texts };
}

export async function measure() {
  const built = buildTexts();
  let loadMs = 0;
  let encodeMs = 0;
  let table = null;
  try {
    let t = performance.now();
    table = new StaticTable(MODEL, { streamMode: "bulk" });
    loadMs = performance.now() - t;
    t = performance.now();
    await table.fitTransform(built.texts);
    encodeMs = performance.now() - t;
  } finally { if (table) table.close(); }
  return {
    skills: built.skills,
    texts: built.texts.length,
    load_ms: Math.round(loadMs * 10) / 10,
    encode_ms: Math.round(encodeMs * 10) / 10,
    total_ms: Math.round((loadMs + encodeMs) * 10) / 10,
    rss_mb: Math.round(process.memoryUsage().rss / 1048576),
    model: MODEL
  };
}