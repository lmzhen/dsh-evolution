"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as report from "../src/report.js";
import { CONFIG_FIELDS } from "../src/config/schema.js";
import { makeConfig } from "../src/config.js";
import { InvalidDataError } from "../src/errors.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-report-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const CONFIG_KEYS = CONFIG_FIELDS.map(f => f.key);
const loneLf = s => /(^|[^\r])\n/.test(s);

test("snapshotConfig：只含 CONFIG_FIELDS 键，排除运行时注入键", () => {
  const cfg = makeConfig();
  cfg.rank_checkpoint = "x";
  cfg.judge_cache_path = "y";
  cfg.stub2_floors = { body: 1, summary: 1 };
  cfg.runtime_noise = 1;
  const snap = report.snapshotConfig(cfg);
  for (const k of Object.keys(snap)) assert.ok(CONFIG_KEYS.includes(k), "未知配置键: " + k);
  assert.equal(Object.prototype.hasOwnProperty.call(snap, "rank_checkpoint"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snap, "judge_cache_path"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snap, "stub2_floors"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snap, "runtime_noise"), false);
  assert.equal(snap.embedder_model, cfg.embedder_model);
});

test("assertJsonSafe/pruneUndefined：undefined/NaN/function 拒绝；嵌套 undefined 被剪除", () => {
  assert.throws(() => report.assertJsonSafe({ a: undefined }), /undefined/);
  assert.throws(() => report.assertJsonSafe({ a: NaN }), /非有限/);
  assert.throws(() => report.assertJsonSafe({ a: () => 1 }), /不可序列化/);
  assert.deepEqual(report.pruneUndefined({ a: 1, b: undefined, c: { d: undefined, e: 2 }, f: [1, undefined, { g: undefined }] }), { a: 1, c: { e: 2 }, f: [1, null, {}] });
});

test("buildReport：schema/stages/timings/diagnostics/used_mode/config 白名单", () => {
  const cfg = makeConfig();
  const stages = [
    { id: "prefilter", ms: 1.5, counters: { skills: 2 }, degraded: false },
    { id: "candidates", ms: 2, counters: {}, degraded: true }
  ];
  const r = report.buildReport({
    cfg, stages,
    diagnostics: [{ code: "UNAVAILABLE", where: "x", detail: "y" }],
    usedMode: { embedder: "local", rank: "vec", judge: "stub" },
    sections: { corpus: { skills: 2 }, pairs_final: [{ a: "x", b: "y", action: "KEEP_BOTH", verdict_id: -1 }] }
  });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.meta.contractVersion, "v1");
  assert.equal(r.stages.length, 2);
  assert.deepEqual(r.timings, { total_ms: 3.5, by_stage: { prefilter: 1.5, candidates: 2 } });
  assert.equal(r.diagnostics.length, 1);
  assert.deepEqual(r.used_mode, { embedder: "local", rank: "vec", judge: "stub" });
  assert.equal(Object.prototype.hasOwnProperty.call(r.config, "rank_checkpoint"), false);
  assert.deepEqual(r.pairs_final, [{ a: "x", b: "y", action: "KEEP_BOTH", verdict_id: -1 }]);
  assert.throws(() => report.buildReport({ cfg, sections: { bad: undefined } }), /undefined/);
  assert.equal(JSON.stringify(r).includes("undefined"), false);
  assert.throws(() => report.buildReport({ cfg, sections: { schemaVersion: 9 } }), InvalidDataError);
});

test("writeArtifacts：native LF/全引号 CSV；python CRLF/排序 JSON/最小引号", () => {
  const cfg = makeConfig();
  const baseReport = report.buildReport({ cfg, stages: [{ id: "prefilter", ms: 1, counters: {}, degraded: false }], sections: { corpus: { skills: 2 } } });
  const spec = (c) => ({
    cfg: c, config: { z: 1, a: 2 }, report: baseReport,
    markdown: "# md\n\n- x\n",
    candidatesRows: [["a", "b", 1, "MERGE", "L0", 0.9, 1, "r"]]
  });
  const dirN = path.join(tmp, "native");
  report.writeArtifacts(dirN, spec(Object.assign({}, cfg, { parity_bytes: false, io_dialect: "native" })));
  const repN = fs.readFileSync(path.join(dirN, "report.json"), "utf8");
  assert.equal(repN.includes("\r\n"), false);
  assert.ok(loneLf(repN));
  assert.match(repN, /^\{\n  "schemaVersion"/);
  const metaN = JSON.parse(fs.readFileSync(path.join(dirN, "run.meta.json"), "utf8"));
  assert.deepEqual(metaN.config, baseReport.config);
  assert.equal(metaN.authoritative, "report.json");
  assert.equal(metaN.views["candidates.csv"].derived, true);
  assert.equal(fs.existsSync(path.join(dirN, "config.json")), false);
  const csvN = fs.readFileSync(path.join(dirN, "candidates.csv"), "utf8");
  assert.match(csvN, /^"a","b","verdict"/);
  assert.equal(fs.readFileSync(path.join(dirN, "candidates.md"), "utf8").includes("\r\n"), false);
  const dirP = path.join(tmp, "python");
  report.writeArtifacts(dirP, spec(Object.assign({}, cfg, { parity_bytes: true })));
  const repP = fs.readFileSync(path.join(dirP, "report.json"), "utf8");
  assert.ok(repP.includes("\r\n"));
  assert.equal(loneLf(repP), false);
  assert.match(repP, /^\{\r\n  "command"/);
  assert.equal(fs.readFileSync(path.join(dirP, "report.json"), "utf8").includes("\r\n"), true);
  const csvP = fs.readFileSync(path.join(dirP, "candidates.csv"), "utf8");
  assert.match(csvP, /^a,b,verdict/);
  assert.ok(csvP.includes("\r\n"));
  assert.equal(loneLf(csvP), false);
  assert.ok(fs.readFileSync(path.join(dirP, "candidates.md"), "utf8").includes("\r\n"));
});

test("writeArtifacts：同方言两次输出字节一致", () => {
  const cfg = makeConfig({ parity_bytes: true });
  const rep = report.buildReport({ cfg, stages: [], sections: { corpus: { skills: 1 } } });
  const spec = { cfg, config: cfg, report: rep, markdown: "m\n", candidatesRows: [], pairsRows: [] };
  const a = path.join(tmp, "det-a");
  const b = path.join(tmp, "det-b");
  report.writeArtifacts(a, spec);
  report.writeArtifacts(b, spec);
  for (const f of ["report.json", "run.meta.json", "candidates.md", "candidates.csv", "pairs.csv"]) {
    assert.ok(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))), f + " 不一致");
  }
});