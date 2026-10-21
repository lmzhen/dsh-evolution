"use strict";
// C9：source 产物下载（HF resolve/镜像/Range 续传/sha 校验/原子安装/offline）。derived 交给 G2.3 build。
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { InvalidDataError, UnavailableError, ModelMissingError } from "../errors.js";
import { hashFile, fileMeta, readBinary } from "../io/read.js";
import { ensureDir, createWriteStream, renameFile, removeFile, writeFileBytes } from "../io/bytes.js";
import { artifactById, artifactDir, verifyArtifact, defaultRegistryPath } from "./registry.js";
import { proxiedFetch } from "../net/proxy.js";

const DEFAULT_ENDPOINT = "https://huggingface.co";
const HF_HOSTS = Object.freeze(["huggingface.co", "cdn-lfs.huggingface.co", "hf-mirror.com", "cdn-lfs.hf-mirror.com"]);
// HF LFS/CAS CDN 子域（镜像 302 到 cas-bridge.xethub.hf.co 等；仅这些后缀放行）
const HF_HOST_SUFFIXES = Object.freeze([".hf.co", ".huggingface.co", ".hf-mirror.com"]);
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function endpointOf(opts) {
  const ep = (opts && opts.endpoint) || process.env.HF_ENDPOINT || DEFAULT_ENDPOINT;
  return String(ep).replace(/\/+$/, "");
}

function resolveUrl(endpoint, repo, file) {
  return endpoint + "/" + repo + "/resolve/main/" + String(file).split("/").map(s => encodeURIComponent(s)).join("/");
}

function assertUrlAllowed(url, opts) {
  let u;
  try { u = new URL(url); } catch (e) { throw new UnavailableError("下载 URL 非法: " + url, { where: "provision" }); }
  const insecureOk = !!(opts && opts.allowInsecure);
  if (u.protocol !== "https:" && !insecureOk) throw new UnavailableError("只允许 https 下载（当前 " + u.protocol + "）: " + u.host, { where: "provision" });
  let epHost = "";
  try { epHost = new URL(endpointOf(opts)).host; } catch (e) { /* 忽略 */ }
  const allowed = u.host === epHost || HF_HOSTS.includes(u.hostname) || HF_HOST_SUFFIXES.some(s => u.hostname.endsWith(s));
  if (!allowed) throw new UnavailableError("下载域名不在白名单: " + u.host + "（允许 HF 官方/镜像或 HF_ENDPOINT 指定域）", { where: "provision" });
  return u;
}

function partOf(dest) { return dest + ".part"; }

async function downloadFile(spec) {
  const o = spec.opts || {};
  const { url, dest, sha256, bytes, id, file, onProgress } = spec;
  if (!Number.isInteger(bytes) || bytes <= 0) throw new InvalidDataError("声明 bytes 非法: " + dest, { where: "provision" });
  const maxBytes = o.maxBytes === undefined ? DEFAULT_MAX_BYTES : Number(o.maxBytes);
  if (bytes > maxBytes) throw new InvalidDataError("文件超过体积上限: " + file + " bytes=" + bytes + " > " + maxBytes, { where: "provision" });
  ensureDir(path.dirname(dest));
  const part = partOf(dest);
  const fetchImpl = o.fetchImpl || ((u, i) => proxiedFetch(u, i));
  let start = 0;
  if (o.resume !== false) { const m = fileMeta(part); if (m.exists) start = m.bytes; }
  if (start > bytes) { removeFile(part); start = 0; }
  if (start > 0 && start === bytes) {
    if (hashFile(part) === sha256) { renameFile(part, dest); return { downloaded: 0, resumed: true }; }
    removeFile(part);
    start = 0;
  }
  const doFetch = (s) => fetchImpl(url, { headers: s > 0 ? { Range: "bytes=" + s + "-" } : {}, redirect: "follow", signal: o.signal });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 镜像限流/瞬时 5xx 重试（429 优先 Retry-After；总 4 次，指数退避）。Range 续传由同一 start 保证。
  const fetchWithRetry = async (s) => {
    const attempts = 4;
    let lastErr = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let resp;
      try { resp = await doFetch(s); } catch (err) {
        if (err && err.name === "AbortError") throw err;
        lastErr = err;
        if (attempt === attempts - 1) break;
        await sleep(400 * (attempt + 1));
        continue;
      }
      assertUrlAllowed(resp.url || url, o);
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt === attempts - 1) return resp;
        const ra = Number(resp.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 8000) : 400 * Math.pow(2, attempt);
        try { if (resp.body && typeof resp.body.cancel === "function") await resp.body.cancel(); } catch (ignore) { /* 忽略取消失败 */ }
        await sleep(wait);
        continue;
      }
      return resp;
    }
    throw new UnavailableError("下载失败: " + url + " (" + String(lastErr && lastErr.message ? lastErr.message : lastErr) + ")", { where: "provision", retryable: true, cause: lastErr });
  };
  let resp = await fetchWithRetry(start);
  if (start > 0 && resp.status === 206) {
    const cr = resp.headers.get("content-range") || "";
    const m = /bytes\s+(\d+)-/.exec(cr);
    if (m && Number(m[1]) !== start) { removeFile(part); start = 0; resp = await fetchWithRetry(0); }
  } else if (start > 0 && resp.status !== 206) {
    removeFile(part);
    start = 0;
  }
  if (!resp.ok) throw new UnavailableError("下载 HTTP " + resp.status + ": " + url, { where: "provision", retryable: resp.status >= 500 || resp.status === 429 });
  const offset = start;
  let received = offset;
  const ws = createWriteStream(part, offset > 0 ? "a" : "w");
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > bytes) return cb(new InvalidDataError("下载内容超过声明大小: " + file, { where: "provision" }));
      if (typeof onProgress === "function") onProgress({ id, file, received, total: bytes });
      cb(null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(resp.body), counter, ws);
  } catch (err) {
    removeFile(part);
    if (err && (err.name === "AbortError")) throw err;
    if (err instanceof InvalidDataError) throw err;
    throw new UnavailableError("下载中断: " + url + " (" + String(err && err.message ? err.message : err) + ")", { where: "provision", retryable: true, cause: err });
  }
  const meta = fileMeta(part);
  if (meta.bytes !== bytes) { removeFile(part); throw new InvalidDataError("下载大小不符: " + file + " 期望 " + bytes + " 实际 " + meta.bytes, { where: "provision" }); }
  const actual = hashFile(part);
  if (actual !== sha256) { removeFile(part); throw new InvalidDataError("sha256 不符（拒绝安装）: " + file + " 期望 " + sha256 + " 实际 " + actual, { where: "provision" }); }
  renameFile(part, dest);
  return { downloaded: received - offset, resumed: offset > 0 };
}

