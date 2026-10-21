"use strict";
// G4.4：screening 选中 pair 的最小统一字段。
import { InvalidDataError } from "../errors.js";

const VIAS = Object.freeze(["summary", "body", "both"]);

function viaFromNets(nets) {
  const set = new Set(Array.isArray(nets) ? nets : []);
  if (set.has("summary") && set.has("body")) return "both";
  if (set.has("summary")) return "summary";
  if (set.has("body")) return "body";
  return "both";
}

function assertSelectedPair(row, at) {
  const where = "screening:" + (at || "pair");
  if (!row || typeof row !== "object") throw new InvalidDataError("筛选 pair 不是对象: " + where, { where: "screening" });
  for (const k of ["a", "b", "a_path", "b_path"]) {
    if (typeof row[k] !== "string" || row[k] === "") throw new InvalidDataError("筛选 pair 缺少 " + k + ": " + where, { where: "screening" });
  }
  if (!VIAS.includes(row.via)) throw new InvalidDataError("筛选 pair via 非法: " + String(row.via) + " (" + where + ")", { where: "screening" });
  if (!Array.isArray(row.arm) || row.arm.some(x => typeof x !== "string" || x === "")) throw new InvalidDataError("筛选 pair arm 必须是字符串数组: " + where, { where: "screening" });
  if (typeof row.score !== "number" || !Number.isFinite(row.score)) throw new InvalidDataError("筛选 pair score 必须是有限数值: " + where, { where: "screening" });
  return row;
}

function assertSelectedPairs(rows, at) {
  for (const row of rows || []) assertSelectedPair(row, at);
  return rows;
}

export { VIAS, viaFromNets, assertSelectedPair, assertSelectedPairs };