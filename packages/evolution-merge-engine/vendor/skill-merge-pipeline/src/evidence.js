"use strict";
// C5 契约：Evidence 唯一构造器 —— 四键齐全，缺失一律 null（禁止 undefined 丢键）。
import { InvalidDataError } from "./errors.js";

const EVIDENCE_KEYS = Object.freeze(["jaccard_summary", "jaccard_body", "body_cosine", "summary_cosine"]);

function numOrNull(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildEvidence(row) {
  const r = row || {};
  return {
    jaccard_summary: numOrNull(r.jaccard_summary),
    jaccard_body: numOrNull(r.jaccard_body),
    body_cosine: numOrNull(r.body_cosine !== undefined && r.body_cosine !== null ? r.body_cosine : r.body_core_cosine),
    summary_cosine: numOrNull(r.summary_cosine)
  };
}

function validateEvidence(ev) {
  if (!ev || typeof ev !== "object") throw new InvalidDataError("evidence 必须是对象", { where: "evidence" });
  const keys = Object.keys(ev).sort();
  const want = EVIDENCE_KEYS.slice().sort();
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) {
    throw new InvalidDataError("evidence 键集不符: " + JSON.stringify(keys) + "（期望 " + JSON.stringify(want) + "）", { where: "evidence" });
  }
  for (const k of EVIDENCE_KEYS) {
    const v = ev[k];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) {
      throw new InvalidDataError("evidence." + k + " 必须是有限数或 null", { where: "evidence" });
    }
  }
  return ev;
}

// canonical JSON（键序固定）仅用于 sha/缓存键；prompt 正文仍按 Python 插入序序列化（C5）。
function canonicalEvidence(ev) {
  const v = validateEvidence(ev);
  const out = {};
  for (const k of EVIDENCE_KEYS) out[k] = v[k];
  return JSON.stringify(out);
}

export { EVIDENCE_KEYS, buildEvidence, validateEvidence, canonicalEvidence };