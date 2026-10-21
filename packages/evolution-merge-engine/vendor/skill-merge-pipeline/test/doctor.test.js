"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkNode, checkKeys, checkHf, checkModels, checkRanker, runDoctor, parseCredentials } from "../src/models/doctor.js";
import { validateRegistry } from "../src/models/registry.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIX = path.join(__dirname, "..", "parity", "fixtures", "build", "base");
const tmps = [];
after(() => { for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } } });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-doctor-")); tmps.push(d); return d; }
function sha(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
function fileEntry(p, name) { return { path: name, sha256: sha(p), bytes: fs.statSync(p).size }; }
function makeRegistry() {
  return validateRegistry({
    schemaVersion: 1, modelsRoot: "models", recipes: { "fp16-cast": { builderVer: 1 } },
    artifacts: [{ id: "base-f32", kind: "source", origin: "repo", target: "base", files: [
      fileEntry(path.join(FIX, "model.safetensors"), "model.safetensors"),
      fileEntry(path.join(FIX, "config.json"), "config.json"),
      fileEntry(path.join(FIX, "tokenizer.json"), "tokenizer.json")
    ] }, { id: "opt-x", kind: "source", origin: "repo", target: "opt", optional: true, files: [fileEntry(path.join(FIX, "model.safetensors"), "model.safetensors")] }], models: [], tiers: [], calibration: null
  });
}
function place(dir, reg) {
  for (const a of reg.artifacts) {
    if (a.optional) continue;
    const d = path.join(dir, a.target);
    fs.mkdirSync(d, { recursive: true });
    for (const f of a.files) fs.copyFileSync(path.join(FIX, f.path), path.join(d, f.path));
  }
}
function makeCtx(placeFiles) {
  const dir = tmpDir();
  const reg = makeRegistry();
  const modelsDir = path.join(dir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  const regFile = path.join(modelsDir, "registry.json");
  fs.writeFileSync(regFile, JSON.stringify(reg));
  if (placeFiles) place(modelsDir, reg);
  return { dir, modelsDir, regFile, reg };
}
const okFetch = () => Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => Buffer.from("{}") });
const failFetch = () => Promise.reject(new Error("connect timeout"));

test("checkNode：pass 与版本过低 fail", () => {
  assert.equal(checkNode({ nodeVersion: "26.4.0" }).status, "pass");
  const bad = checkNode({ nodeVersion: "18.19.0" });
  assert.equal(bad.status, "fail");
  assert.match(bad.hint, /升级 Node/);
});

test("checkKeys：env 优先 / 凭据文件 / 缺失 skip", () => {
  const credDir = tmpDir();
  const credPath = path.join(credDir, ".credentials.yaml");
  fs.writeFileSync(credPath, "refs: { DEEPSEEK_API_KEY: sk-aaa, SILICONFLOW_API_KEY: sk-bbb }\nrecords:\n  other: x\n");
  assert.equal(checkKeys({ env: {}, credentialsPath: credPath }).status, "pass");
  assert.match(checkKeys({ env: { DEEPSEEK_API_KEY: "sk-x", SILICONFLOW_API_KEY: "sk-y" }, credentialsPath: path.join(credDir, "nope.yaml") }).detail, /DEEPSEEK_API_KEY=env/);
  const miss = checkKeys({ env: {}, credentialsPath: path.join(credDir, "nope.yaml") });
  assert.equal(miss.status, "skip");
  assert.match(miss.detail, /缺少/);
  assert.match(miss.hint, /写入 .*\.yaml/);
  assert.deepEqual(parseCredentials("refs: { A_KEY: v1 }") , { A_KEY: "v1" });
});

test("checkHf：离线 skip / 可达 pass / 超时 fail 带镜像建议", async () => {
  assert.equal((await checkHf({ offline: true })).status, "skip");
  const pass = await checkHf({ fetchImpl: okFetch, endpoint: "https://hf-mirror.com", cfg: {} });
  assert.equal(pass.status, "pass");
  const fail = await checkHf({ fetchImpl: failFetch, endpoint: "https://huggingface.co", cfg: {} });
  assert.equal(fail.status, "fail");
  assert.match(fail.hint, /HF_ENDPOINT/);
  const http = await checkHf({ fetchImpl: () => Promise.resolve({ ok: false, status: 503, arrayBuffer: async () => Buffer.alloc(0) }), endpoint: "https://x", cfg: {} });
  assert.equal(http.status, "fail");
  assert.match(http.detail, /HTTP 503/);
});

test("checkModels：齐全 pass；缺失 fail 且含期望 sha/路径/建议", () => {
  const good = makeCtx(true);
  const ok = checkModels({ registry: good.reg, registryFile: good.regFile, rootDir: good.modelsDir, cfg: {} });
  assert.equal(ok.status, "pass");
  assert.match(ok.detail, /可选未安装/);
  const bad = makeCtx(false);
  const fail = checkModels({ registry: bad.reg, registryFile: bad.regFile, rootDir: bad.modelsDir, cfg: {} });
  assert.equal(fail.status, "fail");
  assert.match(fail.detail, /model\.safetensors/);
  assert.match(fail.detail, /sha256=/);
  assert.match(fail.detail, /bytes=/);
  assert.match(fail.hint, /手动放置/);
});

test("checkRanker：vec skip / local 失败 fail / auto 失败 skip", async () => {
  const mkCfg = rank_mode => ({ rank_mode, rank_server: "http://127.0.0.1:8093", rank_probe_timeout: 1 });
  assert.equal((await checkRanker({ cfg: mkCfg("vec") })).status, "skip");
  assert.equal((await checkRanker({ cfg: mkCfg("local"), fetchImpl: okFetch })).status, "pass");
  const fail = await checkRanker({ cfg: mkCfg("local"), fetchImpl: failFetch });
  assert.equal(fail.status, "fail");
  assert.match(fail.hint, /llama-server/);
  assert.equal((await checkRanker({ cfg: mkCfg("auto"), fetchImpl: failFetch })).status, "skip");
});

test("runDoctor：报告 schema/exitCode/summary", async () => {
  const ctx = makeCtx(true);
  const report = await runDoctor({ registry: ctx.reg, registryFile: ctx.regFile, rootDir: ctx.modelsDir, offline: true, env: { DEEPSEEK_API_KEY: "x", SILICONFLOW_API_KEY: "y" }, cfg: { models_dir: "", rank_mode: "vec", rank_server: "" } });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.checks.length, 5);
  assert.deepEqual(Object.keys(report.summary).sort(), ["fail", "pass", "skip"]);
  assert.equal(report.summary.fail, 0);
  const bad = await runDoctor({ registry: ctx.reg, registryFile: ctx.regFile, rootDir: path.join(ctx.dir, "empty"), offline: true, env: {}, cfg: { models_dir: "", rank_mode: "vec", rank_server: "" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 2);
});

test("CLI：--json --offline 输出 JSON 且失败 exit 2", () => {
  const empty = tmpDir();
  const q = spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "doctor.js"), "--json", "--offline", "--models-dir", empty], { encoding: "utf8" });
  assert.equal(q.status, 2);
  const rep = JSON.parse(q.stdout);
  assert.equal(rep.schemaVersion, 1);
  assert.equal(rep.checks.some(c => c.id === "models" && c.status === "fail"), true);
});