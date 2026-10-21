"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ensureArtifacts, resolveUrl, endpointOf, assertUrlAllowed, downloadFile } from "../src/models/provision.js";
import { validateRegistry } from "../src/models/registry.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-prov-"));
const REG_FILE = path.join(DIR, "models", "registry.json");
fs.mkdirSync(path.dirname(REG_FILE), { recursive: true });
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const A = Buffer.from("FP32-BASE-" + "x".repeat(4000));
const B = Buffer.from("{\"model_type\": \"model2vec\"}");
const REG = {
  schemaVersion: 1, modelsRoot: "models",
  recipes: { "fp16-cast": { builderVer: 1, params: {} } },
  artifacts: [
    { id: "base-f32", kind: "source", origin: "hf", repo: "acme/test-repo", target: "base", files: [
      { path: "model.safetensors", sha256: sha(A), bytes: A.length },
      { path: "config.json", sha256: sha(B), bytes: B.length }
    ] },
    { id: "derived-x", kind: "derived", recipe: "fp16-cast", base: "base-f32", target: "derived",
      manifest: { dtype: "F16", dim: 2, rows: 3, tokenizerSha: sha(B), builderVer: 1 },
      files: [{ path: "model.safetensors", sha256: "a".repeat(64), bytes: 10 }] }
  ],
  models: [], tiers: [], calibration: null
};
fs.writeFileSync(REG_FILE, JSON.stringify(REG, null, 2));
const reg = validateRegistry(JSON.parse(JSON.stringify(REG)));

