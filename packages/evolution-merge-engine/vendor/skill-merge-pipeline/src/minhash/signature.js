"use strict";
// C13：affine32 MinHash 签名（imul 置换 + 特征哈希缓存，与 Python 逐位一致）。
import path from "node:path";
import { readJson } from "../io/read.js";
import crypto from "node:crypto";
import { InvalidDataError } from "../errors.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PARAMS = readJson(path.join(__dirname, "..", "data", "minhash_params.json"));
const NUM_PERM = PARAMS.num_perm;
const A = Uint32Array.from(PARAMS.a);
const B = Uint32Array.from(PARAMS.b);
const FEATURE_CACHE_LIMIT = 500000;
const featureCache = new Map();

function sha1Hash32(buf) { return crypto.createHash("sha1").update(buf).digest().readUInt32LE(0); }

function fmix32(hv) {
  hv = (hv ^ (hv >>> 16)) >>> 0;
  hv = Math.imul(hv, 0x85EBCA6B) >>> 0;
  hv = (hv ^ (hv >>> 13)) >>> 0;
  hv = Math.imul(hv, 0xC2B2AE35) >>> 0;
  hv = (hv ^ (hv >>> 16)) >>> 0;
  return hv;
}

function featureHash(feature) {
  const key = typeof feature === "string" ? feature : String(feature);
  const cached = featureCache.get(key);
  if (cached !== undefined) return cached;
  const hv = fmix32(sha1Hash32(Buffer.from(key, "utf8")));
  if (featureCache.size >= FEATURE_CACHE_LIMIT) featureCache.clear();
  featureCache.set(key, hv);
  return hv;
}

function minhashSignature(features, numPerm) {
  const n = numPerm === undefined ? NUM_PERM : Number(numPerm);
  if (!Number.isInteger(n) || n < 1 || n > NUM_PERM) throw new InvalidDataError("numPerm 必须在 1.." + NUM_PERM, { where: "minhash" });
  const sig = new Uint32Array(n).fill(0xFFFFFFFF);
  for (const f of features) {
    const hv = featureHash(f);
    for (let k = 0; k < n; k += 1) {
      const phv = (Math.imul(A[k], hv) + B[k]) >>> 0;
      if (phv < sig[k]) sig[k] = phv;
    }
  }
  return sig;
}

function featureCacheSize() { return featureCache.size; }
function clearFeatureCache() { featureCache.clear(); }

export { minhashSignature, sha1Hash32, fmix32, featureHash, featureCacheSize, clearFeatureCache, PARAMS, NUM_PERM };