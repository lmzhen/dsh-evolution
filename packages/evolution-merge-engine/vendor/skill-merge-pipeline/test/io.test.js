"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as read from "../src/io/read.js";
import * as write from "../src/io/write.js";
import { toDiagnostic } from "../src/errors.js";
import { findDirectTextIo, LEGACY_TEXT_IO_WHITELIST, isLegacyTextIo } from "../src/arch-rules.js";
import { DiagnosticCode } from "../src/contracts.js";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-io-"));
after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* 清理失败忽略 */ } });
const p = name => path.join(DIR, name);

test("readText：CRLF/CR 归一为 LF、BOM 保留、中文正确", () => {
  fs.writeFileSync(p("crlf.txt"), "a\r\nb\r\nc", "utf8");
  assert.equal(read.readText(p("crlf.txt")), "a\nb\nc");
  fs.writeFileSync(p("cr.txt"), "x\ry", "utf8");
  assert.equal(read.readText(p("cr.txt")), "x\ny");
  fs.writeFileSync(p("bom.txt"), "\uFEFFhello\r\nworld", "utf8");
  assert.equal(read.readText(p("bom.txt")), "\uFEFFhello\nworld");
  fs.writeFileSync(p("zh.txt"), "中文\r\n内容", "utf8");
  assert.equal(read.readText(p("zh.txt")), "中文\n内容");
});

test("readJson 合法/非法，readBinary 原样，exists", () => {
  fs.writeFileSync(p("ok.json"), "{\r\n  \"a\": 1\r\n}", "utf8");
  assert.deepEqual(read.readJson(p("ok.json")), { a: 1 });
  fs.writeFileSync(p("bad.json"), "{oops", "utf8");
  try { read.readJson(p("bad.json")); assert.fail("应抛错"); } catch (e) {
    assert.equal(toDiagnostic(e).code, DiagnosticCode.INVALID);
  }
  const buf = Buffer.from([0, 1, 2, 255]);
  fs.writeFileSync(p("bin.dat"), buf);
  assert.deepEqual(read.readBinary(p("bin.dat")), buf);
  assert.equal(read.exists(p("ok.json")), true);
  assert.equal(read.exists(p("nope.json")), false);
});

test("readText 缺文件 → UNREADABLE", () => {
  try { read.readText(p("missing.txt")); assert.fail("应抛错"); } catch (e) {
    assert.equal(toDiagnostic(e).code, DiagnosticCode.UNREADABLE);
    assert.equal(e.retryable, false);
  }
});

test("atomicWrite：新建/覆盖/嵌套目录/无 tmp 残留", () => {
  write.atomicWrite(p("nested/deep/a.txt"), "one");
  assert.equal(fs.readFileSync(p("nested/deep/a.txt"), "utf8"), "one");
  write.atomicWrite(p("nested/deep/a.txt"), "two");
  assert.equal(fs.readFileSync(p("nested/deep/a.txt"), "utf8"), "two");
  const leftovers = fs.readdirSync(path.join(DIR, "nested", "deep")).filter(f => f.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
});

test("writeText：eol lf/crlf 字节断言，且先归一传入的 CRLF", () => {
  write.writeText(p("lf.txt"), "a\r\nb", { eol: "lf" });
  assert.deepEqual(fs.readFileSync(p("lf.txt")), Buffer.from("a\nb"));
  write.writeText(p("crlf.txt"), "a\nb", { eol: "crlf" });
  assert.deepEqual(fs.readFileSync(p("crlf.txt")), Buffer.from("a\r\nb"));
});

test("writeJson：sortKeys 递归排序 + indent 2", () => {
  write.writeJson(p("sorted.json"), { b: { z: 1, a: 2 }, a: [ { y: 1, x: 2 } ] }, { sortKeys: true });
  const text = fs.readFileSync(p("sorted.json"), "utf8");
  assert.equal(text, JSON.stringify({ a: [ { x: 2, y: 1 } ], b: { a: 2, z: 1 } }, null, 2));
  write.writeJson(p("unsorted.json"), { b: 1, a: 2 });
  assert.match(fs.readFileSync(p("unsorted.json"), "utf8"), /"b": 1[\s\S]*"a": 2/);
});

test("writeCsv：native（全引号+LF）与 python（最小引号+CRLF）差异", () => {
  const spec = { header: ["a", "b"], rows: [["x", "has,comma"], ["q", "he said \"hi\""]] };
  write.writeCsv(p("native.csv"), Object.assign({ dialect: "native" }, spec));
  write.writeCsv(p("python.csv"), Object.assign({ dialect: "python" }, spec));
  const native = fs.readFileSync(p("native.csv"), "utf8");
  const py = fs.readFileSync(p("python.csv"), "utf8");
  assert.match(native, /^"a","b"\n/);
  assert.match(py, /^a,b\r\n/);
  assert.match(native, /"has,comma"/);
  assert.match(py, /"has,comma"/);
  assert.match(py, /"he said ""hi"""/);
  assert.equal(native.includes("\r"), false);
});

test("resolveDialect 映射正确", () => {
  assert.deepEqual(write.resolveDialect("python"), { eol: "crlf", sortKeys: true, csvDialect: "python" });
  assert.deepEqual(write.resolveDialect("native"), { eol: "lf", sortKeys: false, csvDialect: "native" });
});

test("ARCH：直连文本 IO 可扫描，白名单含已知模块", () => {
  const src = "const a = fs.readFileSync(p, \"utf8\");" + String.fromCharCode(10) + "fs.writeFileSync(q, s, \"utf8\");";
  assert.equal(findDirectTextIo(src).length, 2);
  assert.equal(isLegacyTextIo("src/corpus.js"), false);
  assert.equal(isLegacyTextIo("src/io/read.js"), false);
  assert.equal(LEGACY_TEXT_IO_WHITELIST.length, 0, "G6.4：白名单应已清零");
});