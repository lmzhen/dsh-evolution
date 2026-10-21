"use strict";
// C11：doctor 五类探针（node/模型/HF/凭据/精排）+ JSON 报告 + exit 0/2。
import path from "node:path";
import os from "node:os";
import { readText, exists } from "../io/read.js";
import { loadRegistry, verifyArtifact, modelsRootOf, defaultRegistryPath } from "./registry.js";
import { endpointOf, resolveUrl } from "./provision.js";
import { makeConfig } from "../config.js";
import { proxiedFetch } from "../net/proxy.js";

const REPORT_SCHEMA_VERSION = 1;
const MIN_NODE_MAJOR = 20;
const HF_PROBE_REPO = "minishlab/potion-multilingual-128M";
const KEY_NAMES = ["SILICONFLOW_API_KEY", "DEEPSEEK_API_KEY"];

function mk(id, label, status, detail, hint) {
  const c = { id, label, status, detail };
  if (hint) c.hint = hint;
  return c;
}

function checkNode(opts) {
  const version = (opts && opts.nodeVersion) || process.versions.node;
  const major = Number(String(version).split(".")[0]);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return mk("node", "Node 版本", "pass", "v" + version + "（要求 ≥" + MIN_NODE_MAJOR + "）");
  return mk("node", "Node 版本", "fail", "v" + version + " 过低（要求 ≥" + MIN_NODE_MAJOR + "）", "升级 Node.js 到 20 或更高");
}

function parseCredentials(text) {
  const out = {};
  const re = /(^|[\s{,])([A-Z][A-Z0-9_]+)\s*:\s*([^\s,}]+)/g;
  let m;
  while ((m = re.exec(String(text))) !== null) out[m[2]] = m[3];
  return out;
}

function checkKeys(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const credPath = o.credentialsPath || path.join(os.homedir(), ".dsh", ".credentials.yaml");
  let creds = {};
  let credNote = "";
  if (exists(credPath)) { try { creds = parseCredentials(readText(credPath)); } catch (e) { credNote = "（凭据文件读取失败）"; } }
  const found = {};
  const missing = [];
  for (const k of KEY_NAMES) {
    if (env[k]) found[k] = "env";
    else if (creds[k]) found[k] = "file";
    else missing.push(k);
  }
  const detailFound = KEY_NAMES.filter(k => found[k]).map(k => k + "=" + found[k]).join(", ");
  if (!missing.length) return mk("keys", "API 凭据", "pass", detailFound + credNote);
  return mk("keys", "API 凭据", "skip", "缺少 " + missing.join(", ") + (detailFound ? "（已有 " + detailFound + "）" : "") + credNote, "本地模式可用；远程 ④/真实 ⑤ 需要：设置环境变量或写入 " + credPath);
}

async function checkHf(opts) {
  const o = opts || {};
  if (o.offline) return mk("hf", "HF/镜像可达性", "skip", "offline 模式，已跳过网络探针");
  const endpoint = o.endpoint || endpointOf(o.cfg || {});
  const fetchImpl = o.fetchImpl || ((u, i) => proxiedFetch(u, i));
  const url = resolveUrl(endpoint, HF_PROBE_REPO, "config.json");
  const timeoutMs = o.timeoutMs === undefined ? 8000 : Number(o.timeoutMs);
  try {
    const resp = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return mk("hf", "HF/镜像可达性", "fail", "HTTP " + resp.status + " @ " + endpoint, "检查网络/镜像；可设 HF_ENDPOINT=https://hf-mirror.com");
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) return mk("hf", "HF/镜像可达性", "fail", "返回空内容 @ " + endpoint, "检查镜像状态或换 HF_ENDPOINT");
    return mk("hf", "HF/镜像可达性", "pass", endpoint + " 可达（探测 " + buf.length + " B）");
  } catch (err) {
    return mk("hf", "HF/镜像可达性", "fail", endpoint + " 不可达: " + String(err && err.message ? err.message : err).slice(0, 160), "本机直连 HF 常超时；设置 HF_ENDPOINT=https://hf-mirror.com，或配置代理（G7）");
  }
}

