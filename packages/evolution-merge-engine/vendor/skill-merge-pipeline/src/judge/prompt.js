"use strict";
// C17 / G5.2：⑤ prompt 契约（版本 + 正文按 Python 插入序 + canonical sha）。
import crypto from "node:crypto";
import * as extract from "../extract.js";

const PROMPT_VERSION = "judge-prompt-v1";
const SYSTEM = [
  "You judge whether two agent-skill documents describe the SAME reusable capability that should be merged.",
  "Sharing vocabulary or a common preamble is NOT duplication.",
  "Reply with STRICT JSON only.",
  "verdict=1 means they should be merged; verdict=-1 means they are clearly different; verdict=0 means the given material is not enough to decide."
].join("\n");
const L0_NOTE_PLAIN = "仅凭名称与描述判断；若不够判断请回 0，不要猜。";
const L0_NOTE_CAUTION = "仅凭名称与描述判断。谨慎决策：只有当两者明显属于不同能力域时才回 -1；只要存在同一种可复用能力的可能，就回 0 交给下一级（下一级能看到能力宣言）。";
const SCHEMA = { verdict: "1 | 0 | -1", reason: "<one sentence, in Chinese>", evidence: [{ path: "<file>", line: "<n or -1>", quote: "<short quote>" }] };
const EVIDENCE_ORDER = ["jaccard_summary", "jaccard_body", "body_cosine", "summary_cosine"];

function promptScores(evidence) {
  const ev = evidence || {};
  const out = {};
  for (const key of EVIDENCE_ORDER) {
    if (ev[key] === undefined || ev[key] === null) continue;
    out[key] = ev[key];
  }
  return out;
}

function buildPrompt(level, a, b, evidence, cfg) {
  let payload;
  if (level === "L0") {
    payload = {
      level: "L0",
      skill_a: { id: a.name, name: a.name, description: a.description },
      skill_b: { id: b.name, name: b.name, description: b.description },
      scores: promptScores(evidence),
      note: cfg.l0_caution ? L0_NOTE_CAUTION : L0_NOTE_PLAIN,
      schema: SCHEMA
    };
  } else if (level === "L1") {
    payload = {
      level: "L1",
      skill_a: { id: a.name, description: a.description, head: extract.headExtract(a) },
      skill_b: { id: b.name, description: b.description, head: extract.headExtract(b) },
      scores: promptScores(evidence),
      note: "这是两份技能的能力宣言段与触发条件；仍不足请回 0。",
      schema: SCHEMA
    };
  } else {
    const mc = cfg.judge_max_chars_per_skill;
    payload = {
      level: "L2",
      skill_a: { id: a.name, description: a.description, body_excerpt: extract.bodyExcerpt(a, mc) },
      skill_b: { id: b.name, description: b.description, body_excerpt: extract.bodyExcerpt(b, mc) },
      head_a: extract.headExtract(a),
      head_b: extract.headExtract(b),
      scores: promptScores(evidence),
      note: "正文关键段已给出；若仍不足请回 0（会记为 UNDECIDED）。",
      schema: SCHEMA
    };
  }
  return JSON.stringify(payload, null, 2);
}

function canonicalStringify(value) {
  function norm(v) {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  }
  return JSON.stringify(norm(value));
}

function promptDigest(level, prompt) {
  const rec = { version: PROMPT_VERSION, level: level, prompt: prompt };
  return crypto.createHash("sha256").update(canonicalStringify(rec)).digest("hex");
}

export { PROMPT_VERSION, SYSTEM, L0_NOTE_PLAIN, L0_NOTE_CAUTION, SCHEMA, EVIDENCE_ORDER, promptScores, buildPrompt, promptDigest, canonicalStringify };