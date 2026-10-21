"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFloorPreset, floorsFor } from "../src/embed/registry.js";
import { makeConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reg = {
  tiers: [{ id: "t", modelRef: "m", floorPreset: "p" }],
  models: [{ id: "m", compute: "local-static", floors: { body: 0.2, summary: 0.3 } }],
  calibration: null,
};

test("G4.3 floor 来源优先级：cfg:tier > cfg:preset > calibration > registry > cfg:local > cfg:default", () => {
  const base = { semantic_body_floor: 0.9, semantic_summary_floor: 0.8 };
  const tier = resolveFloorPreset(makeConfig({ ...base, embed_floor_presets: { t: { body: 0.11, summary: 0.12 }, p: { body: 0.21, summary: 0.22 } } }), reg, "t");
  assert.equal(tier.source, "cfg:tier");
  assert.equal(tier.body_core, 0.11);
  const preset = resolveFloorPreset(makeConfig({ ...base, embed_floor_presets: { p: { body: 0.21, summary: 0.22 } } }), reg, "t");
  assert.equal(preset.source, "cfg:preset");
  assert.equal(preset.body_core, 0.21);
  const calibrated = { ...reg, calibration: { floors: { t: { body: 0.31, summary: 0.32 } } } };
  const cal = resolveFloorPreset(makeConfig({ ...base, embed_floor_presets: {} }), calibrated, "t");
  assert.equal(cal.source, "calibration");
  assert.equal(cal.body_core, 0.31);
  const registry = resolveFloorPreset(makeConfig({ ...base, embed_floor_presets: {} }), reg, "t");
  assert.equal(registry.source, "registry");
  assert.equal(registry.body_core, 0.2);
  const local = resolveFloorPreset(makeConfig({ ...base, embed_floor_presets: { local: { body: 0.41, summary: 0.42 } } }), { ...reg, models: [], tiers: [] }, "t");
  assert.equal(local.source, "cfg:local");
  assert.equal(local.body_core, 0.41);
  const def = resolveFloorPreset(makeConfig({ ...base, embed_floor_presets: {} }), { ...reg, models: [], tiers: [] }, "t");
  assert.equal(def.source, "cfg:default");
  assert.equal(def.body_core, 0.9);
  assert.deepEqual(floorsFor(makeConfig({ ...base, embed_floor_presets: {} }), reg, "t"), { body_core: 0.2, summary: 0.3 });
});

test("G4.3 运行时只读：registry/screening 不 import 校准生成器", () => {
  const files = ["../src/embed/registry.js", "../src/screening/semantic.js", "../src/index.js"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.equal(/calibrate\.js/.test(src), false, f + " 不得 import 校准生成器");
  }
});