"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Tokenizer } from "../src/text/tokenizer.js";
import * as artifact from "../src/text/artifact.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8/tokenizer.json";
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "parity", "golden", "ref_tokenizer.json"), "utf8"));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-art-"));
after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const CACHE_A = path.join(DIR, "cacheA");
const CACHE_B = path.join(DIR, "cacheB");
function idsEqual(tk) { return REF.every(r => JSON.stringify(tk.encode(r.text)) === JSON.stringify(r.ids)); }

test("冷启动生成派生物，热启动命中且结果一致", () => {
  const cold = new Tokenizer(MODEL, { cacheDir: CACHE_A });
  const files = fs.readdirSync(CACHE_A).filter(f => f.endsWith(".bin"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^tok-[0-9a-f]{64}-v1\.bin$/);
  assert.equal(cold.info().artifact, null);
  assert.equal(idsEqual(cold), true);
  const t0 = performance.now();
  const warm = new Tokenizer(MODEL, { cacheDir: CACHE_A });
  const loadMs = performance.now() - t0;
  assert.equal(warm.info().artifact, path.join(CACHE_A, files[0]));
  assert.equal(idsEqual(warm), true);
  assert.ok(loadMs < 500, "热加载过慢: " + Math.round(loadMs) + "ms");
});

test("无缓存开关：不读不写缓存，结果一致", () => {
  const tk = new Tokenizer(MODEL, { cache: false, cacheDir: CACHE_B });
  assert.equal(fs.existsSync(CACHE_B), false);
  assert.equal(idsEqual(tk), true);
});

test("派生物损坏/截断：自动重建且结果正确", () => {
  const dir = path.join(DIR, "cacheC");
  const first = new Tokenizer(MODEL, { cacheDir: dir });
  const file = first.info() ? artifact.artifactPath(dir, first.tokenizerSha, 1) : null;
  fs.truncateSync(file, 100);
  const second = new Tokenizer(MODEL, { cacheDir: dir });
  assert.equal(idsEqual(second), true);
  assert.ok(fs.statSync(file).size > 1000000, "重建后的派生物过小");
});

test("sha 不符的派生物不会被误用", () => {
  const dir = path.join(DIR, "cacheD");
  const tk = new Tokenizer(MODEL, { cacheDir: dir });
  const good = artifact.artifactPath(dir, tk.tokenizerSha, 1);
  const stale = artifact.artifactPath(dir, "deadbeef".repeat(8), 1);
  fs.copyFileSync(good, stale);
  const again = new Tokenizer(MODEL, { cacheDir: dir });
  assert.equal(idsEqual(again), true);
  assert.ok(fs.existsSync(stale), "不应删除他键派生物");
});

test("删除派生物即重建", () => {
  const dir = path.join(DIR, "cacheE");
  const tk1 = new Tokenizer(MODEL, { cacheDir: dir });
  const file = artifact.artifactPath(dir, tk1.tokenizerSha, 1);
  fs.rmSync(file);
  const tk2 = new Tokenizer(MODEL, { cacheDir: dir });
  assert.equal(idsEqual(tk2), true);
  assert.ok(fs.existsSync(file));
});