function checkModels(opts) {
  const o = opts || {};
  let registry, registryFile;
  try {
    const loaded = o.registry ? { registry: o.registry, file: o.registryFile || defaultRegistryPath() } : loadRegistry(o.registryFile);
    registry = loaded.registry; registryFile = loaded.file;
  } catch (err) {
    return mk("models", "模型产物", "fail", "registry 非法: " + String(err && err.message ? err.message : err).slice(0, 160), "检查 node/models/registry.json");
  }
  const cfg = o.cfg || makeConfig();
  const rootDir = o.rootDir || cfg.models_dir || undefined;
  const modelsRoot = modelsRootOf(registry, registryFile, rootDir);
  const bad = [];
  const lines = [];
  const optionalMissing = [];
  for (const a of registry.artifacts) {
    const v = verifyArtifact(registry, registryFile, a.id, { rootDir });
    if (v.ok) continue;
    if (a.optional) { optionalMissing.push(a.id); continue; }
    bad.push(a.id);
    for (const f of a.files) {
      const missing = v.missing.includes(f.path);
      const mm = v.mismatched.find(m => m.path === f.path);
      if (missing) lines.push("缺失 " + path.join(v.dir, f.path) + "（期望 sha256=" + f.sha256.slice(0, 16) + "… bytes=" + f.bytes + "）");
      else if (mm) lines.push(mm.reason + " 不符 " + path.join(v.dir, f.path) + "（期望 " + (mm.reason === "size" ? "bytes=" + f.bytes : "sha256=" + f.sha256.slice(0, 16) + "…") + "）");
    }
  }
  const optNote = optionalMissing.length ? "；可选未安装: " + optionalMissing.join(", ") + "（skill-merge models ensure --include ranker）" : "";
  if (!bad.length) return mk("models", "模型产物", "pass", (registry.artifacts.length - optionalMissing.length) + " 个必需 artifact 就位" + optNote + "（" + modelsRoot + "）");
  return mk("models", "模型产物", "fail", "缺失/损坏: " + bad.join(", ") + "\n" + lines.join("\n") + optNote, "首启会自动下载源模型并构建派生模型；离线请按上面路径+sha 手动放置后重跑 doctor");
}

async function checkRanker(opts) {
  const o = opts || {};
  const cfg = o.cfg || makeConfig();
  const mode = cfg.rank_mode || "auto";
  if (mode === "vec") return mk("ranker", "本地精排服务", "skip", "rank_mode=vec，④.5 直接走向量降级");
  const base = String(cfg.rank_server || "").replace(/\/$/, "");
  if (!base) return mk("ranker", "本地精排服务", mode === "local" ? "fail" : "skip", "rank_server 未配置", "启动 llama-server 并设置 --rank-server");
  const fetchImpl = o.fetchImpl || ((u, i) => proxiedFetch(u, i));
  try {
    const resp = await fetchImpl(base + "/health", { signal: AbortSignal.timeout(Number(cfg.rank_probe_timeout || 2) * 1000) });
    if (resp.ok) return mk("ranker", "本地精排服务", "pass", base + "/health OK");
    throw new Error("HTTP " + resp.status);
  } catch (err) {
    const reason = base + " 不可用: " + String(err && err.message ? err.message : err).slice(0, 120);
    if (mode === "local") return mk("ranker", "本地精排服务", "fail", reason, "启动 llama-server（见 G2.6 文档）或改用 --rank vec");
    return mk("ranker", "本地精排服务", "skip", reason + "（auto 自动降级 vec）", "需要本地精排时启动 llama-server");
  }
}

async function runDoctor(opts) {
  const o = opts || {};
  const cfg = o.cfg || makeConfig();
  const endpoint = o.endpoint || endpointOf(cfg);
  const checks = [];
  checks.push(checkNode(o));
  checks.push(checkModels(Object.assign({}, o, { cfg })));
  checks.push(await checkHf(Object.assign({}, o, { cfg, endpoint })));
  checks.push(checkKeys(o));
  checks.push(await checkRanker(Object.assign({}, o, { cfg })));
  const summary = { pass: 0, fail: 0, skip: 0 };
  for (const c of checks) summary[c.status] += 1;
  const ok = summary.fail === 0;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok, exitCode: ok ? 0 : 2,
    offline: !!o.offline, endpoint,
    modelsRoot: (() => { try { return modelsRootOf((o.registry || loadRegistry(o.registryFile).registry), o.registryFile || defaultRegistryPath(), o.rootDir || cfg.models_dir || undefined); } catch (e) { return null; } })(),
    checks, summary
  };
}

export { REPORT_SCHEMA_VERSION, MIN_NODE_MAJOR, KEY_NAMES, checkNode, checkKeys, checkHf, checkModels, checkRanker, runDoctor, parseCredentials };