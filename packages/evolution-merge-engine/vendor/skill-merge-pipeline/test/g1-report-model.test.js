"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import * as report from "../src/report.js";
import { assertReportModel, REPORT_SCHEMA_VERSION, PAIR_REQUIRED_FIELDS } from "../src/contracts/report.js";
import { makeConfig } from "../src/config.js";
import { InvalidDataError } from "../src/errors.js";

const row = () => ({ a: "a", b: "b", action: "KEEP_BOTH", verdict_id: -1, reason: "r" });

test("C2 buildReport：顶层 generatedAt/command/degraded/pairs_final 固定", () => {
  const r = report.buildReport({
    cfg: makeConfig(),
    generatedAt: "2026-10-19T00:00:00.000Z",
    command: "skill-merge scan",
    stages: [{ id: "prefilter", ms: 1, counters: {}, degraded: false }],
    sections: { corpus: { skills: 1 }, pairs_final: [row()] },
  });
  assert.equal(r.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(r.generatedAt, "2026-10-19T00:00:00.000Z");
  assert.equal(r.command, "skill-merge scan");
  assert.equal(r.degraded, false);
  assert.deepEqual(r.pairs_final, [row()]);
  assertReportModel(r);
});

test("C2 默认 null 时间/命令，报告可复现；degraded 由 stage 推导", () => {
  const spec = { cfg: makeConfig(), stages: [{ id: "x", ms: 1, counters: {}, degraded: true }], sections: { pairs_final: [row()] } };
  const a = report.buildReport(spec);
  const b = report.buildReport(spec);
  assert.equal(a.generatedAt, null);
  assert.equal(a.command, null);
  assert.equal(a.degraded, true);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("C2 pairs_final 从 sections 提升，sections 不得覆盖保留键", () => {
  const r = report.buildReport({ cfg: makeConfig(), sections: { pairs_final: [row()] } });
  assert.deepEqual(r.pairs_final, [row()]);
  assert.equal(Object.prototype.hasOwnProperty.call(r, "pairs_final"), true);
  assert.throws(() => report.buildReport({ cfg: makeConfig(), sections: { generatedAt: "x" } }), InvalidDataError);
  assert.throws(() => report.buildReport({ cfg: makeConfig(), sections: { schemaVersion: 9 } }), InvalidDataError);
});

test("C2 assertReportModel 拒绝坏版本/缺字段/坏 pair", () => {
  assert.throws(() => assertReportModel({ schemaVersion: 2 }), InvalidDataError);
  const base = report.buildReport({ cfg: makeConfig(), sections: { pairs_final: [row()] } });
  for (const k of ["generatedAt", "command", "config", "stages", "timings", "diagnostics", "used_mode", "degraded", "pairs_final"]) {
    const c = Object.assign({}, base); delete c[k];
    assert.throws(() => assertReportModel(c), InvalidDataError, "缺 " + k);
  }
  const badPair = Object.assign({}, base, { pairs_final: [{ a: "a", b: "b" }] });
  assert.throws(() => assertReportModel(badPair), InvalidDataError);
  assert.ok(PAIR_REQUIRED_FIELDS.includes("action"));
});