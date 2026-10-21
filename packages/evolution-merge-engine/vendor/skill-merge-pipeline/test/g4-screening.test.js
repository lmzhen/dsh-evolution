"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as screening from "../src/screening/index.js";
import { makeConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "src", "screening");

function skill(name, body) {
  return { name, path: name, description: "d", summary: "s", body, body_core: body };
}

test("G4.1 screening 纯入口导出四阶段函数", () => {
  assert.equal(typeof screening.prefilter, "function");
  assert.equal(typeof screening.generateCandidates, "function");
  assert.equal(typeof screening.lexicalGate, "function");
  assert.equal(typeof screening.semanticSelect, "function");
  assert.equal(typeof screening.nameEntropy, "function");
});

test("G4.1 prefilter：纯 Skill[] 输入，返回 kept/dropped 数据", () => {
  const cfg = makeConfig({ min_name_len: 1, min_name_tokens: 1, min_name_entropy: 0 });
  const [kept, dropped] = screening.prefilter([skill("alpha", "body"), skill("x", "body")], cfg);
  assert.equal(kept.length + dropped.length, 2);
  assert.equal(Array.isArray(kept), true);
  assert.equal(Array.isArray(dropped), true);
});

test("G4.1 screening 源码无 node:fs 直连", () => {
  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    assert.equal(/from "node:fs"|require\(["\x27]fs["\x27]\)/.test(src), false, f + " 不得直连 fs");
  }
});