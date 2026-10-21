"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as judge from "../src/judge.js";
import { cacheKey, VerdictCache } from "../src/judge/cache.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-vcache-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const skill = n => ({ name: n, description: "d" + n, body_core: "## 何时用\n" + n, body: "## 何时用\n" + n });
const byPath = new Map([["a", skill("a")], ["b", skill("b")]]);
const pair = (summary, body) => ({ a_path: "a", b_path: "b", jaccard_summary: 0.1, jaccard_body: 0.2, body_core_cosine: body, summary_cosine: summary });
const PAIRS = [pair(0.5, 0.96), pair(0.5, 0.95)];
function makeRunner() {
  const st = { calls: 0 };
  st.run = async () => { st.calls += 1; return JSON.stringify({ verdict: 1, reason: "r", evidence: [] }); };
  return st;
}
const baseCfg = (extra) => makeConfig(Object.assign({ judge: "stub", l0_caution: false }, extra || {}));

test("默认关：不建缓存文件、runner 每次调用、两次运行结果一致", async () => {
  const r = makeRunner();
  const c1 = baseCfg();
  const [rows1, st1] = await judge.judgeCascade(PAIRS, byPath, c1, path.join(tmp, "off1"), r.run);
  const [rows2, st2] = await judge.judgeCascade(PAIRS, byPath, baseCfg(), path.join(tmp, "off2"), r.run);
  assert.equal(st1.cache.enabled, false);
  assert.equal(st2.cache.enabled, false);
  assert.equal(r.calls, 8);
  assert.deepEqual(rows1.map(x => x.verdict_id), rows2.map(x => x.verdict_id));
  assert.equal(fs.existsSync(path.join(tmp, "off1", "judge_cache.json")), false);
});

test("开启：首跑 misses=N、次跑 0 调用且 hits=N，结果一致", async () => {
  const cachePath = path.join(tmp, "cache1.json");
  const r = makeRunner();
  const [rows1, st1] = await judge.judgeCascade(PAIRS, byPath, baseCfg({ judge_cache: true, judge_cache_path: cachePath }), path.join(tmp, "on1"), r.run);
  assert.equal(r.calls, 4);
  assert.deepEqual(st1.cache, { enabled: true, hits: 0, misses: 4, size: 4 });
  const [rows2, st2] = await judge.judgeCascade(PAIRS, byPath, baseCfg({ judge_cache: true, judge_cache_path: cachePath }), path.join(tmp, "on2"), r.run);
  assert.equal(r.calls, 4, "次跑不得再调用模型");
  assert.deepEqual(st2.cache, { enabled: true, hits: 4, misses: 0, size: 4 });
  assert.deepEqual(rows2.map(x => x.verdict_id), rows1.map(x => x.verdict_id));
  const doc = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(doc.version, 1);
  assert.equal(Object.keys(doc.entries).length, 4);
});

test("键敏感：换 model 或换 prompt 都 miss", async () => {
  const cachePath = path.join(tmp, "cache2.json");
  const r = makeRunner();
  const cfg = () => baseCfg({ judge_cache: true, judge_cache_path: cachePath });
  await judge.judgeCascade(PAIRS, byPath, cfg(), path.join(tmp, "k1"), r.run);
  const calls1 = r.calls;
  const [, stModel] = await judge.judgeCascade(PAIRS, byPath, baseCfg({ judge_cache: true, judge_cache_path: cachePath, judge_model: "deepseek-chat" }), path.join(tmp, "k2"), r.run);
  assert.equal(stModel.cache.hits, 0);
  assert.equal(r.calls, calls1 + 4);
  const calls2 = r.calls;
  const changed = [pair(0.5, 0.97), pair(0.5, 0.98)];
  const [, stPrompt] = await judge.judgeCascade(changed, byPath, cfg(), path.join(tmp, "k3"), r.run);
  assert.equal(stPrompt.cache.hits, 0);
  assert.equal(r.calls, calls2 + 4);
});

test("损坏缓存按空处理并重写；stub 路径不写缓存", async () => {
  const bad = path.join(tmp, "bad.json");
  fs.writeFileSync(bad, "{not-json");
  const r = makeRunner();
  const [, st] = await judge.judgeCascade(PAIRS, byPath, baseCfg({ judge_cache: true, judge_cache_path: bad }), path.join(tmp, "bad1"), r.run);
  assert.equal(st.cache.misses, 4);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(bad, "utf8")));
  const stubCache = path.join(tmp, "stub-cache.json");
  const [, stStub] = await judge.judgeCascade(PAIRS, byPath, baseCfg({ judge_cache: true, judge_cache_path: stubCache }), path.join(tmp, "stub1"));
  assert.equal(stStub.cache.enabled, true);
  assert.equal(stStub.cache.hits, 0);
  assert.equal(fs.existsSync(stubCache), false);
});

test("默认路径：<promptDir>/judge_cache.json", async () => {
  const dir = path.join(tmp, "default-dir");
  const r = makeRunner();
  await judge.judgeCascade(PAIRS, byPath, baseCfg({ judge_cache: true }), dir, r.run);
  assert.equal(fs.existsSync(path.join(dir, "judge_cache.json")), true);
});

test("cacheKey 确定性与 CLI 开关", () => {
  assert.equal(cacheKey("a", "m", { effort: "off" }), cacheKey("a", "m", { effort: "off" }));
  assert.notEqual(cacheKey("a", "m", { effort: "off" }), cacheKey("a", "m2", { effort: "off" }));
  const k = cacheKey("a", "m", {});
  const vc = new VerdictCache("");
  vc.put(k, { verdict: 1, reason: "x" });
  assert.equal(vc.get(k).cached, true);
  assert.equal(vc.get("nope"), null);
  const parsed = parseCli(["--corpus", "c", "--out", "o", "--judge-cache"]);
  assert.equal(parsed.overrides.judge_cache, true);
});