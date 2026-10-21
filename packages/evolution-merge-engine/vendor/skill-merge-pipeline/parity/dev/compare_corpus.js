import fs from "node:fs";
import * as corpus from "../src/corpus.js";
import { makeConfig } from "../src/config.js";
import { fileURLToPath } from "node:url";
import { dirname as _pathDirname } from "node:path";
const __dirname = _pathDirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(fs.readFileSync(__dirname + "/ref_corpus_full.json", "utf8"));
const cfg = makeConfig();
globalThis.__PHASE = false;
const [skills] = corpus.loadCorpus(["C:/Users/limengzhen/.dsh/skills"]);
corpus.stripBoilerplate(skills, cfg);
let diff = { name: 0, description: 0, summary: 0, body: 0, body_core: 0, missing: 0 };
let samples = [];
for (const s of skills) {
  const r = REF[s.path];
  if (!r) { diff.missing += 1; continue; }
  for (const k of ["name", "description", "summary", "body", "body_core"]) {
    if (s[k] !== r[k]) { diff[k] += 1; if (samples.length < 3) samples.push({ path: s.path, field: k, nodeLen: s[k].length, pyLen: r[k].length, byteEq: Buffer.compare(Buffer.from(s[k]), Buffer.from(r[k])) === 0 }); }
  }
}
console.log("=== B) 语料字段逐字对比 ===");
console.log("  差异统计: " + JSON.stringify(diff));
for (const x of samples) console.log("  例: " + JSON.stringify(x));