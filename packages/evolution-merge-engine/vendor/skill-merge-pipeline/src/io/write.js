"use strict";
// C2 契约写出口：原子写（tmp+rename）+ eol/sortKeys/CSV 方言。
import fs from "node:fs";
import pathMod from "node:path";
import { ensureDir } from "./bytes.js";

let SEQ = 0;

function atomicWrite(target, data) {
  ensureDir(pathMod.dirname(pathMod.resolve(target)));
  const tmp = target + ".tmp-" + process.pid + "-" + (SEQ += 1);
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (ignored) { /* 清理失败不掩盖原错误 */ }
    throw err;
  }
}

function normalizeNewlines(s) { return String(s).replace(/\r\n?/g, "\n"); }

function applyEol(s, eol) {
  const norm = normalizeNewlines(s);
  return eol === "crlf" ? norm.replace(/\n/g, "\r\n") : norm;
}

function resolveDialect(dialect) {
  if (dialect === "python") return { eol: "crlf", sortKeys: true, csvDialect: "python" };
  return { eol: "lf", sortKeys: false, csvDialect: "native" };
}

function writeText(target, s, opts) {
  const eol = (opts && opts.eol) || "lf";
  atomicWrite(target, applyEol(s, eol));
}

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

function writeJson(target, value, opts) {
  const o = opts || {};
  const v = o.sortKeys ? sortValue(value) : value;
  const indent = o.indent === undefined ? 2 : o.indent;
  writeText(target, JSON.stringify(v, null, indent), { eol: o.eol || "lf" });
}

function csvField(v, dialect) {
  const s = v === undefined || v === null ? "" : String(v);
  if (dialect === "python") {
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }
  return "\"" + s.replace(/"/g, "\"\"") + "\"";
}

function writeCsv(target, spec) {
  const o = spec || {};
  const d = resolveDialect(o.dialect === "python" ? "python" : "native");
  const rows = o.rows || [];
  const lines = [];
  if (o.header) lines.push(o.header.map(h => csvField(h, d.csvDialect)).join(","));
  for (const r of rows) lines.push(r.map(c => csvField(c, d.csvDialect)).join(","));
  const text = lines.length ? lines.join("\n") + "\n" : "";
  writeText(target, text, { eol: o.eol || d.eol });
}

export { atomicWrite, writeText, writeJson, writeCsv, resolveDialect, sortValue, normalizeNewlines, applyEol };