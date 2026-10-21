"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runModelsCommand } from "../src/models/ensure-cli.js";

test("G3.3 models ensure --dry-run：默认只列必需 artifact", async () => {
  const r = await runModelsCommand(["ensure", "--dry-run", "--json"]);
  assert.equal(r.exitCode, 0);
  const plan = JSON.parse(r.lines.join("\n"));
  assert.ok(plan.plan.length > 0);
  assert.equal(plan.plan.some(x => x.optional), false);
  assert.equal(plan.plan.some(x => x.id === "local:int8-256"), true);
  const p = plan.plan.find(x => x.id === "local:int8-256");
  assert.ok(p.target && p.files.length > 0);
  // derived artifact 由 base 构建，不得伪造下载 URL；只校验内容指纹与构建来源。
  assert.equal(p.kind, "derived");
  assert.equal(p.origin, "derived");
  assert.equal(typeof p.recipe, "string");
  assert.equal(typeof p.base, "string");
  assert.ok(p.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0 && f.url === undefined));
  // 只有 origin=hf 的 source artifact 才带可下载 URL。
  const src = plan.plan.find(x => x.origin === "hf");
  assert.ok(src && src.files.every(f => /^https?:/.test(f.url)));
  const repo = plan.plan.find(x => x.origin === "repo");
  assert.ok(repo && repo.files.every(f => f.url === undefined));
});

test("G3.3 models ensure --include ranker：别名只取 ranker", async () => {
  const r = await runModelsCommand(["ensure", "--include", "ranker", "--dry-run", "--json"]);
  const plan = JSON.parse(r.lines.join("\n"));
  assert.deepEqual(plan.plan.map(x => x.id), ["ranker:startlux-0.8b"]);
  assert.equal(plan.plan[0].optional, true);
});

test("G3.3 models ensure --models-dir：target 落在指定根下", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-g3-models-"));
  const r = await runModelsCommand(["ensure", "--models-dir", root, "--dry-run", "--json"]);
  const plan = JSON.parse(r.lines.join("\n"));
  assert.ok(plan.plan.every(x => x.target.startsWith(root)));
});

test("G3.3 CLI 分发：node src/run.js models ensure --dry-run", () => {
  const run = fileURLToPath(new URL("../src/run.js", import.meta.url));
  const p = spawnSync(process.execPath, [run, "models", "ensure", "--dry-run", "--json"], { encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
  const plan = JSON.parse(p.stdout);
  assert.ok(plan.plan.length > 0);
});

test("G3.3 未知子命令/参数给出 UsageError", async () => {
  await assert.rejects(runModelsCommand(["bogus"]), /未知 models 子命令/);
  await assert.rejects(runModelsCommand(["ensure", "--nope"]), /未知参数/);
  await assert.rejects(runModelsCommand(["ensure", "--include", "no-such-artifact", "--dry-run"]), /未知 artifact/);
  const help = await runModelsCommand(["ensure", "--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join("\n"), /models ensure/);
});