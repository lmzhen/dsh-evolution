"use strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { buildArtifact } from "../../src/models/build.js";
import { loadRegistry, verifyArtifact, artifactById } from "../../src/models/registry.js";
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = p => sha(fs.readFileSync(p));
const SRC = "D:/dsh/skill-merge/models";
const { file, registry } = loadRegistry();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-real-build-"));
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
for (const n of ["model.safetensors", "tokenizer.json", "config.json"]) copy(path.join(SRC, "potion-multilingual-fp16", n), path.join(tmp, "potion-multilingual-fp16", n));
copy(path.join(SRC, "potion-multilingual-128M-pca64-int8", "pca_proj.f32"), path.join(tmp, "pca64", "proj.f32"));
const eq = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));
(async () => {
  console.log("base-f16 verify: " + verifyArtifact(registry, file, "potion-base-f16", { rootDir: tmp, hash: true }).ok);
  const t0 = Date.now();
  const r = await buildArtifact({ registry, registryFile: file, id: "local:int8-256", rootDir: tmp, force: true });
  const outInt8 = path.join(tmp, "potion-multilingual-128M-int8");
  const expInt8 = path.join(SRC, "potion-multilingual-128M-int8");
  console.log("int8 build=" + r.built + " ms=" + (Date.now() - t0));
  for (const n of ["model.safetensors", "scales.f32", "config.json", "tokenizer.json"]) {
    const a = path.join(outInt8, n), b = path.join(expInt8, n);
    const same = fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
    let extra = "";
    if (!same && fs.existsSync(a) && fs.existsSync(b)) { const x = fs.readFileSync(a), y = fs.readFileSync(b); let d = 0; for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) d += 1; extra = " bytes_diff=" + d + " len=" + x.length + "/" + y.length; }
    console.log("  int8 " + n + " byte_equal=" + same + extra);
  }
  const h1 = fileSha(path.join(outInt8, "model.safetensors"));
  await buildArtifact({ registry, registryFile: file, id: "local:int8-256", rootDir: tmp, force: true });
  console.log("  int8 确定性二次构建 sha_equal=" + (h1 === fileSha(path.join(outInt8, "model.safetensors"))));
  const t1 = Date.now();
  let r2 = { built: null, err: null };
  try { r2 = await buildArtifact({ registry, registryFile: file, id: "local:pca64-int8", rootDir: tmp, force: true }); } catch (e) { r2 = { built: false, err: e.message }; console.log("pca verify note: " + e.message.slice(0, 120)); }
  const outPca = path.join(tmp, "potion-multilingual-128M-pca64-int8");
  const expPca = path.join(SRC, "potion-multilingual-128M-pca64-int8");
  console.log("pca build=" + r2.built + " ms=" + (Date.now() - t1));
  const aS = fs.readFileSync(path.join(outPca, "scales.f32")); const bS = fs.readFileSync(path.join(expPca, "scales.f32"));
  let maxRel = 0, exact = 0; for (let i = 0; i < aS.length / 4; i += 1) { const x = aS.readFloatLE(i * 4), y = bS.readFloatLE(i * 4); if (x === y) exact += 1; else maxRel = Math.max(maxRel, Math.abs(x - y) / Math.max(1e-12, Math.abs(y))); }
  console.log("  pca scales exact=" + exact + "/" + (aS.length / 4) + " max_rel_diff=" + maxRel.toExponential(2));
  const modelA = fs.readFileSync(path.join(outPca, "model.safetensors"));
  const modelB = fs.readFileSync(path.join(expPca, "model.safetensors"));
  const offA = (() => { const h = Number(modelA.readBigUInt64LE(0)); return 8 + h + (8 - ((8 + h) % 8)) % 8; })();
  const dims = 64; const rows = (modelA.length - offA) / dims;
  let dot = 0, na = 0, nb = 0, checked = 0, sameQ = 0;
  for (let r = 0; r < rows; r += 500) {
    const sa = aS.readFloatLE(r * 4), sb = bS.readFloatLE(r * 4);
    for (let d = 0; d < dims; d += 1) {
      const qa = modelA.readInt8(offA + r * dims + d) * sa;
      const qb = modelB.readInt8(offA + r * dims + d) * sb;
      dot += qa * qb; na += qa * qa; nb += qb * qb;
      if (modelA.readInt8(offA + r * dims + d) === modelB.readInt8(offA + r * dims + d)) sameQ += 1;
      checked += 1;
    }
  }
  console.log("  pca 采样行=" + Math.ceil(rows / 500) + " 余弦=" + (dot / Math.sqrt(na * nb)).toFixed(6) + " 量化值同号比例=" + (sameQ / checked).toFixed(6));
  const h2 = fileSha(path.join(outPca, "model.safetensors"));
  try { await buildArtifact({ registry, registryFile: file, id: "local:pca64-int8", rootDir: tmp, force: true }); } catch (e) { /* 已分析 */ }
  console.log("  pca 确定性二次构建 sha_equal=" + (h2 === fileSha(path.join(outPca, "model.safetensors"))));
  const cfgSame = fs.readFileSync(path.join(outPca, "config.json")).equals(fs.readFileSync(path.join(expPca, "config.json")));
  console.log("  pca config byte_equal=" + cfgSame);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.log("REAL_BUILD_FAIL " + String(e && e.message ? e.message : e).slice(0, 400)); process.exit(1); });