const state = { requests: [], wrongHash: false, ignoreRange: false, redirectModel: false };
const server = http.createServer((req, res) => {
  state.requests.push({ url: req.url, range: req.headers.range || null });
  if (state.redirectModel && req.url === "/acme/test-repo/resolve/main/model.safetensors") {
    res.writeHead(302, { Location: "/real/model.safetensors" });
    res.end();
    return;
  }
  let body = null;
  if (req.url === "/acme/test-repo/resolve/main/model.safetensors" || req.url === "/real/model.safetensors") body = state.wrongHash ? Buffer.alloc(A.length, "Z") : A;
  else if (req.url === "/acme/test-repo/resolve/main/config.json") body = B;
  if (!body) { res.writeHead(404); res.end("not found"); return; }
  const range = /bytes=(\d+)-/.exec(req.headers.range || "");
  if (range && !state.ignoreRange) {
    const start = Number(range[1]);
    res.writeHead(206, { "Content-Length": body.length - start, "Content-Range": "bytes " + start + "-" + (body.length - 1) + "/" + body.length });
    res.end(body.subarray(start));
    return;
  }
  res.writeHead(200, { "Content-Length": body.length });
  res.end(body);
});
let ENDPOINT = "";
after(() => { server.close(); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

function baseOpts(extra) {
  return Object.assign({ registry: reg, registryFile: REG_FILE, ids: ["base-f32"], endpoint: ENDPOINT, allowInsecure: true }, extra || {});
}
function reset() { state.requests = []; state.wrongHash = false; state.ignoreRange = false; state.redirectModel = false; }

test("setup: 本地服务器", async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  ENDPOINT = "http://127.0.0.1:" + server.address().port;
  assert.equal(endpointOf({ endpoint: ENDPOINT + "/" }), ENDPOINT);
  assert.equal(resolveUrl(ENDPOINT, "acme/test-repo", "model.safetensors"), ENDPOINT + "/acme/test-repo/resolve/main/model.safetensors");
});

test("全新下载：原子安装、sha/bytes 校验、进度与无 .part 残留", async () => {
  reset();
  const progress = [];
  const r = await ensureArtifacts(baseOpts({ onProgress: e => progress.push(e) }));
  assert.deepEqual(r.downloaded, ["base-f32"]);
  assert.deepEqual(r.skipped, []);
  assert.equal(fs.readFileSync(path.join(DIR, "models", "base", "model.safetensors")).equals(A), true);
  assert.equal(fs.existsSync(path.join(DIR, "models", "base", "model.safetensors.part")), false);
  assert.ok(state.requests.length >= 2);
  assert.ok(progress.length >= 1);
  assert.equal(progress[progress.length - 1].received, progress[progress.length - 1].total);
});

test("已存在且校验通过：全部 skip 且零新请求", async () => {
  reset();
  const r = await ensureArtifacts(baseOpts());
  assert.deepEqual(r.skipped, ["base-f32"]);
  assert.equal(state.requests.length, 0);
});

test("Range 续传：服务器收到 bytes=N- 且最终 sha 一致", async () => {
  reset();
  const dest = path.join(DIR, "models", "base", "model.safetensors");
  fs.rmSync(dest);
  fs.writeFileSync(dest + ".part", A.subarray(0, 100));
  const r = await ensureArtifacts(baseOpts());
  assert.deepEqual(r.downloaded, ["base-f32"]);
  assert.ok(state.requests.some(q => q.range === "bytes=100-"));
  assert.equal(fs.readFileSync(dest).equals(A), true);
  assert.equal(fs.existsSync(dest + ".part"), false);
});

test("服务器忽略 Range（返回 200）：回退整段重下", async () => {
  reset();
  state.ignoreRange = true;
  const dest = path.join(DIR, "models", "base", "model.safetensors");
  fs.rmSync(dest);
  fs.writeFileSync(dest + ".part", A.subarray(0, 100));
  await ensureArtifacts(baseOpts());
  assert.equal(fs.readFileSync(dest).equals(A), true);
});

test("302 重定向：跟随并校验最终 URL 白名单", async () => {
  reset();
  state.redirectModel = true;
  fs.rmSync(path.join(DIR, "models", "base", "model.safetensors"));
  await ensureArtifacts(baseOpts());
  assert.ok(state.requests.some(q => q.url === "/real/model.safetensors"));
});

test("sha 不符：拒绝安装、清理 part、错误为 INVALID", async () => {
  reset();
  state.wrongHash = true;
  const destDir = path.join(DIR, "models", "base");
  fs.rmSync(destDir, { recursive: true, force: true });
  await assert.rejects(ensureArtifacts(baseOpts()), /sha256 不符/);
  assert.equal(fs.existsSync(path.join(destDir, "model.safetensors")), false);
  assert.equal(fs.existsSync(path.join(destDir, "model.safetensors.part")), false);
});

test("offline：零网络请求 + 手动安装提示（含 sha/bytes）", async () => {
  reset();
  fs.rmSync(path.join(DIR, "models", "base"), { recursive: true, force: true });
  let fetched = 0;
  const fetchImpl = () => { fetched += 1; throw new Error("不应联网"); };
  await assert.rejects(ensureArtifacts(baseOpts({ offline: true, fetchImpl })), err => {
    assert.equal(toDiagnostic(err).code, DiagnosticCode.MODEL_MISSING);
    assert.match(err.message, /offline/);
    assert.match(err.message, /sha256=/);
    assert.match(err.message, /手动放置/);
    return true;
  });
  assert.equal(fetched, 0);
});

test("白名单/协议：外部域与非 https 被拒", () => {
  assert.throws(() => assertUrlAllowed("https://evil.example/x", { endpoint: "https://huggingface.co" }), /白名单/);
  assert.throws(() => assertUrlAllowed("http://huggingface.co/x", { endpoint: "https://huggingface.co" }), /https/);
  assert.ok(assertUrlAllowed("https://cdn-lfs.huggingface.co/x", { endpoint: "https://huggingface.co" }));
  assert.ok(assertUrlAllowed("https://huggingface.co/x", { endpoint: "https://huggingface.co" }));
  assert.ok(assertUrlAllowed("https://cas-bridge.xethub.hf.co/x", { endpoint: "https://huggingface.co" }), "HF LFS CAS 子域应放行");
  assert.ok(assertUrlAllowed("https://cdn-lfs.hf-mirror.com/x", { endpoint: "https://hf-mirror.com" }), "镜像 CDN 子域应放行");
});

test("体积上限：声明超过 maxBytes 在联网前报错", async () => {
  let fetched = 0;
  const fetchImpl = () => { fetched += 1; return new Response("x"); };
  await assert.rejects(downloadFile({ url: ENDPOINT + "/x", dest: path.join(DIR, "big.bin"), sha256: "a".repeat(64), bytes: 1000, opts: { maxBytes: 100, fetchImpl, endpoint: ENDPOINT, allowInsecure: true } }), /体积上限/);
  assert.equal(fetched, 0);
});

test("derived 进入 needsBuild，不尝试下载", async () => {
  await ensureArtifacts(baseOpts({ ids: ["base-f32"] }));
  reset();
  const r = await ensureArtifacts(baseOpts({ ids: ["base-f32", "derived-x"] }));
  assert.deepEqual(r.needsBuild, ["derived-x"]);
  assert.equal(state.requests.length, 0);
});
test("origin=repo：从包内 models 根复制随包工件（不联网）", async () => {
  const { artifactDir, defaultRegistryPath } = await import("../src/models/registry.js");
  const shippedFile = "pca64/proj.f32";
  const shippedPath = path.join(defaultRegistryPath(), "..", shippedFile);
  if (!fs.existsSync(shippedPath)) return;
  const buf = fs.readFileSync(shippedPath);
  const reg = {
    schemaVersion: 1, modelsRoot: "models", recipes: { "fp16-cast": { builderVer: 1, params: { configPatch: {} } } },
    artifacts: [{ id: "pca64-proj", kind: "source", origin: "repo", target: "pca64", files: [{ path: "proj.f32", sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length }] }],
    models: [], tiers: [], calibration: null
  };
  const { validateRegistry } = await import("../src/models/registry.js");
  const registry = validateRegistry(reg);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-repo-"));
  const r = await ensureArtifacts({ registry, registryFile: path.join(tmp, "registry.json"), ids: ["pca64-proj"], rootDir: tmp });
  assert.deepEqual(r.copied, ["pca64-proj"]);
  assert.equal(fs.existsSync(path.join(tmp, "pca64", "proj.f32")), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
test("下载中断重试：ensureArtifacts 对可重试中断自动重试并完成 sha 校验", async () => {
  const buf = Buffer.from("hello retry");
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const reg = {
    schemaVersion: 1, modelsRoot: "models", recipes: { "fp16-cast": { builderVer: 1, params: { configPatch: {} } } },
    artifacts: [{ id: "retry-a", kind: "source", origin: "hf", repo: "x/y", target: "retry-a", files: [{ path: "f.bin", sha256: sha, bytes: buf.length }] }],
    models: [], tiers: [], calibration: null
  };
  const { validateRegistry } = await import("../src/models/registry.js");
  const registry = validateRegistry(reg);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-retry-"));
  let calls = 0;
  const badBody = () => new Response(new ReadableStream({ start(c) { c.error(new Error("terminated")); } }));
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return badBody();
    return new Response(buf, { status: 200 });
  };
  try {
    const r = await ensureArtifacts({ registry, registryFile: path.join(dir, "registry.json"), ids: ["retry-a"], rootDir: dir, fetchImpl });
    assert.equal(calls, 2, "应重试一次");
    assert.equal(r.downloaded[0], "retry-a");
    assert.equal(fs.existsSync(path.join(dir, "retry-a", "f.bin")), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});