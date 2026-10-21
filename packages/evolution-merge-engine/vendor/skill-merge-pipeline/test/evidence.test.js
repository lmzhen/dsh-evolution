"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_KEYS, buildEvidence, validateEvidence, canonicalEvidence } from "../src/evidence.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";

test("buildEvidence：四键齐全，缺失为 null", () => {
  const ev = buildEvidence({ jaccard_summary: 0.12, body_core_cosine: 0.97 });
  assert.deepEqual(Object.keys(ev), [...EVIDENCE_KEYS]);
  assert.equal(ev.jaccard_summary, 0.12);
  assert.equal(ev.jaccard_body, null);
  assert.equal(ev.body_cosine, 0.97);
  assert.equal(ev.summary_cosine, null);
});

test("buildEvidence：undefined/NaN/非数值一律 null，不丢键", () => {
  const ev = buildEvidence({ jaccard_summary: undefined, jaccard_body: NaN, body_cosine: "x", summary_cosine: 0 });
  assert.deepEqual(ev, { jaccard_summary: null, jaccard_body: null, body_cosine: null, summary_cosine: 0 });
  assert.equal(JSON.stringify(ev).includes("undefined"), false);
});

test("buildEvidence：body_cosine 优先于 body_core_cosine", () => {
  const ev = buildEvidence({ body_cosine: 0.5, body_core_cosine: 0.9 });
  assert.equal(ev.body_cosine, 0.5);
});

test("validateEvidence：缺键/多键/非法值均抛 INVALID", () => {
  const good = buildEvidence({ jaccard_summary: 0.1 });
  assert.equal(validateEvidence(good), good);
  for (const bad of [null, {}, { jaccard_summary: 0.1 }, Object.assign({}, good, { extra: 1 }), Object.assign({}, good, { body_cosine: "x" })]) {
    try { validateEvidence(bad); assert.fail("应抛错: " + JSON.stringify(bad)); } catch (e) {
      assert.equal(toDiagnostic(e).code, DiagnosticCode.INVALID);
    }
  }
});

test("canonicalEvidence：键序固定，仅用于 sha/缓存键", () => {
  const a = buildEvidence({ summary_cosine: 0.6, jaccard_summary: 0.1 });
  const s = canonicalEvidence(a);
  assert.equal(s, JSON.stringify({ jaccard_summary: 0.1, jaccard_body: null, body_cosine: null, summary_cosine: 0.6 }));
});