"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(__dirname, "..", "tools", "fetch-models.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-fetch-"));

test("dry-run：列出 ranker 的 URL/sha/bytes 且不联网", () => {
  const q = spawnSync(process.execPath, [TOOL, "--include", "ranker", "--dry-run", "--models-dir", tmp], { encoding: "utf8" });
  assert.equal(q.status, 0, q.stderr);
  assert.match(q.stdout, /resolve\/main\/StartLux-Decision-0\.8B-Q8_0\.gguf/);
  assert.match(q.stdout, /sha256=dd2bcf3c/);
  assert.match(q.stdout, /可选/);
});

test("dry-run --json：体积与目标目录正确", () => {
  const q = spawnSync(process.execPath, [TOOL, "--include", "ranker", "--dry-run", "--json", "--models-dir", tmp], { encoding: "utf8" });
  assert.equal(q.status, 0, q.stderr);
  const rep = JSON.parse(q.stdout);
  assert.equal(rep.plan[0].id, "ranker:startlux-0.8b");
  assert.equal(rep.plan[0].files[0].bytes, 811843200);
  assert.ok(rep.plan[0].target.endsWith(path.join("startlux")));
});

test("未知 artifact → exit 2", () => {
  const q = spawnSync(process.execPath, [TOOL, "--include", "nope", "--dry-run"], { encoding: "utf8" });
  assert.equal(q.status, 2);
});

test("offline 且未下载 → 可操作报错 exit 2", () => {
  const q = spawnSync(process.execPath, [TOOL, "--include", "ranker", "--offline", "--models-dir", tmp], { encoding: "utf8", env: Object.assign({}, process.env, { SKILL_MERGE_MODELS_ROOT: tmp }) });
  assert.equal(q.status, 2, q.stdout + q.stderr);
  assert.match(q.stderr, /MODEL_MISSING|offline|手动放置/);
});