"use strict";
// 二进制/流式文件原语（IO 单点）：provision 大文件下载不直连 fs。
import fs from "node:fs";
import path from "node:path";
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function createWriteStream(p, flags) { return fs.createWriteStream(p, { flags: flags || "w" }); }
function renameFile(from, to) { fs.renameSync(from, to); }
function removeFile(p) { try { fs.rmSync(p, { force: true }); return true; } catch (e) { return false; } }
function openFile(p, flags) { return fs.openSync(p, flags || "r"); }
function readAt(fd, buffer, offset, length, position) { return fs.readSync(fd, buffer, offset, length, position); }
function writeAt(fd, buffer, offset, length, position) { return fs.writeSync(fd, buffer, offset, length, position); }
function closeFile(fd) { try { fs.closeSync(fd); } catch (e) { /* 已关闭 */ } }
let SEQ = 0;
function writeFileBytes(p, buffer) {
  ensureDir(path.dirname(path.resolve(p)));
  const tmp = p + ".tmp-" + process.pid + "-" + (SEQ += 1);
  try {
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, p);
  } catch (err) {
    removeFile(tmp);
    throw err;
  }
}

export { ensureDir, createWriteStream, renameFile, removeFile, openFile, readAt, writeAt, closeFile, writeFileBytes };