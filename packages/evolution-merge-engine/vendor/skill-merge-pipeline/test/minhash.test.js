"use strict";
import test from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import * as corpus from "../src/corpus.js";
import * as prefilter from "../src/screening/prefilter.js";
import { makeConfig } from "../src/config.js";
import { tokenSet } from "../src/textutil.js";
import { minhashSignature, fmix32, featureCacheSize } from "../src/minhash/signature.js";
import { lshParams, lshParamsEx, GRID_STEP, PARAMS } from "../src/minhash/lsh.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CORPUS = process.env.SKILL_MERGE_CORPUS || path.join(__dirname, "..", "parity", "fixtures", "corpus");
const cfg = makeConfig();
const [skills] = corpus.loadCorpus([CORPUS]);
corpus.stripBoilerplate(skills, cfg);
const [kept] = prefilter.prefilter(skills, cfg);
const byName = new Map(kept.map(s => [s.name, s]));

function bigIntSignature(features, numPerm) {
  const A = PARAMS.a.map(BigInt); const B = PARAMS.b.map(BigInt); const MASK = 0xFFFFFFFFn;
  const n = numPerm || PARAMS.num_perm;
  const sig = new Array(n).fill(0xFFFFFFFFn);
  for (const feat of features) {
    const hv = BigInt(fmix32(crypto.createHash("sha1").update(Buffer.from(String(feat), "utf8")).digest().readUInt32LE(0)));
    for (let k = 0; k < n; k += 1) { const phv = (A[k] * hv + B[k]) & MASK; if (phv < sig[k]) sig[k] = phv; }
  }
  return sig.map(Number);
}

test("签名与 Python golden 逐位一致（ref_minhash 3 技能）", () => {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "parity", "golden", "ref_minhash.json"), "utf8"));
  for (const r of ref) {
    const s = byName.get(r.name);
    assert.ok(s, "语料缺少技能: " + r.name);
    const sig = minhashSignature(tokenSet(s.summary));
    assert.deepEqual(Array.from(sig), r.values, r.name + " 签名不一致");
  }
});

test("imul 与 BigInt 参考公式逐位一致", () => {
  const feats = [...tokenSet(kept[0].summary)].slice(0, 8);
  const fast = Array.from(minhashSignature(feats));
  const ref = bigIntSignature(feats);
  assert.deepEqual(fast, ref);
});

test("特征哈希缓存：重复签名一致且缓存生效", () => {
  const feats = [...tokenSet(kept[1].summary)];
  const a = minhashSignature(feats);
  const before = featureCacheSize();
  const b = minhashSignature(feats);
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.ok(featureCacheSize() >= before);
});

test("LSH 完整网格：格点命中无警告、数值与 Python 导出一致", () => {
  const keys = Object.keys(PARAMS.params);
  assert.ok(keys.length >= 199, "网格不完整: " + keys.length);
  for (const k of ["0.005", "0.05", "0.1", "0.2", "0.5", "0.995"]) {
    let warned = 0;
    const [b, r] = lshParams(Number(k), () => { warned += 1; });
    assert.deepEqual([b, r], PARAMS.params[k]);
    assert.equal(warned, 0, k + " 不应 snap");
  }
  assert.equal(GRID_STEP, 0.005);
});

test("非格点阈值：显式 snap 警告且取最近格点", () => {
  const warnings = [];
  const [b, r] = lshParams(0.0937, w => warnings.push(w));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].snappedTo, 0.095);
  assert.deepEqual([b, r], PARAMS.params["0.095"]);
  const ex = lshParamsEx(1.2);
  assert.equal(ex.snapped, true);
  assert.equal(ex.snappedTo, 0.995);
});

test("非法阈值 → INVALID", () => {
  try { lshParams("abc"); assert.fail("应抛错"); } catch (e) { assert.equal(toDiagnostic(e).code, DiagnosticCode.INVALID); }
});