async function ensureArtifacts(params) {
  const p = params || {};
  const registry = p.registry;
  if (!registry || !Array.isArray(registry.artifacts)) throw new InvalidDataError("缺少 registry", { where: "provision" });
  const opts = {
    rootDir: p.rootDir, endpoint: p.endpoint, fetchImpl: p.fetchImpl, allowInsecure: p.allowInsecure,
    maxBytes: p.maxBytes, onProgress: p.onProgress, signal: p.signal, resume: p.resume
  };
  const ids = p.ids && p.ids.length ? p.ids.slice() : registry.artifacts.map(a => a.id);
  const result = { manifests: {}, downloaded: [], copied: [], skipped: [], needsBuild: [] };
  for (const id of ids) {
    const a = artifactById(registry, id);
    if (a.kind === "derived") { result.needsBuild.push(id); continue; }
    const dir = artifactDir(registry, p.registryFile, id, p.rootDir);
    if (a.origin === "repo") {
      // 随包分发工件（如 pca64/proj.f32）：从包内默认 models 根复制到目标 root，不联网。
      const shippedDir = artifactDir(registry, defaultRegistryPath(), id, undefined);
      const missingShipped = [];
      let copiedAny = false;
      for (const f of a.files) {
        const dest = path.join(dir, f.path);
        const meta = fileMeta(dest);
        if (meta.exists && meta.bytes === f.bytes && hashFile(dest) === f.sha256) continue;
        const src = path.join(shippedDir, f.path);
        const sm = fileMeta(src);
        if (!sm.exists) { missingShipped.push({ dest, src, sha256: f.sha256, bytes: f.bytes }); continue; }
        ensureDir(path.dirname(dest));
        writeFileBytes(dest, readBinary(src));
        const after = fileMeta(dest);
        if (after.bytes !== f.bytes || hashFile(dest) !== f.sha256) throw new InvalidDataError("随包工件复制后校验失败: " + id + " " + f.path, { where: "provision" });
        copiedAny = true;
      }
      if (missingShipped.length) {
        const lines = missingShipped.map(m => "  - " + m.dest + " (sha256=" + m.sha256 + ", bytes=" + m.bytes + "，随包文件缺失: " + m.src + ")").join("\n");
        throw new ModelMissingError("随包工件缺失（安装包不完整或 models root 被改写）:\n" + lines + "\n请重装包或运行 skill-merge models ensure。", { where: "provision:" + id });
      }
      const checkRepo = verifyArtifact(registry, p.registryFile, id, { rootDir: p.rootDir, hash: true });
      if (!checkRepo.ok) throw new InvalidDataError("随包工件校验失败: " + id + " " + JSON.stringify({ missing: checkRepo.missing, mismatched: checkRepo.mismatched }), { where: "provision" });
      result.manifests[id] = a.manifest || null;
      if (copiedAny) result.copied.push(id); else result.skipped.push(id);
      continue;
    }
    const missing = [];
    let touched = false;
    for (const f of a.files) {
      const dest = path.join(dir, f.path);
      const meta = fileMeta(dest);
      if (meta.exists && meta.bytes === f.bytes && hashFile(dest) === f.sha256) continue;
      touched = true;
      if (p.offline) { missing.push({ path: dest, sha256: f.sha256, bytes: f.bytes }); continue; }
      const url = resolveUrl(endpointOf(opts), a.repo, f.path);
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await downloadFile({ url, dest, sha256: f.sha256, bytes: f.bytes, opts, id, file: f.path, onProgress: p.onProgress });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (!(err && err.retryable)) throw err;
          await delay(1000 * (attempt + 1));
        }
      }
      if (lastErr) throw lastErr;
    }
    if (missing.length) {
      const lines = missing.map(m => "  - " + m.path + " (sha256=" + m.sha256 + ", bytes=" + m.bytes + ")").join("\n");
      throw new ModelMissingError("offline 模式缺少模型文件（不会联网）:\n" + lines + "\n请联网重试、设置 HF_ENDPOINT 镜像，或按上述路径手动放置后重跑。", { where: "provision:" + id });
    }
    const check = verifyArtifact(registry, p.registryFile, id, { rootDir: p.rootDir, hash: true });
    if (!check.ok) throw new InvalidDataError("安装后校验失败: " + id + " " + JSON.stringify({ missing: check.missing, mismatched: check.mismatched }), { where: "provision" });
    result.manifests[id] = a.manifest || null;
    (touched ? result.downloaded : result.skipped).push(id);
  }
  return result;
}

export { DEFAULT_ENDPOINT, HF_HOSTS, HF_HOST_SUFFIXES, DEFAULT_MAX_BYTES, endpointOf, resolveUrl, assertUrlAllowed, downloadFile, ensureArtifacts };