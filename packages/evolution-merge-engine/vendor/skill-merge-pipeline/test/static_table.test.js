"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StaticTable } from "../src/embed/static_table.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";

const MODEL = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const TEXTS = ["hello world", "技能合并", "ab", "中文测试", "release checklist"];
const opened = [];
after(() => { for (const t of opened) { try { t.close(); } catch (e) { /* ignore */ } } for (const t of opened) { try { if (t.fd >= 0) fs.closeSync(t.fd); } catch (e) { /* ignore */ } } });
function maxDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i += 1) for (let j = 0; j < a[i].length; j += 1) { const d = Math.abs(a[i][j] - b[i][j]); if (d > m) m = d; } return m; }

test("stream 模式与 bulk 一致；maxTableBytes 超限自动回退并记 BUDGET", async () => {
  const bulk = new StaticTable(MODEL); opened.push(bulk);
  const bulkVecs = await bulk.fitTransform(TEXTS);
  const stream = new StaticTable(MODEL, { streamMode: "stream" }); opened.push(stream);
  assert.equal(stream.mode, "stream");
  assert.ok(maxDiff(bulkVecs, await stream.fitTransform(TEXTS)) <= 1e-6);
  const budget = new StaticTable(MODEL, { maxTableBytes: 1024 * 1024 }); opened.push(budget);
  assert.equal(budget.mode, "stream");
  assert.equal(budget.warnings[0].code, "BUDGET");
  assert.ok(maxDiff(bulkVecs, await budget.fitTransform(TEXTS)) <= 1e-6);
});

test("tokenizer 单例：同模型目录两实例共享同一 tokenizer", () => {
  const a = new StaticTable(MODEL, { cacheDir: path.join(os.tmpdir(), "dsh-st-cache") }); opened.push(a);
  const b = new StaticTable(MODEL, { cacheDir: path.join(os.tmpdir(), "dsh-st-cache") }); opened.push(b);
  assert.equal(a.tok, b.tok);
});

test("close：幂等、关闭后编码报错、fd 释放", async () => {
  const t = new StaticTable(MODEL, { streamMode: "stream" });
  t.close();
  t.close();
  assert.equal(t.closed, true);
  assert.equal(t.fd, -1);
  await assert.rejects(t.fitTransform(["x"]), /已关闭/);
  const b = new StaticTable(MODEL);
  b.close();
  assert.equal(b.closed, true);
  await assert.rejects(b.fitTransform(["x"]), /已关闭/);
});

test("配置：stream_mode/max_table_mb 默认与 CLI 解析", () => {
  const cfg = makeConfig();
  assert.equal(cfg.stream_mode, "bulk");
  assert.equal(cfg.max_table_mb, 0);
  const r = parseCli(["--corpus", "c", "--out", "o", "--stream-mode", "stream", "--max-table-mb", "64"]);
  assert.equal(r.overrides.stream_mode, "stream");
  assert.equal(r.overrides.max_table_mb, 64);
});