"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as report from "../src/report.js";
import { makeConfig } from "../src/config.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g7-views-"));

test("G7.4 report 视图：run.meta 取代 config.json，CSV 标派生，candidates banner", () => {
  const cfg = makeConfig();
  const rep = report.buildReport({ cfg, stages: [], usedMode: { embedder: "local", rank: "vec", judge: "stub", degraded: true, reasons: [{ code: "judge-stub", stage: "judge" }] }, sections: { corpus: { skills: 1 } } });
  const out = path.join(tmp, "views");
  report.writeArtifacts(out, { cfg, config: cfg, report: rep, markdown: "# 待合并候选清单\n", candidatesRows: [], pairsRows: [] });
  assert.equal(fs.existsSync(path.join(out, "config.json")), false);
  const meta = JSON.parse(fs.readFileSync(path.join(out, "run.meta.json"), "utf8"));
  assert.equal(meta.authoritative, "report.json");
  assert.equal(meta.degraded, true);
  assert.equal(meta.views["pairs.csv"].derived, true);
  assert.equal(meta.views["candidates.md"].source, "report.json");
  const md = fs.readFileSync(path.join(out, "candidates.md"), "utf8");
  assert.match(md, /^> 降级\/启发式: judge-stub\n\n# 待合并候选清单/);
  fs.rmSync(tmp, { recursive: true, force: true });
});