"use strict";
// G2.5：首启供给编排（C9 hook）——校验优先 → auto/offline/no-auto 三策略 → 下载+构建 → 返回 manifest+dirs。
import path from "node:path";
import { InvalidDataError, ModelMissingError } from "../errors.js";
import { loadRegistry, verifyArtifact, artifactDir, artifactById, defaultRegistryPath } from "./registry.js";
import { ensureModels } from "./build.js";
import { makeConfig } from "../config.js";

function manualHint(registry, registryFile, missingIds, rootDir) {
  const lines = [];
  for (const id of missingIds) {
    const a = artifactById(registry, id);
    const dir = artifactDir(registry, registryFile, id, rootDir);
    for (const f of a.files) lines.push("  - " + path.join(dir, f.path) + " (sha256=" + f.sha256 + ", bytes=" + f.bytes + ")");
  }
  return lines.join("\n");
}

async function resolveModels(opts) {
  const o = opts || {};
  const cfg = o.cfg || makeConfig();
  const loaded = o.registry ? { registry: o.registry, file: o.registryFile || defaultRegistryPath() } : loadRegistry(o.registryFile);
  const registry = loaded.registry;
  const registryFile = loaded.file;
  const rootDir = o.rootDir || cfg.models_dir || undefined;
  const offline = o.offline !== undefined ? !!o.offline : !!cfg.offline;
  const auto = o.autoProvision !== undefined ? !!o.autoProvision : cfg.auto_provision === true;
  const result = { manifests: {}, dirs: {}, verified: [], downloaded: [], built: [], skipped: [], optionalMissing: [] };
  const missing = [];
  for (const a of registry.artifacts) {
    if (verifyArtifact(registry, registryFile, a.id, { rootDir }).ok) result.verified.push(a.id);
    else if (a.optional) result.optionalMissing.push(a.id);
    else missing.push(a.id);
  }
  if (missing.length) {
    if (!auto) {
      throw new ModelMissingError("模型缺失（离线优先，默认不自动下载）: " + missing.join(", ") + "\n运行 skill-merge models ensure 下载/构建，或设置 --models-dir 指向已有模型根目录。", { where: "firstrun" });
    }
    if (offline) {
      throw new ModelMissingError("offline 模式缺少模型（不会联网）:\n" + manualHint(registry, registryFile, missing, rootDir) + "\n请联网重试（可设 HF_ENDPOINT 镜像）或按上述路径手动放置后重跑。", { where: "firstrun" });
    }
    const ens = await ensureModels({
      registry, registryFile, ids: registry.artifacts.filter(a => !a.optional).map(a => a.id), rootDir, offline: false,
      endpoint: o.endpoint, fetchImpl: o.fetchImpl, allowInsecure: o.allowInsecure, onProgress: o.onProgress, signal: o.signal, force: false
    });
    result.downloaded = ens.downloaded;
    result.built = ens.built;
    result.skipped = ens.skipped;
  }
  for (const a of registry.artifacts) {
    const v = verifyArtifact(registry, registryFile, a.id, { rootDir, hash: true });
    if (!v.ok) {
      if (a.optional) { if (!result.optionalMissing.includes(a.id)) result.optionalMissing.push(a.id); continue; }
      throw new InvalidDataError("模型校验失败: " + a.id + " " + JSON.stringify({ missing: v.missing, mismatched: v.mismatched }), { where: "firstrun" });
    }
    result.manifests[a.id] = a.manifest || null;
    result.dirs[a.id] = artifactDir(registry, registryFile, a.id, rootDir);
  }
  return result;
}

const ensureArtifacts = resolveModels;

export { resolveModels, ensureArtifacts, manualHint };