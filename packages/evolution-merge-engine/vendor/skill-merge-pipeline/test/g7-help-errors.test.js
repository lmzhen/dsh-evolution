"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AppError, formatError, HINTS } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";

test("G7.2 每个 DiagnosticCode 都是两行且含下一步", () => {
  for (const code of Object.values(DiagnosticCode)) {
    const s = formatError(new AppError("x", { code }));
    const lines = s.split("\n");
    assert.equal(lines.length, 2, code + " 不是两行: " + JSON.stringify(s));
    assert.match(lines[0], new RegExp("\\[" + code + "\\]"));
    assert.match(lines[1], /^下一步：/);
    assert.equal(/[A-Za-z]:[\\/]|^\//.test(s), false, code + " 含绝对路径");
    assert.ok(HINTS[code]);
  }
});

test("G7.2 CLI --debug：错误出现 stack，普通模式不出现", () => {
  const run = path.join(import.meta.dirname, "..", "src", "run.js");
  const args = ["--corpus", "c", "--out", "o", "--judge", "bogus"];
  const plain = spawnSync(process.execPath, [run].concat(args), { encoding: "utf8" });
  assert.equal(plain.status, 2);
  assert.match(plain.stderr, /下一步：/);
  assert.equal(/\n\s+at /.test(plain.stderr), false);
  const dbg = spawnSync(process.execPath, [run].concat(args, ["--debug"]), { encoding: "utf8" });
  assert.equal(dbg.status, 2);
  assert.match(dbg.stderr, /\n\s+at /);
});