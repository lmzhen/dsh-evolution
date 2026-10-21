"use strict";
// ARCH 判据草稿（C3/C4）：空 catch、process.exit 位置、catch 必须记录或重抛的可扫描形态。
const EMPTY_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const PROCESS_EXIT_RE = /process\.exit\s*\(/g;

function findEmptyCatches(source) {
  const out = [];
  let m;
  EMPTY_CATCH_RE.lastIndex = 0;
  while ((m = EMPTY_CATCH_RE.exec(source)) !== null) out.push({ index: m.index, snippet: m[0] });
  return out;
}

function findProcessExit(source) {
  const out = [];
  let m;
  PROCESS_EXIT_RE.lastIndex = 0;
  while ((m = PROCESS_EXIT_RE.exec(source)) !== null) out.push({ index: m.index });
  return out;
}

// 顶层只允许 cli.js 使用 process.exit；其余模块必须抛 AppError 家族
const PROCESS_EXIT_ALLOWED = ["src/cli.js"];
function allowsProcessExit(file) { return PROCESS_EXIT_ALLOWED.includes(file); }

const DIRECT_TEXT_IO_RE = /(readFileSync|writeFileSync|appendFileSync)\s*\(/g;

function findDirectTextIo(source) {
  const out = [];
  let m;
  DIRECT_TEXT_IO_RE.lastIndex = 0;
  while ((m = DIRECT_TEXT_IO_RE.exec(source)) !== null) out.push({ index: m.index, call: m[1] });
  return out;
}

// G6.4：直连文本 IO 白名单已清零（io/ 是唯一实现层）。
const LEGACY_TEXT_IO_WHITELIST = Object.freeze([]);
function isLegacyTextIo(file) {
  const base = String(file).split(/[\\/]/).pop();
  return LEGACY_TEXT_IO_WHITELIST.includes(base);
}

const PLUGIN_IMPORT_RE = /from\s+["'][^"']*\bplugin(?:\/|["'])/g;
function findForbiddenPluginImports(source) {
  const out = [];
  let m;
  PLUGIN_IMPORT_RE.lastIndex = 0;
  while ((m = PLUGIN_IMPORT_RE.exec(source)) !== null) out.push({ index: m.index, snippet: m[0] });
  return out;
}

const ABS_PATH_LITERAL_RE = /["'](?:[A-Za-z]:[\\/]|\/(?:Users|home|root)\/)[^"']*["']/g;
function findAbsolutePathLiterals(source) {
  const out = [];
  let m;
  ABS_PATH_LITERAL_RE.lastIndex = 0;
  while ((m = ABS_PATH_LITERAL_RE.exec(source)) !== null) out.push({ index: m.index, snippet: m[0] });
  return out;
}

export { findEmptyCatches, findProcessExit, allowsProcessExit, PROCESS_EXIT_ALLOWED, findDirectTextIo, LEGACY_TEXT_IO_WHITELIST, isLegacyTextIo, findForbiddenPluginImports, findAbsolutePathLiterals };