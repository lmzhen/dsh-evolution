"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { calibrateCorpus, canonicalStringify, quantileLinear } from "../src/embed/calibrate.js";
import { loadRegistry } from "../src/models/registry.js";
import { embedRegistry, floorsFor } from "../src/embed/registry.js";
import { makeConfig } from "../src/config.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIX = path.join(__dirname, "..", "parity", "fixtures", "corpus");
const MODELS = "D:/dsh/skill-merge/models";
const TOOL = path.join(__dirname, "..", "tools", "calibrate.js");
const REAL = loadRegistry();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cal-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

const ARGS = { corpus: [FIX], registry: REAL.registry, registryFile: REAL.file, rootDir: MODELS, tiers: ["local:int8-256"], quantile: 0.95, margin: 0 };

test("量词/规范化单测", () => {
  assert.equal(quantileLinear([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantileLinear([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantileLinear([7], 0.9), 7);
  assert.equal(canonicalStringify({ b: 1, a: { d: 2, c: 3 } }), "{\n  \"a\": {\n    \"c\": 3,\n    \"d\": 2\n  },\n  \"b\": 1\n}\n");
});

test("calibrateCorpus：产物字段/地板公式/逐字节可复现", async () => {
  const a = await calibrateCorpus(ARGS);
  const c = a.artifact.calibration;
  assert.equal(a.artifact.schemaVersion, 1);
  assert.match(c.samplesSha, /^[0-9a-f]{64}$/);
  assert.equal(c.n, 134);
  assert.equal(c.quantile, 0.95);
  assert.equal(c.margin, 0);
  assert.deepEqual(Object.keys(c.floors), ["local:int8-256"]);
  for (const f of Object.values(c.floors)) {
    for (const v of [f.body, f.summary]) {
      assert.ok(v >= 0 && v <= 1);
      assert.equal(v * 10000, Math.round(v * 10000));
    }
  }
  const b = await calibrateCorpus(ARGS);
  assert.equal(a.canonical, b.canonical, "同参数两次产物必须逐字节相同");
  const m = await calibrateCorpus(Object.assign({}, ARGS, { margin: 0.02 }));
  const f0 = a.artifact.calibration.floors["local:int8-256"];
  const f1 = m.artifact.calibration.floors["local:int8-256"];
  assert.equal(f1.body, Math.round(Math.min(1, f0.body + 0.02) * 10000) / 10000);
  assert.equal(f1.summary, Math.round(Math.min(1, f0.summary + 0.02) * 10000) / 10000);
});

test("CLI：写产物、同参数二次逐字节一致、已存在无 --force 拒绝", () => {
  const out = path.join(tmp, "registry.calibrated.json");
  const base = ["--corpus", FIX, "--tier", "local:int8-256", "--models-dir", MODELS, "--quantile", "0.9", "--margin", "0.01", "--out", out];
  const r1 = spawnSync(process.execPath, [TOOL].concat(base), { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /samplesSha=/);
  const b1 = fs.readFileSync(out);
  const r2 = spawnSync(process.execPath, [TOOL].concat(base, ["--force"]), { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  assert.deepEqual(fs.readFileSync(out), b1, "CLI 两次产物逐字节一致");
  const r3 = spawnSync(process.execPath, [TOOL].concat(base), { encoding: "utf8" });
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /已存在/);
  const dry = spawnSync(process.execPath, [TOOL].concat(base, ["--dry-run"]), { encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout, b1.toString("utf8"), "--dry-run 输出与产物一致");
});

test("运行时只读：同目录 calibrated 挂载生效且不写 registry.json", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "reg-"));
  const regFile = path.join(dir, "registry.json");
  fs.writeFileSync(regFile, JSON.stringify(REAL.registry));
  const cal = {
    schemaVersion: 1,
    calibration: { version: 1, samplesSha: "a".repeat(64), n: 20, quantile: 0.9, margin: 0, floors: { "local:int8-256": { body: 0.33, summary: 0.44 } } }
  };
  fs.writeFileSync(path.join(dir, "registry.calibrated.json"), canonicalStringify(cal));
  const before = fs.readFileSync(regFile);
  const reg = embedRegistry(regFile);
  assert.deepEqual(floorsFor(makeConfig({ embed_floor_presets: {} }), reg, "local:int8-256"), { body_core: 0.33, summary: 0.44 });
  assert.deepEqual(fs.readFileSync(regFile), before, "运行时不得写 registry.json");
  fs.writeFileSync(path.join(dir, "registry.calibrated.json"), canonicalStringify({
    schemaVersion: 1, calibration: { version: 1, samplesSha: "a".repeat(64), n: 20, floors: { "nope": { body: 0.1, summary: 0.1 } } }
  }));
  assert.throws(() => embedRegistry(regFile), /未知 tier/);
});

test("错误路径：远程档/未知档/样本不足均拒绝", async () => {
  const cases = [
    [Object.assign({}, ARGS, { tiers: ["qwen3-embedding-8b"] }), /远程档/],
    [Object.assign({}, ARGS, { tiers: ["nope"] }), /未知档位/],
    [Object.assign({}, ARGS, { minPairs: 100000 }), /样本对不足/]
  ];
  for (const [args, re] of cases) {
    await assert.rejects(calibrateCorpus(args), err => {
      assert.equal(toDiagnostic(err).code, DiagnosticCode.INVALID);
      assert.match(err.message, re);
      return true;
    });
  }
});