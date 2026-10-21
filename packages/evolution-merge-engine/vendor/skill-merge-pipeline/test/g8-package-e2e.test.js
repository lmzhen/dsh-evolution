"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertReportModel } from "../src/contracts/report.js";

const ROOT = path.join(import.meta.dirname, "..");
const FIXTURE = path.join(ROOT, "parity", "fixtures", "corpus");
const MODELS = path.join(ROOT, "..", "models");
const INT8 = path.join(MODELS, "potion-multilingual-128M-int8");
const PCA = path.join(MODELS, "potion-multilingual-128M-pca64-int8");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, opts) { return spawnSync(cmd, args, Object.assign({ encoding: "utf8", timeout: 120000 }, opts || {})); }
function npm(args, cwd) {
  const env = Object.assign({}, process.env);
  delete env.npm_config_allow_scripts;
  delete env.NPM_CONFIG_ALLOW_SCRIPTS;
  return run(NPM, args, { cwd, shell: process.platform === "win32", env });
}

test("G8.3 独立包 E2E：干净安装后 scan/plan/doctor/models + 坏输入诊断", { timeout: 180000 }, () => {
  assert.ok(fs.existsSync(INT8) && fs.existsSync(PCA), "缺少本地模型，无法做独立包 E2E");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g8-pkg-"));
  try {
    const packDir = path.join(tmp, "pack"); fs.mkdirSync(packDir);
    const pack = npm(["pack", "--pack-destination", packDir], ROOT);
    assert.equal(pack.status, 0, pack.stderr);
    const tgz = fs.readdirSync(packDir).find(f => f.endsWith(".tgz"));
    assert.ok(tgz, "npm pack 未产出 tarball");
    const smoke = path.join(tmp, "smoke"); fs.mkdirSync(smoke);
    assert.equal(npm(["init", "-y"], smoke).status, 0);
    const inst = npm(["install", path.join(packDir, tgz), "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"], smoke);
    assert.equal(inst.status, 0, inst.stderr);
    const pkgRoot = path.join(smoke, "node_modules", "skill-merge-pipeline");
    const bin = path.join(pkgRoot, "bin", "skill-merge.js");
    assert.ok(fs.existsSync(bin), "安装包 bin 缺失");
    assert.equal(fs.existsSync(path.join(pkgRoot, "tools")), false, "安装包不得带仓库 tools");
    const env = Object.assign({}, process.env, { SKILL_MERGE_MODELS_ROOT: MODELS });
    const common = ["--corpus", FIXTURE, "--judge", "stub", "--rank", "vec", "--seed-mode", "fixed", "--embed-backend", "local", "--embed-local", INT8, "--embed-local-last", PCA];

    const offlineOut = path.join(tmp, "scan-offline");
    const offline = run(process.execPath, [bin, "scan"].concat(common, ["--out", offlineOut, "--offline"]), { env });
    assert.equal(offline.status, 0, offline.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(offlineOut, "report.json"), "utf8"));
    assertReportModel(report);
    assert.equal(report.stage4_semantic.selected, 17);
    assert.equal(report.pairs_final.length, 17);
    assert.ok(fs.existsSync(path.join(offlineOut, "run.meta.json")));
    assert.equal(fs.existsSync(path.join(offlineOut, "config.json")), false);
    assert.equal(fs.existsSync(path.join(offlineOut, "prompts")), false);

    const onlineOut = path.join(tmp, "scan-default");
    const online = run(process.execPath, [bin, "scan"].concat(common, ["--out", onlineOut]), { env });
    assert.equal(online.status, 0, online.stderr);
    assertReportModel(JSON.parse(fs.readFileSync(path.join(onlineOut, "report.json"), "utf8")));

    const planOut = path.join(tmp, "plan");
    const plan = run(process.execPath, [bin, "plan", "--report", path.join(offlineOut, "report.json"), "--corpus", FIXTURE, "--out", planOut, "--no-llm"], { env });
    assert.equal(plan.status, 0, plan.stderr);
    assert.ok(fs.existsSync(path.join(planOut, "summary.md")));
    const summary = JSON.parse(fs.readFileSync(path.join(planOut, "summary.json"), "utf8"));
    assert.ok(Array.isArray(summary.pairs) && summary.pairs.length);
    const saved = JSON.parse(fs.readFileSync(summary.pairs[0].file, "utf8"));
    assert.equal(saved.plan.schemaVersion, 1);
    assert.equal(saved.validate.ok, true);

    const doctor = run(process.execPath, [bin, "doctor", "--json", "--offline", "--models-dir", MODELS], { env });
    assert.ok(doctor.status === 0 || doctor.status === 2, doctor.stderr);
    const doc = JSON.parse(doctor.stdout);
    assert.equal(doc.schemaVersion, 1);
    assert.ok(Array.isArray(doc.checks));

    const models = run(process.execPath, [bin, "models", "ensure", "--dry-run", "--json", "--include", "ranker", "--offline"], { env });
    assert.equal(models.status, 0, models.stderr);
    const modelPlan = JSON.parse(models.stdout);
    assert.ok(Array.isArray(modelPlan.plan) && modelPlan.plan.length);

    const badReport = path.join(tmp, "bad-report.json");
    fs.writeFileSync(badReport, JSON.stringify({ schemaVersion: 2 }));
    const bad = run(process.execPath, [bin, "plan", "--report", badReport, "--corpus", FIXTURE, "--out", path.join(tmp, "bad-plan")], { env });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /\[INVALID\]/);
    assert.match(bad.stderr, /下一步：/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});