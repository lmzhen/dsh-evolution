"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as corpus from "../src/corpus.js";
import * as prefilter from "../src/screening/prefilter.js";
import * as candidates from "../src/screening/candidates.js";
import * as lexical from "../src/screening/lexical.js";
import { semanticSelect } from "../src/screening/semantic.js";
import { createContext } from "../src/pipeline/context.js";
import { runStage } from "../src/pipeline/stage.js";
import { prefilterStage } from "../src/stages/prefilter.js";
import { makeConfig } from "../src/config.js";
import { VIAS, viaFromNets, assertSelectedPair, assertSelectedPairs } from "../src/screening/contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(__dirname, "..", "parity", "fixtures", "corpus");

test("G4.4 via 推导与 pair 契约校验", () => {
  assert.deepEqual([...VIAS], ["summary", "body", "both"]);
  assert.equal(viaFromNets(["summary"]), "summary");
  assert.equal(viaFromNets(["body"]), "body");
  assert.equal(viaFromNets(["body", "summary"]), "both");
  const ok = { a: "a", b: "b", a_path: "a", b_path: "b", via: "both", arm: ["lsh"], score: 0.5 };
  assert.equal(assertSelectedPair(ok), ok);
  assert.throws(() => assertSelectedPair({ ...ok, via: "nope" }), /via 非法/);
  assert.throws(() => assertSelectedPair({ ...ok, arm: "lsh" }), /arm/);
  assert.throws(() => assertSelectedPair({ ...ok, score: NaN }), /score/);
  assert.throws(() => assertSelectedPair({ ...ok, a: "" }), /缺少 a/);
  assertSelectedPairs([ok]);
});

test("G4.4 candidates/lexical 选中行带 via/arm/score", () => {
  const cfg = makeConfig({ seed_mode: "fixed", round_count: 1 });
  const [skills] = corpus.loadCorpus([CORPUS]);
  const [kept] = prefilter.prefilter(skills, cfg);
  const [pairs] = candidates.generateCandidates(kept, cfg);
  for (const row of pairs.values()) {
    assert.ok(["summary", "body", "both"].includes(row.via));
    assert.equal(Array.isArray(row.arm), true);
    assert.equal(typeof row.score, "number");
  }
  const [passed] = lexical.lexicalGate(kept, pairs, cfg);
  assert.ok(passed.length > 0);
  for (const row of passed) {
    assert.ok(row.arm.includes("lsh"));
    assert.ok(row.arm.length >= 2);
    assert.equal(typeof row.score, "number");
  }
});

test("G4.4 semantic 选中行继承 via/arm 并追加 semantic arm", async () => {
  const cfg = makeConfig({ seed_mode: "fixed", round_count: 1, embed_backend: "local", embedder: "tfidf", semantic_top_n: 10, rank_mode: "vec" });
  const [skills] = corpus.loadCorpus([CORPUS]);
  const [kept] = prefilter.prefilter(skills, cfg);
  const [pairs] = candidates.generateCandidates(kept, cfg);
  const [passed] = lexical.lexicalGate(kept, pairs, cfg);
  const byPath = new Map(kept.map(s => [s.path, s]));
  const [selected] = await semanticSelect(passed, byPath, cfg);
  assert.ok(selected.length > 0);
  for (const row of selected) {
    assert.ok(["summary", "body", "both"].includes(row.via));
    assert.ok(row.arm.includes("lsh"));
    assert.ok(row.arm.some(a => a.startsWith("semantic:")), "缺 semantic arm");
    assert.equal(typeof row.score, "number");
  }
});

test("G4.4 stage 归一结果含 data/stats/warnings", async () => {
  const cfg = makeConfig({ seed_mode: "fixed", round_count: 1 });
  const [skills] = corpus.loadCorpus([CORPUS]);
  const ctx = createContext({ cfg });
  const res = await runStage(prefilterStage, ctx, { skills });
  assert.ok(Array.isArray(res.warnings));
  assert.equal(typeof res.stats, "object");
  assert.ok(Array.isArray(res.data.kept));
});

test("G4.4 算法层不拼 report 文案", () => {
  for (const f of ["candidates.js", "lexical.js", "semantic.js", "prefilter.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "screening", f), "utf8");
    assert.equal(/candidates\.md|pairs_final|strategy|建议合并|reportDoc/.test(src), false, f + " 含 report 文案");
  }
});