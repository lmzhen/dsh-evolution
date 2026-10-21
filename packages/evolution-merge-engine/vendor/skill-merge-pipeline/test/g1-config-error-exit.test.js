"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_FIELDS, CLI_OPTIONS, DEFAULTS, FIELD_BY_KEY } from "../src/config/schema.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";
import { UsageError, ConfigError, toDiagnostic, exitCodeOf, formatError } from "../src/errors.js";
import { DiagnosticCode, ExitCode } from "../src/contracts.js";
import { findEmptyCatches } from "../src/arch-rules.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("C1 字段表唯一、类型合法、默认值符合类型", () => {
  const keys = new Set();
  for (const f of CONFIG_FIELDS) {
    assert.ok(!keys.has(f.key), "重复字段: " + f.key);
    keys.add(f.key);
    assert.ok(["string", "int", "float", "bool", "enum", "json"].includes(f.type), "非法类型: " + f.key);
    assert.ok(typeof f.doc === "string" && f.doc.length > 0, "缺 doc: " + f.key);
    if (f.type === "enum") { assert.ok(Array.isArray(f.choices) && f.choices.includes(f.default), "enum 默认值非法: " + f.key); }
    if (f.type === "int") assert.ok(Number.isInteger(f.default), "int 默认值非法: " + f.key);
    if (f.type === "float") assert.ok(Number.isFinite(f.default), "float 默认值非法: " + f.key);
    if (f.type === "bool") assert.equal(typeof f.default, "boolean", "bool 默认值非法: " + f.key);
  }
  assert.equal(Object.keys(DEFAULTS).length, CONFIG_FIELDS.length);
});

test("C1 CLI_OPTIONS 只映射已知字段且 flag 唯一", () => {
  const flags = new Set();
  for (const o of CLI_OPTIONS) {
    assert.ok(!flags.has(o.flag), "重复 flag: " + o.flag);
    flags.add(o.flag);
    if (o.cfgKey) assert.ok(FIELD_BY_KEY.has(o.cfgKey), "未知 cfgKey: " + o.cfgKey);
  }
});

test("C1 makeConfig 拒绝未声明 key，合法覆盖不污染 DEFAULTS", () => {
  const cfg = makeConfig({ judge: "deepseek" });
  assert.equal(cfg.judge, "deepseek");
  assert.equal(DEFAULTS.judge, "stub");
  assert.throws(() => makeConfig({ notAField: 1 }), (e) => e instanceof ConfigError && exitCodeOf(e) === ExitCode.USAGE);
});

test("C1 CLI 非法参数走 UsageError/exit 2", () => {
  for (const argv of [
    ["--corpus", "c", "--out", "o", "--judge", "bogus"],
    ["--corpus", "c", "--out", "o", "--rounds", "abc"],
    ["--corpus", "c", "--out", "o", "--unknown"],
  ]) {
    assert.throws(() => parseCli(argv), (e) => e instanceof UsageError && exitCodeOf(e) === ExitCode.USAGE);
  }
});

test("C3 Diagnostic 恒四键；退出码映射正确", () => {
  const d = toDiagnostic(new Error("boom"), { where: "stage" });
  assert.deepEqual(Object.keys(d), ["code", "where", "detail", "retryable"]);
  assert.equal(d.code, DiagnosticCode.INTERNAL);
  assert.equal(exitCodeOf(new Error("x")), ExitCode.RUNTIME);
  assert.equal(exitCodeOf(new UsageError("x")), ExitCode.USAGE);
  assert.equal(exitCodeOf(new ConfigError("x")), ExitCode.USAGE);
});

test("C3 formatError 不含栈，MODEL_MISSING 提示指向真实入口", () => {
  const s = formatError(new ConfigError("missing model", { code: DiagnosticCode.MODEL_MISSING }));
  assert.match(s, /\[MODEL_MISSING\]/);
  assert.equal(s.includes("npm run fetch-models"), false);
  assert.match(s, /skill-merge models ensure/);
  assert.equal(s.includes(" at "), false);
});

test("C1 ARCH 契约：src 中无空 catch", () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".js")) files.push(p);
    }
  };
  walk(path.join(__dirname, "..", "src"));
  const bad = files.flatMap(f => findEmptyCatches(fs.readFileSync(f, "utf8")).map(x => f + ":" + x));
  assert.deepEqual(bad, []);
});