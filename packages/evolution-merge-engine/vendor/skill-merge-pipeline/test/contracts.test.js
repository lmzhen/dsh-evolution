"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_VERSION, ExitCode, DiagnosticCode, ReasonCode } from "../src/contracts.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("契约版本已冻结", () => {
  assert.equal(CONTRACT_VERSION, "v1");
});

test("退出码语义固定为 0/1/2", () => {
  assert.deepEqual({ ...ExitCode }, { OK: 0, RUNTIME: 1, USAGE: 2 });
});

test("diagnostic 枚举覆盖契约 C3", () => {
  for (const k of ["USAGE", "CONFIG", "MODEL_MISSING", "UNREADABLE", "INVALID", "UNAVAILABLE", "BUDGET", "PARTIAL", "ALL_DOWN"]) {
    assert.equal(typeof DiagnosticCode[k], "string", "缺少 " + k);
  }
});

test("reasonCode 覆盖契约 C6", () => {
  for (const k of ["NO_KEY", "HTTP_ERROR", "TIMEOUT", "INVALID_RESPONSE", "ALL_DOWN", "PARTIAL_FILL", "UNKNOWN"]) {
    assert.equal(typeof ReasonCode[k], "string", "缺少 " + k);
  }
});

test("契约文档包含 C1–C8", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "contracts.md"), "utf8");
  for (let i = 1; i <= 8; i += 1) assert.match(doc, new RegExp("## C" + i + " "), "缺 C" + i);
});

test("契约文档含冻结版本与变更流程", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "contracts.md"), "utf8");
  assert.match(doc, /版本 \| v1/);
  assert.match(doc, /## 0\. 元信息/);
});