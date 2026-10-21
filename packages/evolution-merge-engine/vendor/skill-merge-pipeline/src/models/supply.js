"use strict";
// G6.2：本地档供给（fast path 零网络 / managed 走 registry 供给三策略）。
import path from "node:path";
import { exists, readJson } from "../io/read.js";
import { loadRegistry, defaultRegistryPath, artifactDir } from "./registry.js";
import { resolveModels } from "./firstrun.js";

function configuredDirs(cfg) {
  return { int8: cfg.embedder_model, pca: cfg.embedder_model_last || cfg.embedder_model };
}

function dirsReady(dirs) {
  try {
    if (!dirs || !dirs.int8 || !exists(path.join(dirs.int8, "config.json"))) return false;
    if (!dirs.pca || !exists(path.join(dirs.pca, "config.json"))) return false;
    return true;
  } catch (e) { return false; }
}

function localTierDirs(registry, registryFile, rootDir) {
  const out = {};
  for (const t of registry.tiers || []) {
    const m = (registry.models || []).find(x => x.id === t.modelRef);
    if (!m || m.compute !== "local-static" || !m.artifactRef) continue;
    out[m.artifactRef] = artifactDir(registry, registryFile, m.artifactRef, rootDir);
  }
  return out;
}

async function supplyLocalModels(opts) {
  const o = opts || {};
  const cfg = o.cfg || {};
  const runtime = o.runtime || null;
  const managed = o.managed !== undefined ? !!o.managed : Boolean(cfg.models_dir);
  const rootDir = o.rootDir !== undefined ? o.rootDir : (cfg.models_dir || undefined);
  const offline = o.offline !== undefined ? !!o.offline : !!cfg.offline;
  const autoProvision = o.autoProvision !== undefined ? !!o.autoProvision : cfg.auto_provision === true;
  const configured = configuredDirs(cfg);
  if (!managed && dirsReady(configured)) {
    return { managed: false, skipped: true, reason: "配置模型目录已就绪", dirs: configured, downloaded: [], built: [], verified: [], optionalMissing: [], offline: offline };
  }
  const loaded = o.registry
    ? { registry: o.registry, file: o.registryFile || defaultRegistryPath() }
    : loadRegistry(o.registryFile);
  const res = await resolveModels({
    cfg, registry: loaded.registry, registryFile: loaded.file, rootDir, offline, autoProvision,
    fetchImpl: o.fetchImpl, allowInsecure: o.allowInsecure, endpoint: o.endpoint, onProgress: o.onProgress
  });
  const rdirs = localTierDirs(loaded.registry, loaded.file, rootDir);
  const dirs = Object.assign({}, configured);
  if (rdirs["local:int8-256"]) dirs.int8 = rdirs["local:int8-256"];
  if (rdirs["local:pca64-int8"]) dirs.pca = rdirs["local:pca64-int8"];
  if (runtime) runtime.modelDirs = dirs;
  else {
    if (rdirs["local:int8-256"]) cfg.embedder_model = dirs.int8;
    if (rdirs["local:pca64-int8"]) cfg.embedder_model_last = dirs.pca;
  }
  return {
    managed: managed, skipped: false, dirs: dirs,
    downloaded: res.downloaded || [], built: res.built || [], verified: res.verified || [],
    optionalMissing: res.optionalMissing || [], offline: offline
  };
}

export { supplyLocalModels, configuredDirs, dirsReady, localTierDirs };