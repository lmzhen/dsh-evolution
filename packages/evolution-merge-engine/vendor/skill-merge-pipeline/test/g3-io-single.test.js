"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readText, readJson } from "../src/io/read.js";
import { writeText, writeJson, writeCsv, resolveDialect, atomicWrite } from "../src/io/write.js";
import { writeFileBytes, ensureDir } from "../src/io/bytes.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g3-io-"));

test("G3.1 readText：CRLF/CR→LF，不剥 BOM", () => {
  const p = path.join(tmp, "crlf.txt");
  fs.writeFileSync(p, "\ufeffa\r\nb\rc\n");
  assert.equal(readText(p), "\ufeffa\nb\nc\n");
});

test("G3.1 writeText/atomicWrite：自动建目录且原子落盘", () => {
  const p = path.join(tmp, "nested", "a.txt");
  writeText(p, "x\r\ny", { eol: "crlf" });
  assert.equal(fs.readFileSync(p, "utf8"), "x\r\ny");
  atomicWrite(path.join(tmp, "nested", "b.json"), "{\"a\":1}");
  assert.equal(fs.readFileSync(path.join(tmp, "nested", "b.json"), "utf8"), "{\"a\":1}");
  assert.deepEqual(fs.readdirSync(path.join(tmp, "nested")).sort(), ["a.txt", "b.json"]);
});

test("G3.1 writeFileBytes：父目录 + 二进制内容 + 无 tmp 残留", () => {
  const p = path.join(tmp, "bin", "model.bin");
  writeFileBytes(p, Buffer.from([1, 2, 3]));
  assert.deepEqual([...fs.readFileSync(p)], [1, 2, 3]);
  assert.deepEqual(fs.readdirSync(path.join(tmp, "bin")), ["model.bin"]);
});

test("G3.1 方言只由 resolveDialect 决定", () => {
  assert.deepEqual(resolveDialect("python"), { eol: "crlf", sortKeys: true, csvDialect: "python" });
  assert.deepEqual(resolveDialect("native"), { eol: "lf", sortKeys: false, csvDialect: "native" });
  const p = path.join(tmp, "x.csv");
  writeCsv(p, { header: ["a", "b"], rows: [["x", "y"]], dialect: "native" });
  assert.equal(fs.readFileSync(p, "utf8"), "\"a\",\"b\"\n\"x\",\"y\"\n");
});

test("G3.1 单一 writer：write.js 不再本地实现 ensureDir", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "io", "write.js"), "utf8");
  assert.equal(src.includes("function ensureDir"), false);
  assert.match(src, /from "\.\/bytes\.js"/);
});