"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROMPT_VERSION, buildPrompt, promptDigest, canonicalStringify } from "../src/judge/prompt.js";
import * as judge from "../src/judge.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-prompt-"));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const skill = n => ({ name: n, description: "desc-" + n, body_core: "## 何时用\n" + n + " 的正文\n\n## 其他\n细节 " + n, body: "## 何时用\n" + n + " 的正文" });
const a = skill("alpha"), b = skill("beta");
const evidence = { jaccard_summary: 0.5, jaccard_body: 0.3, body_cosine: 0.8 };
const cfg = makeConfig({ l0_caution: false, judge_max_chars_per_skill: 400 });

test("版本/摘要：确定性、层级敏感、canonical 键排序", () => {
  assert.equal(PROMPT_VERSION, "judge-prompt-v1");
  const p0 = buildPrompt("L0", a, b, evidence, cfg);
  const d0 = promptDigest("L0", p0);
  assert.match(d0, /^[0-9a-f]{64}$/);
  assert.equal(d0, promptDigest("L0", p0));
  assert.notEqual(d0, promptDigest("L1", buildPrompt("L1", a, b, evidence, cfg)));
  assert.equal(canonicalStringify({ b: 1, a: 2 }), JSON.stringify({ a: 2, b: 1 }));
});

test("正文按 Python 插入序：L0/L1/L2 键序与内容", () => {
  const l0 = JSON.parse(buildPrompt("L0", a, b, evidence, cfg));
  assert.deepEqual(Object.keys(l0), ["level", "skill_a", "skill_b", "scores", "note", "schema"]);
  assert.deepEqual(Object.keys(l0.skill_a), ["id", "name", "description"]);
  assert.equal(l0.note, "仅凭名称与描述判断；若不够判断请回 0，不要猜。");
  const cautious = JSON.parse(buildPrompt("L0", a, b, evidence, makeConfig({ l0_caution: true })));
  assert.match(cautious.note, /谨慎决策/);
  const l1 = JSON.parse(buildPrompt("L1", a, b, evidence, cfg));
  assert.deepEqual(Object.keys(l1.skill_a), ["id", "description", "head"]);
  assert.match(l1.skill_a.head, /alpha/);
  const l2 = JSON.parse(buildPrompt("L2", a, b, evidence, cfg));
  assert.equal(l2.skill_a.body_excerpt.length, Math.min(400, a.body_core.length));
  assert.ok(buildPrompt("L2", a, b, evidence, cfg).includes("body_excerpt"));
});

test("方言开关：默认 LF，--parity-bytes/--io-dialect python 为 CRLF", async () => {
  const byPath = new Map([["alpha", a], ["beta", b]]);
  const pairs = [{ a_path: "alpha", b_path: "beta", jaccard_summary: 0.5, jaccard_body: 0.3 }];
  const dNative = path.join(tmp, "native");
  await judge.judgeCascade(pairs, byPath, makeConfig({ judge: "stub", l0_caution: false, write_prompts: true }), dNative);
  const f0 = fs.readdirSync(dNative)[0];
  const nativeText = fs.readFileSync(path.join(dNative, f0), "utf8");
  assert.equal(nativeText.includes("\r\n"), false);
  assert.ok(nativeText.endsWith("}") || nativeText.endsWith("\n}"), "prompt 应为 JSON  객체");
  const dParity = path.join(tmp, "parity");
  const [rows, stats] = await judge.judgeCascade(pairs, byPath, makeConfig({ judge: "stub", l0_caution: false, parity_bytes: true, write_prompts: true }), dParity);
  const parityText = fs.readFileSync(path.join(dParity, fs.readdirSync(dParity)[0]), "utf8");
  assert.ok(parityText.includes("\r\n"), "parity 模式应为 CRLF");
  assert.equal(parityText.replace(/\r\n/g, "\n"), nativeText.replace(/\r\n/g, "\n"));
  assert.equal(stats.prompt_version, PROMPT_VERSION);
  assert.match(rows[0].prompt_sha, /^[0-9a-f]{64}$/);
  assert.equal(rows[0].trail[rows[0].trail.length - 1].prompt_sha, rows[0].prompt_sha);
});

test("配置：io_dialect/parity_bytes 默认与 CLI", () => {
  const cfg0 = makeConfig();
  assert.equal(cfg0.io_dialect, "native");
  assert.equal(cfg0.parity_bytes, false);
  const r = parseCli(["--corpus", "c", "--out", "o", "--io-dialect", "python", "--parity-bytes"]);
  assert.equal(r.overrides.io_dialect, "python");
  assert.equal(r.overrides.parity_bytes, true);
});