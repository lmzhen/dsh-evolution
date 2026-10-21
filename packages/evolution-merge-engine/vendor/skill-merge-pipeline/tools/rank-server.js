// G7.3：本地精排启动脚本（llama-server + StartLux GGUF）；缺 GGUF/二进制给可操作错误。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadRegistry, artifactDir } from "../src/models/registry.js";
import { ensureArtifacts, endpointOf } from "../src/models/provision.js";

const RANKER_ID = "ranker:startlux-0.8b";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8093;
const DEFAULT_CTX = 16384;

export function rankerFile(registry) {
  const a = registry.artifacts.find(x => x.id === RANKER_ID);
  if (!a) return null;
  return { artifact: a, file: a.files[0].path, dir: a.target };
}

export function resolveRankerPath(opts) {
  const o = opts || {};
  const loaded = loadRegistry();
  const meta = rankerFile(loaded.registry);
  if (!meta) return null;
  const root = o.modelsDir || undefined;
  const dir = artifactDir(loaded.registry, loaded.file, RANKER_ID, root);
  return path.join(dir, meta.file);
}

export function findLlamaServer(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const explicit = [o.bin, env.LLAMA_SERVER_BIN].filter(Boolean);
  for (const c of explicit) { try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (e) { /* 继续 */ } }
  const names = process.platform === "win32" ? ["llama-server.exe", "llama-server.cmd", "llama-server.bat"] : ["llama-server"];
  const dirs = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); try { if (fs.existsSync(p)) return p; } catch (e) { /* 继续 */ } }
  return null;
}

export function buildArgs(gguf, opts) {
  const o = opts || {};
  const args = ["-m", gguf, "--host", o.host || DEFAULT_HOST, "--port", String(o.port || DEFAULT_PORT), "--ctx-size", String(o.ctxSize || DEFAULT_CTX)];
  if (o.slots) args.push("--slots", String(o.slots));
  return args;
}

export function healthUrl(opts) {
  const o = opts || {};
  return "http://" + (o.host || DEFAULT_HOST) + ":" + (o.port || DEFAULT_PORT) + "/health";
}

export async function waitHealthy(url, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs === undefined ? 30000 : Number(o.timeoutMs);
  const intervalMs = o.intervalMs === undefined ? 500 : Number(o.intervalMs);
  const fetchImpl = o.fetchImpl || fetch;
  const span = o.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last = null;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const resp = await fetchImpl(url, { signal: AbortSignal.timeout(Math.min(2000, Math.max(200, timeoutMs))) });
      if (resp && resp.ok) {
        const body = await resp.json().catch(() => ({}));
        if (String(body.status || "").toLowerCase() === "ok") return { ok: true, attempts: attempts };
      }
    } catch (err) { last = err; }
    await span(intervalMs);
  }
  return { ok: false, attempts: attempts, error: String(last && last.message ? last.message : "健康检查超时") };
}

export function parseArgs(argv) {
  const o = { host: DEFAULT_HOST, port: DEFAULT_PORT, ctxSize: DEFAULT_CTX, dryRun: false, download: false };
  const list = argv || [];
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--download") o.download = true;
    else if (a === "--bin") o.bin = list[++i];
    else if (a === "--models-dir") o.modelsDir = list[++i];
    else if (a === "--gguf") o.gguf = list[++i];
    else if (a === "--host") o.host = list[++i];
    else if (a === "--port") o.port = Number(list[++i]);
    else if (a === "--ctx-size") o.ctxSize = Number(list[++i]);
    else if (a === "--slots") o.slots = Number(list[++i]);
    else if (a === "--health-timeout") o.healthTimeout = Number(list[++i]);
    else { console.error("未知参数: " + a); process.exit(2); }
  }
  return o;
}

export async function main(argv, deps) {
  const d = deps || {};
  const o = parseArgs(argv);
  const gguf = o.gguf ? path.resolve(o.gguf) : resolveRankerPath({ modelsDir: o.modelsDir });
  const bin = findLlamaServer({ bin: o.bin });
  const args = buildArgs(gguf, o);
  const url = healthUrl(o);
  if (o.dryRun) {
    console.log(JSON.stringify({ gguf: gguf, ggufExists: !!(gguf && fs.existsSync(gguf)), bin: bin, binExists: !!bin, args: args, healthUrl: url }, null, 2));
    return { exitCode: 0 };
  }
  if (!gguf || !fs.existsSync(gguf)) {
    console.error("缺少 ranker GGUF: " + String(gguf) + "\n请先下载: node tools/fetch-models.js --include ranker\n或加 --download 让本脚本先下载（约 774 MiB）。");
    return { exitCode: 2 };
  }
  if (!bin) {
    console.error("未找到 llama-server。安装 llama.cpp（含 llama-server）后重试，或用 --bin 指定路径 / 设 LLAMA_SERVER_BIN。\n参考: https://github.com/ggml-org/llama.cpp （Windows 可用 winget 或发布页二进制）。");
    return { exitCode: 2 };
  }
  const child = (d.spawnImpl || spawn)(bin, args, { stdio: "inherit", windowsHide: true });
  const health = await waitHealthy(url, { timeoutMs: o.healthTimeout || 30000, fetchImpl: d.fetchImpl });
  if (!health.ok) {
    try { child.kill(); } catch (e) { /* 忽略 */ }
    console.error("rank-server 健康检查失败（" + health.attempts + " 次，url=" + url + "）: " + health.error);
    return { exitCode: 2 };
  }
  console.log("rank-server 就绪: " + url + "（模型 " + path.basename(gguf) + "，pid=" + (child.pid || "?") + "）");
  return { exitCode: 0, child: child };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  main(process.argv.slice(2)).then(r => { if (r && r.exitCode) process.exitCode = r.exitCode; }).catch(err => { console.error(String(err && err.message ? err.message : err)); process.exitCode = 1; });
}