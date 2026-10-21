// G7.4 大库基准：600 技能文本，单线程 vs SAB worker 池；逐字节一致 + 耗时可复现。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { StaticTable } from "../../src/embed/static_table.js";
import { tableSab, runEncodePool, poolSize } from "../../src/workers/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INT8 = process.env.SKILL_MERGE_INT8 || "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const FIX = path.join(__dirname, "..", "fixtures", "corpus");
const N = Number(process.env.BENCH_N || 600);

function collectSkillBodies() {
  const out = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "SKILL.md") out.push(fs.readFileSync(p, "utf8"));
    }
  }
  walk(FIX);
  return out.sort();
}

const bodies = collectSkillBodies();
function makeTexts(longRepeat) {
  const out = [];
  for (let i = 0; i < N; i += 1) {
    const base = bodies[i % bodies.length];
    const body = longRepeat ? base.slice(0, Math.min(base.length, 4000)).repeat(3) : base.slice(0, Math.min(base.length, 800));
    out.push("变体 " + i + "：" + String.fromCharCode(10) + body);
  }
  return out;
}
const texts = makeTexts(false);
const longTexts = makeTexts(true);

function vecHash(vectors) {
  const h = crypto.createHash("sha256");
  for (const v of vectors) h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  return h.digest("hex").slice(0, 16);
}

async function run(label, opts) {
  const table = new StaticTable(INT8, opts);
  try {
    const t = performance.now();
    const vectors = await table.fitTransform(opts.forceLong ? longTexts : texts);
    const wall = performance.now() - t;
    const st = table.lastStats;
    return { label: label, vectors: vectors, wall: Math.round(wall), stats: st, rss: Math.round(process.memoryUsage().rss / 1048576) };
  } finally { table.close(); }
}

(async () => {
  const inline = await run("inline", { streamMode: "bulk" });
  const pooled = await run("pool-auto", { streamMode: "bulk", workerPool: "auto" });
  const forced = await run("pool-force", { streamMode: "bulk", workerPool: "auto", workerPoolForce: true });
  const longInline = await run("long-inline", { streamMode: "bulk", forceLong: true });
  const longPool = await run("long-pool", { streamMode: "bulk", forceLong: true, workerPool: "auto", workerPoolMinMs: 150 });
  const pooled2 = await run("pool-auto-2", { streamMode: "bulk", workerPool: "auto" });
  const h = vecHash(inline.vectors);
  const same = vecHash(pooled.vectors) === h && vecHash(pooled2.vectors) === h;
  const hLong = vecHash(longInline.vectors);
  const sameLong = vecHash(longPool.vectors) === hLong;
  const sameForce = vecHash(forced.vectors) === h;
  console.log("N=" + N + " | inline wall=" + inline.wall + "ms mode=" + inline.stats.mode + " tokenize=" + inline.stats.tokenize_ms + "ms encode=" + inline.stats.encode_ms + "ms");
  console.log("pool   wall=" + pooled.wall + "ms mode=" + pooled.stats.mode + " workers=" + pooled.stats.workers + " est=" + pooled.stats.est_ms + "ms encode=" + pooled.stats.encode_ms + "ms reason=" + String(pooled.stats.reason));
  console.log("pool2  wall=" + pooled2.wall + "ms workers=" + pooled2.stats.workers + "（复现运行）");
  console.log("向量 sha=" + h + " | 池与单线程逐字节一致=" + same);
  console.log("RSS 主进程 inline=" + inline.rss + "MB pool=" + pooled.rss + "MB");
  console.log("force  wall=" + forced.wall + "ms mode=" + forced.stats.mode + " workers=" + forced.stats.workers + " 逐字节一致=" + sameForce);
  console.log("长文本 inline wall=" + longInline.wall + "ms mode=" + longInline.stats.mode + " tokenize=" + longInline.stats.tokenize_ms + "ms encode=" + longInline.stats.encode_ms + "ms");
  console.log("长文本 pool(阈值150ms 自然触发) wall=" + longPool.wall + "ms mode=" + longPool.stats.mode + " workers=" + longPool.stats.workers + " est=" + longPool.stats.est_ms + "ms encode=" + longPool.stats.encode_ms + "ms reason=" + String(longPool.stats.reason));
  console.log("长文本 sha=" + hLong + " | 池与单线程逐字节一致=" + sameLong);
  // 纯 ④ 表编码对照（预 tokenize 一次，仅比较被池并行的那段）
  const pure = new StaticTable(INT8, { streamMode: "bulk" });
  let pureSame = false;
  try {
    const idsList = pure.tok.encodeBatch(longTexts);
    const t1 = performance.now();
    const v1 = pure._encodeInline(idsList);
    const ms1 = Math.round(performance.now() - t1);
    const shared = tableSab(pure.view, pure.cols, pure.rows, pure.itemsize, pure.scales, pure.normalize, pure.dtype);
    const t2 = performance.now();
    const v2 = (await runEncodePool({ sab: shared.sab, meta: shared.meta, idsList: idsList, workers: poolSize(0) })).vectors;
    const ms2 = Math.round(performance.now() - t2);
    pureSame = vecHash(v1) === vecHash(v2);
    const bigIds = [];
    for (let rep = 0; rep < 12; rep += 1) for (const ids of idsList) bigIds.push(ids);
    const t3 = performance.now();
    const v3 = pure._encodeInline(bigIds);
    const ms3 = Math.round(performance.now() - t3);
    const t4 = performance.now();
    const v4 = (await runEncodePool({ sab: shared.sab, meta: shared.meta, idsList: bigIds, workers: poolSize(0) })).vectors;
    const ms4 = Math.round(performance.now() - t4);
    const bigSame = vecHash(v3) === vecHash(v4);
    console.log("阈值规模编码 N=" + bigIds.length + "：inline=" + ms3 + "ms pool=" + ms4 + "ms 加速=" + (ms3 / Math.max(1, ms4)).toFixed(2) + "x 逐字节一致=" + bigSame);
    pureSame = pureSame && bigSame;
    console.log("纯编码 N=" + idsList.length + "：inline=" + ms1 + "ms pool=" + ms2 + "ms workers=2..4 加速=" + (ms1 / Math.max(1, ms2)).toFixed(2) + "x 逐字节一致=" + pureSame);
  } finally { pure.close(); }
  if (!same || !sameLong || !sameForce || !pureSame) { console.error("FAIL: 池结果与单线程不一致"); process.exitCode = 1; }
})();