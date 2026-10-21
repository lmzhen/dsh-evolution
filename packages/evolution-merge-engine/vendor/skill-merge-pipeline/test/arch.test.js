"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findEmptyCatches, findDirectTextIo, findForbiddenPluginImports, findAbsolutePathLiterals } from "../src/arch-rules.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.join(__dirname, "..", "src");
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const FILES = walk(SRC, []);
const rel = f => path.relative(SRC, f).split(path.sep).join("/");
const base = f => path.basename(f);
const read = f => fs.readFileSync(f, "utf8");

// R1 空 catch 白名单（随 G3/G6 收缩到 0）
const EMPTY_CATCH_ALLOWED = {};

test("ARCH R1：空 catch 不超白名单且无新增来源", () => {
  const seen = {};
  for (const f of FILES) { const n = findEmptyCatches(read(f)).length; if (n) seen[base(f)] = n; }
  for (const [k, v] of Object.entries(seen)) assert.ok((EMPTY_CATCH_ALLOWED[k] || 0) >= v, "空 catch 超限: " + k + "=" + v);
  for (const k of Object.keys(seen)) assert.ok(Object.prototype.hasOwnProperty.call(EMPTY_CATCH_ALLOWED, k), "新增空 catch 来源: " + k);
});

// R2 直连文本 IO：io/ 层是唯一合法实现层，其余按白名单（随各组迁移收缩，G6 清零）
const TEXT_IO_WHITELIST = Object.freeze([]);

test("ARCH R2：直连文本 IO 只在 io/ 与白名单模块", () => {
  const bad = [];
  for (const f of FILES) {
    const r = rel(f);
    if (r.startsWith("io/")) continue;
    if (findDirectTextIo(read(f)).length && !TEXT_IO_WHITELIST.includes(base(f))) bad.push(r);
  }
  assert.deepEqual(bad, [], "白名单外的直连文本 IO: " + bad.join(", "));
});

// R3 process.exit 只允许入口
const EXIT_ALLOWED = Object.freeze(["run.js", "cli.js"]);

test("ARCH R3：process.exit 仅在入口", () => {
  const bad = FILES.filter(f => /process\.exit\s*\(/.test(read(f)) && !EXIT_ALLOWED.includes(base(f))).map(rel);
  assert.deepEqual(bad, []);
});

// R4 双份实现符号：同一符号只允许一个属主文件（G3/G6 收缩后删除）
const SYMBOL_OWNERS = Object.freeze({
  "class PyRandom": ["pyrandom.js"],
  "const DEFAULTS =": ["schema.js"],
  "function roundHalfEven": ["numeric.js"],
  "function buildTrie": ["trie.js"],
  "function tokenizeWithTrie": ["trie.js"],
  "const HF_HOSTS": ["provision.js"]
});

test("ARCH R4：关键符号不出现第二份实现", () => {
  for (const [sym, owners] of Object.entries(SYMBOL_OWNERS)) {
    const hits = FILES.filter(f => read(f).includes(sym)).map(rel);
    const illegal = hits.filter(h => !owners.includes(base(h)));
    assert.deepEqual(illegal, [], "符号 " + sym + " 出现在非法文件: " + illegal.join(", "));
  }
});

// R6 bench/探测脚本不得内联实现副本（只能 import src）
const PARITY_DEV = path.join(__dirname, "..", "parity", "dev");
const INLINE_IMPL_RE = /function\s+(buildTrie|trieEncode|encodeBatchFast|rowEncode)\s*\(/;

test("ARCH R6：parity/dev 无内联实现副本", () => {
  const bad = [];
  for (const f of fs.readdirSync(PARITY_DEV)) {
    if (!f.endsWith(".js")) continue;
    const p = path.join(PARITY_DEV, f);
    if (INLINE_IMPL_RE.test(fs.readFileSync(p, "utf8"))) bad.push(f);
  }
  assert.deepEqual(bad, [], "内联实现副本: " + bad.join(", "));
});

// R5 src 不得依赖 parity（运行时数据在 src/data）
test("ARCH R5：src 不引用 parity", () => {
  const bad = FILES.filter(f => /parity[\/\\]/.test(read(f))).map(rel);
  assert.deepEqual(bad, []);
});
// G8.3 R7：src 必须全 ESM（禁 require/module.exports）
test("ARCH R7：src 无 CJS 残留（require/module.exports）", () => {
  const bad = FILES.filter(f => /\brequire\(|module\.exports/.test(read(f))).map(rel);
  assert.deepEqual(bad, [], "存在 CJS 残留: " + bad.join(", "));
});

// G8.3 R8：旧实现/垫片文件不得复活
const LEGACY_FILES = Object.freeze(["src/stream_static.js", "src/embed_remote.js", "src/rerank.js", "src/show_stage4.js"]);
test("ARCH R8：旧实现文件已删除（无垫片复活）", () => {
  const present = LEGACY_FILES.filter(p => fs.existsSync(path.join(__dirname, "..", p)));
  assert.deepEqual(present, [], "旧实现文件复活: " + present.join(", "));
});

// G8.3 R9：fs 直连仅在 io/（单一 IO 层）
test("ARCH R9：src 非 io 模块不得直连 node:fs", () => {
  const bad = FILES.filter(f => {
    const r = rel(f);
    if (r.startsWith("io/")) return false;
    return /from\s+"node:fs"|import\s+fs\s+from\s+"fs"/.test(read(f));
  }).map(rel);
  assert.deepEqual(bad, [], "非 io 模块直连 fs: " + bad.join(", "));
});
// G8.1 R10：core 不得 import plugin；plugin 目录自身除外（未实现时规则先冻结）
test("ARCH R10：core 禁 plugin import", () => {
  const bad = FILES.filter(f => {
    const r = rel(f);
    if (r.startsWith("plugin/")) return false;
    return findForbiddenPluginImports(read(f)).length > 0;
  }).map(rel);
  assert.deepEqual(bad, [], "core import plugin: " + bad.join(", "));
  assert.ok(findForbiddenPluginImports('import x from "../plugin/index.js";').length === 1, "规则对违规样本不可红");
});

// G8.1 R11：src 不得出现作者机绝对路径字面量
test("ARCH R11：src 无绝对路径字面量", () => {
  const bad = [];
  for (const f of FILES) {
    const hits = findAbsolutePathLiterals(read(f));
    if (hits.length) bad.push(rel(f) + ":" + hits[0].snippet);
  }
  assert.deepEqual(bad, [], "src 含绝对路径: " + bad.join(", "));
  assert.ok(findAbsolutePathLiterals('const p = "D:/dsh/models";').length === 1, "规则对违规样本不可红");
});