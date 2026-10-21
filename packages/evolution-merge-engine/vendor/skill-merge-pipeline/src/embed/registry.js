"use strict";
// C15：按 registry.models/tiers 解析档位链（取代 semantic 内硬编码 builder 列表）。
import path from "node:path";
import { InvalidDataError } from "../errors.js";
import { loadRegistry, validateCalibration, artifactDir, defaultRegistryPath } from "../models/registry.js";
import { exists, readJson } from "../io/read.js";
import { KNOWN_EMBED_BACKENDS } from "./provider.js";

let _cached = null;
const CALIBRATED_NAME = "registry.calibrated.json";

function attachCalibration(loaded) {
  const dir = path.dirname(loaded.file);
  const calFile = path.join(dir, CALIBRATED_NAME);
  if (!exists(calFile)) return loaded.registry;
  let doc;
  try { doc = readJson(calFile); } catch (err) {
    throw new InvalidDataError("校准产物无法解析: " + calFile + "（" + String(err && err.message ? err.message : err) + "）", { where: "embed-registry" });
  }
  if (!doc || !doc.calibration) throw new InvalidDataError("校准产物缺少 calibration 字段: " + calFile, { where: "embed-registry" });
  const tierIds = new Set((loaded.registry.tiers || []).map(t => t.id));
  validateCalibration(doc.calibration, tierIds);
  loaded.registry.calibration = doc.calibration;
  return loaded.registry;
}

function embedRegistry(file) {
  if (file) return attachCalibration(loadRegistry(file));
  if (!_cached) _cached = attachCalibration(loadRegistry());
  return _cached;
}

function modelMap(registry) { return new Map(registry.models.map(m => [m.id, m])); }

function resolveConfiguredDir(cfg, field) {
  const explicit = String((cfg && cfg[field]) || "").trim();
  if (explicit) return explicit;
  const reg = embedRegistry();
  const model = (reg.models || []).find(m => m.overrideField === field && m.artifactRef);
  if (!model) return "";
  return artifactDir(reg, defaultRegistryPath(), model.artifactRef, cfg && cfg.models_dir ? cfg.models_dir : undefined);
}

function resolveChain(cfg, registry) {
  const r = registry || embedRegistry();
  const models = modelMap(r);
  const mode = cfg.embed_backend || "local";
  if (!KNOWN_EMBED_BACKENDS.includes(mode)) throw new InvalidDataError("未知 embed_backend: " + mode + "（可选: " + KNOWN_EMBED_BACKENDS.join("/") + "）", { where: "embed-registry" });
  let tiers = r.tiers;
  if (mode === "remote") tiers = tiers.filter(t => models.get(t.modelRef).compute === "api").slice(0, 1);
  else if (mode === "local") tiers = tiers.filter(t => models.get(t.modelRef).compute === "local-static").slice(0, 1);
  if (!tiers.length) throw new InvalidDataError("registry.tiers 为空或不满足 backend=" + mode, { where: "embed-registry" });
  return {
    mode,
    tiers: tiers.map(t => {
      const m = models.get(t.modelRef);
      const kind = m.compute === "api" ? "remote" : "local";
      return {
        tier: t.id, modelId: m.id, floorPreset: t.floorPreset, kind, provider: m.provider,
        overrideField: m.overrideField, artifactRef: m.artifactRef || null,
        floors: { body: m.floors.body, summary: m.floors.summary },
        effectiveModel: kind === "remote" ? (cfg[m.overrideField] || m.transport.model) : null
      };
    })
  };
}

function resolveFloorPreset(cfg, registry, tierLabel) {
  const r = registry || embedRegistry();
  const presets = cfg.embed_floor_presets || {};
  const t = (r.tiers || []).find(x => x.id === tierLabel);
  let preset = null;
  let source = null;
  if (presets[tierLabel]) { preset = presets[tierLabel]; source = "cfg:tier"; }
  let registryFloors = null;
  if (t) {
    const m = r.models.find(x => x.id === t.modelRef);
    if (m && m.floors) registryFloors = m.floors;
    if (!preset && presets[t.floorPreset]) { preset = presets[t.floorPreset]; source = "cfg:preset"; }
  }
  const calibrationFloors = r.calibration && r.calibration.floors ? r.calibration.floors[tierLabel] : null;
  if (!preset && calibrationFloors) { preset = calibrationFloors; source = "calibration"; }
  if (!preset && registryFloors) { preset = registryFloors; source = "registry"; }
  if (!preset) { preset = presets["local"] || {}; source = presets["local"] ? "cfg:local" : "cfg:default"; }
  return {
    body_core: Number(preset.body !== undefined ? preset.body : cfg.semantic_body_floor),
    summary: Number(preset.summary !== undefined ? preset.summary : cfg.semantic_summary_floor),
    source: source
  };
}

function floorsFor(cfg, registry, tierLabel) {
  const p = resolveFloorPreset(cfg, registry, tierLabel);
  return { body_core: p.body_core, summary: p.summary };
}

export { embedRegistry, resolveChain, floorsFor, resolveFloorPreset, resolveConfiguredDir };