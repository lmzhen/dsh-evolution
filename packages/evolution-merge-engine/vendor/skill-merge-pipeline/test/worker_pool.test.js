import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { poolDecision, poolSize, tableSab, runEncodePool } from "../src/workers/pool.js";
import { StaticTable } from "../src/embed/static_table.js";
import { makeConfig } from "../src/config.js";
import { parseCli } from "../src/cli.js";

const INT8 = process.env.SKILL_MERGE_INT8 || "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const vecKey = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
function texts(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push("技能 " + i + "：当用户要求安装依赖、配置环境或修复构建失败时使用。步骤：读取错误、定位缺失包、执行安装、验证退出码。");
  return out;
}

test("poolDecision：N 与耗时双阈值", () => {
  assert.equal(poolDecision({ n: 499, estimatedMs: 9999 }).use, false);
  assert.equal(poolDecision({ n: 500, estimatedMs: 1499 }).use, false);
  assert.equal(poolDecision({ n: 500, estimatedMs: 1500 }).use, true);
  assert.match(poolDecision({ n: 500, estimatedMs: 1500 }).reason, /≥ 500/);
});

test("poolSize：自动/显式/上限", () => {
  assert.ok(poolSize(0) >= 1);
  assert.equal(poolSize(2), 2);
  assert.ok(poolSize(99) <= poolSize(0) + 99);
});

test("tableSab/runEncodePool：小样本与 inline 逐字节一致", async () => {
  const table = new StaticTable(INT8, { streamMode: "bulk" });
  try {
    const list = texts(12);
    const idsList = table.tok.encodeBatch(list);
    const inline = table._encodeInline(idsList);
    const shared = tableSab(table.view, table.cols, table.rows, table.itemsize, table.scales, table.normalize, table.dtype);
    const pooled = await runEncodePool({ sab: shared.sab, meta: shared.meta, idsList: idsList, workers: 2 });
    assert.equal(pooled.vectors.length, inline.length);
    for (let i = 0; i < inline.length; i += 1) assert.equal(vecKey(pooled.vectors[i]), vecKey(inline[i]), "行 " + i + " 不一致");
  } finally { table.close(); }
});

test("默认 off：fitTransform 走 inline、不启池", async () => {
  const table = new StaticTable(INT8, { streamMode: "bulk" });
  try {
    const [v] = [await table.fitTransform(texts(16))];
    assert.equal(v.length, 16);
    assert.equal(table.lastStats.mode, "inline");
    assert.equal(table.lastStats.pool_used, false);
  } finally { table.close(); }
});

test("force 池：即使未达阈值也可强制，结果与 inline 一致", async () => {
  const off = new StaticTable(INT8, { streamMode: "bulk" });
  const on = new StaticTable(INT8, { streamMode: "bulk", workerPool: "auto", workerPoolForce: true, workerPoolSize: 2, workerPoolMinItems: 1 });
  try {
    const list = texts(16);
    const a = await off.fitTransform(list);
    const b = await on.fitTransform(list);
    assert.equal(on.lastStats.mode, "pool");
    assert.equal(on.lastStats.pool_used, true);
    assert.ok(on.lastStats.workers >= 1);
    for (let i = 0; i < a.length; i += 1) assert.equal(vecKey(b[i]), vecKey(a[i]), "行 " + i + " 不一致");
  } finally { off.close(); on.close(); }
});

test("CLI：--worker-pool auto / --worker-pool-size 解析；默认 off", () => {
  assert.equal(makeConfig().worker_pool, "off");
  const parsed = parseCli(["--corpus", "c", "--out", "o", "--worker-pool", "auto", "--worker-pool-size", "2"]);
  assert.equal(parsed.overrides.worker_pool, "auto");
  assert.equal(parsed.overrides.worker_pool_size, 2);
});