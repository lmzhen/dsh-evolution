"use strict";
// C13：LSH 参数（完整 0.005 网格 + 非格点显式 snap 警告）。
import path from "node:path";
import { readJson } from "../io/read.js";
import { InvalidDataError } from "../errors.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PARAMS = readJson(path.join(__dirname, "..", "data", "minhash_params.json"));
const GRID_STEP = 0.005;
const GRID = Object.keys(PARAMS.params)
  .map(k => ({ t: Number(k), b: PARAMS.params[k][0], r: PARAMS.params[k][1] }))
  .sort((x, y) => x.t - y.t);

function lshParamsEx(threshold) {
  const t = Number(threshold);
  if (!Number.isFinite(t)) throw new InvalidDataError("LSH threshold 必须是数值，收到: " + threshold, { where: "lsh" });
  let best = null;
  let bestD = Infinity;
  for (const g of GRID) {
    const d = Math.abs(g.t - t);
    if (d < bestD) { bestD = d; best = g; }
  }
  const snapped = bestD > 1e-9;
  return { b: best.b, r: best.r, snapped, snappedTo: best.t, requested: t };
}

function lshParams(threshold, onSnap) {
  const p = lshParamsEx(threshold);
  if (p.snapped && typeof onSnap === "function") onSnap({ requested: p.requested, snappedTo: p.snappedTo, b: p.b, r: p.r });
  return [p.b, p.r];
}

export { lshParams, lshParamsEx, GRID_STEP, PARAMS };