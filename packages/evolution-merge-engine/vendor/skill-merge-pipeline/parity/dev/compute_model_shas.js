"use strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const ROOT = "D:/dsh/skill-merge/models";
function sha(p) { const buf = fs.readFileSync(p); return { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length }; }
const dirs = { fp16: "potion-multilingual-fp16", int8: "potion-multilingual-128M-int8", pca64: "potion-multilingual-128M-pca64-int8" };
const out = {};
for (const [k, d] of Object.entries(dirs)) {
  out[k] = {};
  for (const f of fs.readdirSync(path.join(ROOT, d)).sort()) {
    const p = path.join(ROOT, d, f);
    if (!fs.statSync(p).isFile()) continue;
    if (f.endsWith(".safetensors") || f.endsWith(".f32") || f === "tokenizer.json" || f === "config.json") out[k][f] = sha(p);
  }
}
console.log(JSON.stringify(out, null, 1));