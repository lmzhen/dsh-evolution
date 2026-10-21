"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScanStages } from "../src/pipeline/compose.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("G2 scan 组合根：顺序固定、无重复", () => {
  const stages = buildScanStages();
  assert.deepEqual(stages.map(s => s.id), ["prefilter", "candidates", "lexical", "provision", "rank_plan", "semantic", "rerank", "judge"]);
  assert.equal(new Set(stages.map(s => s.id)).size, stages.length);
  assert.ok(stages.every(s => s && typeof s.run === "function"));
});

test("G2 run.js 只做 CLI shell", () => {
  const file = path.join(__dirname, "..", "src", "run.js");
  const src = fs.readFileSync(file, "utf8");
  const lineCount = src.split(/\r?\n/).length;
  assert.ok(lineCount < 50, "run.js 行数=" + lineCount);
  assert.equal(/defaultStages|provisionStage|rankPlanStage|buildScanStages|corpus\.|writeArtifacts/.test(src), false);
  assert.match(src, /runScan/);
});