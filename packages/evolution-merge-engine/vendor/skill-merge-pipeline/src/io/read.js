"use strict";
// C2 契约读入口：readText 唯一文本读取（CRLF/CR→LF，不剥 BOM）；readJson/readBinary/exists。
import fs from "node:fs";
import crypto from "node:crypto";
import { UnreadableError, InvalidDataError } from "../errors.js";

function wrapRead(path, err) {
  return new UnreadableError("读取失败: " + path + " (" + String(err && err.message ? err.message : err) + ")", { where: path, cause: err });
}

function readText(path) {
  let text;
  try { text = fs.readFileSync(path, "utf8"); } catch (err) { throw wrapRead(path, err); }
  return text.replace(/\r\n?/g, "\n");
}

function readJson(path) {
  const text = readText(path);
  try { return JSON.parse(text); } catch (err) {
    throw new InvalidDataError("JSON 解析失败: " + path + " (" + String(err && err.message ? err.message : err) + ")", { where: path, cause: err });
  }
}

function readBinary(path) {
  try { return fs.readFileSync(path); } catch (err) { throw wrapRead(path, err); }
}

function exists(path) {
  try { return fs.existsSync(path); } catch (err) { return false; }
}

function readWithHash(path) {
  const buffer = readBinary(path);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return { buffer, sha256, bytes: buffer.length };
}

function hashFile(path) { return crypto.createHash("sha256").update(readBinary(path)).digest("hex"); }

function fileMeta(path) {
  try { const st = fs.statSync(path); return { exists: true, bytes: st.size }; } catch (e) { return { exists: false, bytes: 0 }; }
}

function readJsonWithHash(path) {
  const src = readWithHash(path);
  let value;
  try { value = JSON.parse(src.buffer.toString("utf8")); } catch (err) {
    throw new InvalidDataError("JSON 解析失败: " + path + " (" + String(err && err.message ? err.message : err) + ")", { where: path, cause: err });
  }
  return { value, sha256: src.sha256, bytes: src.bytes };
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).map(e => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
  } catch (err) { throw wrapRead(dir, err); }
}

function realPath(p) {
  try { return fs.realpathSync(p); } catch (err) { throw wrapRead(p, err); }
}

export { readText, readJson, readJsonWithHash, readWithHash, readBinary, hashFile, fileMeta, exists, listDir, realPath };