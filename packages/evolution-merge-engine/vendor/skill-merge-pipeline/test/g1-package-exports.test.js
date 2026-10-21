"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("G1.5 公共 API self-reference 可导入且无 CLI 副作用", async () => {
  const api = await import("skill-merge-pipeline");
  assert.equal(typeof api.runPipeline, "function");
  assert.equal(typeof api.runScan, "function");
  assert.equal(typeof api.defaultStages, "function");
  assert.equal(typeof api.planMerges, "function");
  assert.equal(typeof api.makeConfig, "function");
  assert.equal(typeof api.parseCli, "function");
  assert.equal(typeof api.assertReportModel, "function");
  assert.equal(typeof api.assertStageResult, "function");
  assert.equal(typeof api.validateMergePlanShape, "function");
});

test("G1.5 exports 子路径可导入", async () => {
  const merge = await import("skill-merge-pipeline/merge");
  assert.equal(typeof merge.planMerges, "function");
  const pipeline = await import("skill-merge-pipeline/pipeline");
  assert.equal(typeof pipeline.runPipeline, "function");
  const cli = await import("skill-merge-pipeline/cli");
  assert.equal(typeof cli.parseCli, "function");
  const screening = await import("skill-merge-pipeline/screening");
  assert.equal(typeof screening.prefilter, "function");
  assert.equal(typeof screening.semanticSelect, "function");
  const contracts = await import("skill-merge-pipeline/contracts");
  assert.equal(contracts.CONTRACT_VERSION, "v1");
  const report = await import("skill-merge-pipeline/contracts/report");
  assert.equal(typeof report.assertReportModel, "function");
  const stage = await import("skill-merge-pipeline/contracts/stage");
  assert.equal(typeof stage.assertStageResult, "function");
  const mergeContract = await import("skill-merge-pipeline/contracts/merge");
  assert.equal(mergeContract.MODES.length, 5);
});

test("G1.5 exports 阻断内部深引", async () => {
  await assert.rejects(() => import("skill-merge-pipeline/src/config.js"), (e) => /not exported|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(String(e && e.code || e)));
  await assert.rejects(() => import("skill-merge-pipeline/src/run.js"), (e) => /not exported|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(String(e && e.code || e)));
});

test("G1.5 bin 与 files 白名单存在", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkg.main, "./src/index.js");
  assert.equal(pkg.bin["skill-merge"], "./bin/skill-merge.js");
  assert.ok(pkg.files.includes("bin/"));
  assert.ok(pkg.files.includes("models/pca64/"));
  assert.equal(pkg.files.includes("bench/"), false);
  assert.equal(pkg.files.includes("docs/"), false);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "bin", "skill-merge.js")));
});