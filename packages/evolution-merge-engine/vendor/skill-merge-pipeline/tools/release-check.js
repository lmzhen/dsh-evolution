#!/usr/bin/env node
// 发布自检：版本/文件白名单 → 两次 pack 逐字节一致 → 干净安装 → bin --help → fixture E2E ④⑤ 核对。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const FAIL = [];
function ok(name, extra) { console.log("[OK] " + name + (extra ? " — " + extra : "")); }
function fail(name, extra) { FAIL.push(name + (extra ? " — " + extra : "")); console.log("[FAIL] " + name + (extra ? " — " + extra : "")); }
function run(cmd, args, opts) { return spawnSync(cmd, args, Object.assign({ encoding: "utf8", timeout: 180000 }, opts || {})); }
function npm(args, opts) {
  const env = Object.assign({}, process.env);
  delete env.npm_config_allow_scripts;
  delete env.NPM_CONFIG_ALLOW_SCRIPTS;
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, Object.assign({ shell: process.platform === "win32", env: env }, opts || {}));
}
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-merge-release-"));
try {
  if (pkg.version && !pkg.private) ok("版本/可见性", "v" + pkg.version); else fail("版本/可见性", "private 或 version 缺失");
  if (pkg.files && pkg.files.length && pkg.bin && pkg.bin["skill-merge"]) ok("包元数据", "files/bin 就位"); else fail("包元数据", "缺 files/bin");
  const p1 = path.join(tmp, "p1"); const p2 = path.join(tmp, "p2");
  fs.mkdirSync(p1); fs.mkdirSync(p2);
  const pack1 = npm(["pack", "--pack-destination", p1], { cwd: ROOT });
  const pack2 = npm(["pack", "--pack-destination", p2], { cwd: ROOT });
  const f1 = path.join(p1, "skill-merge-pipeline-" + pkg.version + ".tgz");
  const f2 = path.join(p2, "skill-merge-pipeline-" + pkg.version + ".tgz");
  if (pack1.status === 0 && pack2.status === 0 && fs.existsSync(f1) && fs.existsSync(f2)) {
    const h1 = sha(f1); const h2 = sha(f2);
    if (h1 === h2) ok("pack 确定性", "sha256=" + h1 + " size=" + fs.statSync(f1).size + "B");
    else fail("pack 确定性", "两次 pack sha 不同");
    const list = run(process.platform === "win32" ? "tar.exe" : "tar", ["-tzf", f1]);
    const entries = String(list.stdout || "").split("\n").map(l => l.trim()).filter(Boolean);
    const bad = entries.filter(l => /(^|\/)package\/(test|parity|out|team|node_modules|docs|tools|bench)\//.test(l));
    const required = ["package/bin/skill-merge.js", "package/src/run.js", "package/src/screening/index.js", "package/models/registry.json"];
    const missing = required.filter(x => !entries.includes(x));
    if (!bad.length && !missing.length) ok("内容审计", "files 白名单/必需入口就位"); else fail("内容审计", (bad.slice(0, 3).concat(missing)).join(","));
    const smoke = path.join(tmp, "smoke"); fs.mkdirSync(smoke);
    const init = npm(["init", "-y"], { cwd: smoke });
    const inst = npm(["install", f1, "--no-audit", "--no-fund", "--omit=optional", "--ignore-scripts"], { cwd: smoke });
    if (init.status === 0 && inst.status === 0) ok("干净安装", "npm install tarball 成功"); else fail("干净安装", String(inst.stderr || inst.stdout).slice(0, 300));
    const installedRun = path.join(smoke, "node_modules", pkg.name, "bin", "skill-merge.js");
    const help = run(process.execPath, [installedRun, "--help"]);
    if (help.status === 0 && /--corpus/.test(String(help.stdout || ""))) ok("bin --help", "已安装包 CLI 可用"); else fail("bin --help", String(help.stderr || "").slice(0, 300));
    const fixture = path.join(ROOT, "parity", "fixtures", "corpus");
    const outDir = path.join(tmp, "e2e");
    const localInt8 = path.join(ROOT, "..", "models", "potion-multilingual-128M-int8");
    const localPca = path.join(ROOT, "..", "models", "potion-multilingual-128M-pca64-int8");
    const env = Object.assign({}, process.env, { SKILL_MERGE_MODELS_ROOT: path.join(ROOT, "..", "models") });
    const e2e = run(process.execPath, [installedRun, "scan", "--corpus", fixture, "--out", outDir, "--judge", "stub", "--rank", "vec", "--seed-mode", "fixed", "--embed-backend", "local", "--embed-local", localInt8, "--embed-local-last", localPca], { env });
    let selected = null; let pairs = null;
    if (fs.existsSync(path.join(outDir, "report.json"))) { const rep = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")); selected = rep.stage4_semantic.selected; pairs = rep.pairs_final.length; }
    if (e2e.status === 0 && selected === 17 && pairs === 17) ok("安装包 E2E", "④=17 ⑤=17 exit=0"); else fail("安装包 E2E", "status=" + e2e.status + " ④=" + selected + " ⑤=" + pairs);
    const metaOk = fs.existsSync(path.join(outDir, "run.meta.json")) && !fs.existsSync(path.join(outDir, "config.json")) && fs.existsSync(path.join(outDir, "report.json"));
    if (metaOk) ok("安装包视图", "run.meta + report.json（无 config.json）"); else fail("安装包视图", "缺 run.meta/report 或残留 config.json");
    const planOut = path.join(tmp, "plan-e2e");
    const plan = run(process.execPath, [installedRun, "plan", "--report", path.join(outDir, "report.json"), "--corpus", fixture, "--out", planOut, "--no-llm"], { env });
    if (plan.status === 0 && fs.existsSync(path.join(planOut, "summary.md"))) ok("安装包 plan E2E", "summary.md 就位"); else fail("安装包 plan E2E", "status=" + plan.status + " " + String(plan.stderr || "").slice(0, 200));
    const models = run(process.execPath, [installedRun, "models", "ensure", "--dry-run", "--json", "--include", "ranker"], { env });
    let modelPlan = null; try { modelPlan = JSON.parse(models.stdout); } catch (e) { /* ignore */ }
    if (models.status === 0 && modelPlan && Array.isArray(modelPlan.plan) && modelPlan.plan.length) ok("安装包 models ensure", "dry-run 计划可用"); else fail("安装包 models ensure", "status=" + models.status + " " + String(models.stderr || "").slice(0, 200));
    const doctor = run(process.execPath, [installedRun, "doctor", "--json", "--offline", "--models-dir", path.join(ROOT, "..", "models")], { env });
    let doc = null; try { doc = JSON.parse(doctor.stdout); } catch (e) { /* ignore */ }
    if ((doctor.status === 0 || doctor.status === 2) && doc && doc.schemaVersion === 1 && Array.isArray(doc.checks)) ok("安装包 doctor", "结构化报告 exit=" + doctor.status); else fail("安装包 doctor", "status=" + doctor.status + " " + String(doctor.stderr || "").slice(0, 200));
    const rollbackDir = path.join(tmp, "rollback"); fs.mkdirSync(rollbackDir);
    const rbInit = npm(["init", "-y"], { cwd: rollbackDir });
    const rbInst = npm(["install", f1, "--no-audit", "--no-fund", "--omit=optional", "--ignore-scripts"], { cwd: rollbackDir });
    const rbPkg = path.join(rollbackDir, "node_modules", pkg.name);
    const rbBin = path.join(rbPkg, "bin", "skill-merge.js");
    if (rbInit.status === 0 && rbInst.status === 0 && fs.existsSync(rbBin)) { fs.rmSync(rbPkg, { recursive: true, force: true }); const rbAgain = npm(["install", f1, "--no-audit", "--no-fund", "--omit=optional", "--ignore-scripts"], { cwd: rollbackDir }); const rbHelp = () => run(process.execPath, [rbBin, "--help"]);
      if (rbAgain.status === 0 && fs.existsSync(rbBin) && rbHelp().status === 0) ok("回滚演练", "损坏安装后重装 tarball 恢复 bin"); else fail("回滚演练", "status=" + rbAgain.status + " bin=" + fs.existsSync(rbBin));
    } else fail("回滚演练", "初始安装失败 " + String(rbInst.stderr || rbInit.stderr || "").slice(0, 200));
  } else fail("npm pack", String(pack1.stderr || pack2.stderr || "").slice(0, 300));
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}
if (FAIL.length) { console.log("release-check: " + FAIL.length + " 项失败"); process.exitCode = 1; } else { console.log("release-check: 全部通过"); }