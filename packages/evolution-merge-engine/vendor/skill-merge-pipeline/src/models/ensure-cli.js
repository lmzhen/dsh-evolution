"use strict";
// G3.3：包内显式模型供给命令（models ensure）；不 process.exit，错误交给 CLI shell。
import { loadRegistry, artifactById, artifactDir, modelsRootOf } from "./registry.js";
import { ensureModels } from "./build.js";
import { endpointOf, resolveUrl } from "./provision.js";
import { makeConfig } from "../config.js";
import { UsageError } from "../errors.js";

const ALIASES = { ranker: "ranker:startlux-0.8b", onnx: "onnx:e5-small" };
const USAGE = "用法: skill-merge models ensure [--all|--include <artifact,...>] [--dry-run] [--json] [--models-dir <dir>] [--offline] [--hf-endpoint <url>]";

function parseModelsArgs(argv) {
  const o = { include: [], all: false, dryRun: false, json: false, overrides: {}, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { o.help = true; continue; }
    if (a === "--include") { const v = argv[++i]; if (v === undefined || String(v).trim() === "") throw new UsageError("--include 需要 artifact id", { where: "models" }); for (const x of String(v).split(",")) if (x.trim()) o.include.push(ALIASES[x.trim()] || x.trim()); }
    else if (a === "--all") o.all = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a === "--offline") o.overrides.offline = true;
    else if (a === "--models-dir") { const v = argv[++i]; if (v === undefined || v === "") throw new UsageError("--models-dir 需要目录", { where: "models" }); o.overrides.models_dir = v; }
    else if (a === "--hf-endpoint") { const v = argv[++i]; if (v === undefined || v === "") throw new UsageError("--hf-endpoint 需要 URL", { where: "models" }); o.overrides.hf_endpoint = v; }
    else throw new UsageError("未知参数: " + a + "（" + USAGE + "）", { where: "models" });
  }
  return o;
}

function selectIds(registry, args) {
  let ids;
  if (args.include.length) ids = args.include.slice();
  else if (args.all) ids = registry.artifacts.map(a => a.id);
  else ids = registry.artifacts.filter(a => !a.optional).map(a => a.id);
  for (const id of ids) { try { artifactById(registry, id); } catch (e) { throw new UsageError("未知 artifact: " + id, { where: "models" }); } }
  return [...new Set(ids)];
}

function planOf(registry, registryFile, ids, cfg, rootDir) {
  const endpoint = cfg.hf_endpoint || endpointOf(cfg);
  return { endpoint, modelsRoot: modelsRootOf(registry, registryFile, rootDir), plan: ids.map(id => {
    const a = artifactById(registry, id);
    // derived/repo artifact 不是下载目标：derived 由 base 构建，repo 随包/随仓分发。
    // 只给 origin=hf 的文件生成 url，避免出现 https://.../undefined/... 这种伪下载地址。
    const origin = a.origin || (a.kind === "derived" ? "derived" : "repo");
    const entry = { id, optional: !!a.optional, kind: a.kind, origin, target: artifactDir(registry, registryFile, id, rootDir) };
    if (a.kind === "derived") { entry.recipe = a.recipe; entry.base = a.base; }
    entry.files = a.files.map(f => {
      const row = { path: f.path, sha256: f.sha256, bytes: f.bytes };
      if (origin === "hf") row.url = resolveUrl(endpoint, a.repo, f.path);
      return row;
    });
    return entry;
  }) };
}

function formatPlan(p) {
  const lines = ["modelsRoot: " + p.modelsRoot, "endpoint: " + p.endpoint];
  for (const x of p.plan) {
    const how = x.kind === "derived" ? "（构建自 " + x.base + "，recipe=" + x.recipe + "）" : x.origin === "repo" ? "（随包/随仓分发，无需下载）" : "";
    lines.push("[" + (x.optional ? "可选" : "必需") + "] " + x.id + " -> " + x.target + how);
    for (const f of x.files) {
      if (f.url) lines.push("  " + f.url + "\n    sha256=" + f.sha256 + " bytes=" + f.bytes);
      else lines.push("  " + f.path + "\n    sha256=" + f.sha256 + " bytes=" + f.bytes);
    }
  }
  return lines;
}

async function runModelsCommand(argv, opts) {
  const o = opts || {};
  const rest = argv || [];
  if (rest[0] === "-h" || rest[0] === "--help") return { exitCode: 0, lines: [USAGE] };
  const sub = rest[0];
  if (sub !== "ensure") throw new UsageError("未知 models 子命令: " + String(sub) + "（" + USAGE + "）", { where: "models" });
  const args = parseModelsArgs(rest.slice(1));
  if (args.help) return { exitCode: 0, lines: [USAGE] };
  const cfg = makeConfig(args.overrides);
  const loaded = loadRegistry(o.registryFile);
  const registry = loaded.registry;
  const registryFile = loaded.file;
  const rootDir = cfg.models_dir || undefined;
  const ids = selectIds(registry, args);
  const plan = planOf(registry, registryFile, ids, cfg, rootDir);
  if (args.dryRun) {
    if (args.json) return { exitCode: 0, lines: [JSON.stringify(plan, null, 2)] };
    return { exitCode: 0, lines: formatPlan(plan) };
  }
  const r = await ensureModels({ registry, registryFile, ids, rootDir, offline: cfg.offline, endpoint: cfg.hf_endpoint || undefined, fetchImpl: o.fetchImpl, signal: o.signal });
  if (args.json) return { exitCode: 0, lines: [JSON.stringify({ downloaded: r.downloaded, built: r.built, skipped: r.skipped }, null, 2)] };
  return { exitCode: 0, lines: ["模型供给完成: 下载 " + r.downloaded.length + " | 构建 " + r.built.length + " | 就位 " + r.skipped.length] };
}

export { ALIASES, USAGE as MODELS_USAGE, parseModelsArgs, selectIds, planOf, formatPlan, runModelsCommand };