"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as corpus from "../src/corpus.js";
import * as prefilter from "../src/screening/prefilter.js";
import { makeConfig } from "../src/config.js";
import * as candidates from "../src/screening/candidates.js";
import * as lexical from "../src/screening/lexical.js";
import { PyRandom } from "../src/pyrandom.js";
import { roundHalfEven } from "../src/numeric.js";
import { alignCandidates } from "../parity/align.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CORPUS = process.env.SKILL_MERGE_CORPUS || path.join(__dirname, "..", "parity", "fixtures", "corpus");
const cfg = makeConfig();
const [skills] = corpus.loadCorpus([CORPUS]);
corpus.stripBoilerplate(skills, cfg);
const [kept] = prefilter.prefilter(skills, cfg);
const CFG = makeConfig({ seed_mode: "fixed", round_count: 1 });

test("固定模式：candidates/lexical 与 Python golden 完全一致", () => {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "parity", "golden", "ref_stages.json"), "utf8"));
  const [pairs, stats] = candidates.generateCandidates(kept, CFG);
  assert.equal(pairs.size, ref.candidates_stats.candidate_pairs);
  const statCopy = Object.assign({}, stats);
  delete statCopy.rounds_detail;
  assert.deepEqual(statCopy, ref.candidates_stats);
  assert.deepEqual(stats.rounds_detail, ref.rounds_detail);
  const aligned = alignCandidates(pairs, ref.candidates);
  const [passed, , lexStats] = lexical.lexicalGate(kept, aligned, CFG);
  assert.equal(passed.length, ref.passed.length);
  assert.deepEqual(lexStats, ref.lexical_stats);
});

test("run 模式 RNG 序列与 PyRandom（CPython MT19937）一致", () => {
  const cfgRng = makeConfig({ seed_mode: "run", floor_jitter: 0.02 });
  const rng = new PyRandom(12345);
  const [seed, floor] = candidates.roundParams(cfgRng, 0, true, rng);
  const rng2 = new PyRandom(12345);
  const expSeed = rng2.randint(1, 1000000);
  const expFloor = Math.max(0.01, roundHalfEven(cfgRng.lsh_floor + rng2.uniform(-0.02, 0.02), 4));
  assert.equal(seed, expSeed);
  assert.equal(floor, expFloor);
});

test("run 种子：fixed 模式取 minhash_seed，run 模式在 31 位内", () => {
  assert.equal(candidates.runSeedOf(makeConfig({ seed_mode: "fixed" })), makeConfig().minhash_seed);
  const s = candidates.runSeedOf(makeConfig({ seed_mode: "run" }));
  assert.equal(Number.isInteger(s), true);
  assert.ok(s >= 0 && s <= 0x7FFFFFFF);
});

test("无内联 RNG/丢弃导出（ARCH 契约）", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "screening", "candidates.js"), "utf8");
  assert.equal(/mulberry32|math\.random/i.test(src), false);
  assert.equal("netItems" in candidates, false);
  assert.equal("makeRng" in candidates, false);
});