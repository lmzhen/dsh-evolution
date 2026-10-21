"use strict";
// G3.3 tokenizer 派生物：便携二进制（header JSON + typed arrays），sha+builderVer 校验，best-effort 写入。
import path from "node:path";
import os from "node:os";
import { readBinary } from "../io/read.js";
import { atomicWrite } from "../io/write.js";

const MAGIC = "DSKTOK1";
const HEADER_VERSION = 1;
const ARRAY_ORDER = Object.freeze(["ch", "first", "next", "pid", "score"]);
const ITEMSIZE = Object.freeze({ ch: 4, first: 4, next: 4, pid: 4, score: 8 });

function defaultCacheDir() { return path.join(os.tmpdir(), "dsh-skill-merge-cache"); }
function artifactPath(cacheDir, tokenizerSha, builderVer) { return path.join(cacheDir, "tok-" + tokenizerSha + "-v" + builderVer + ".bin"); }

function serializeOps(ops) {
  return (ops || []).map(op => {
    if (op.kind === "regex") return { kind: "regex", source: op.re.source, flags: op.re.flags, to: op.to };
    return Object.assign({}, op);
  });
}
function deserializeOps(ops) {
  return (ops || []).map(op => op.kind === "regex" ? { kind: "regex", re: new RegExp(op.source, op.flags), to: op.to } : op);
}

function pack(head, trie) {
  const arrays = {};
  let dataBytes = 0;
  for (const k of ARRAY_ORDER) { arrays[k] = trie[k].byteLength; dataBytes += trie[k].byteLength; }
  const header = Object.assign({}, head, { magic: MAGIC, headerVersion: HEADER_VERSION, nodes: trie.nodes, pieces: trie.pieces, arrays });
  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(headerBuf.length, 0);
  let offset = 4 + headerBuf.length;
  const pad = (8 - (offset % 8)) % 8;
  offset += pad;
  const parts = [lenBuf, headerBuf, Buffer.alloc(pad)];
  for (const k of ARRAY_ORDER) parts.push(Buffer.from(trie[k].buffer, trie[k].byteOffset, trie[k].byteLength));
  return Buffer.concat(parts, offset + dataBytes);
}

function unpack(buf) {
  if (!buf || buf.length < 8) throw new Error("派生物过短");
  const hlen = buf.readUInt32LE(0);
  if (hlen <= 0 || 4 + hlen > buf.length) throw new Error("派生物 header 长度非法");
  const header = JSON.parse(buf.subarray(4, 4 + hlen).toString("utf8"));
  if (header.magic !== MAGIC || header.headerVersion !== HEADER_VERSION) throw new Error("派生物 magic/版本不符");
  if (!Number.isInteger(header.nodes) || header.nodes <= 0) throw new Error("派生物 nodes 非法");
  let offset = 4 + hlen;
  offset += (8 - (offset % 8)) % 8;
  const nodes = header.nodes;
  const views = {};
  for (const k of ARRAY_ORDER) {
    const bytes = nodes * ITEMSIZE[k];
    if (header.arrays[k] !== bytes) throw new Error("派生物数组长度不符: " + k);
    if (offset + bytes > buf.length) throw new Error("派生物截断: " + k);
    const abs = buf.byteOffset + offset;
    const align = ITEMSIZE[k];
    if (abs % align === 0) {
      views[k] = ITEMSIZE[k] === 4 ? new Int32Array(buf.buffer, abs, bytes / 4) : new Float64Array(buf.buffer, abs, bytes / 8);
    } else {
      const ab = new ArrayBuffer(bytes);
      Buffer.from(ab).set(buf.subarray(offset, offset + bytes));
      views[k] = ITEMSIZE[k] === 4 ? new Int32Array(ab) : new Float64Array(ab);
    }
    offset += bytes;
  }
  return { header, trie: { ch: views.ch, first: views.first, next: views.next, pid: views.pid, score: views.score, nodes, pieces: header.pieces } };
}

function save(file, tokenizerSha, builderVer, meta, trie) {
  try { atomicWrite(file, pack(Object.assign({ tokenizerSha, builderVer }, meta), trie)); return true; } catch (e) { return false; }
}

function load(file, tokenizerSha, builderVer) {
  try {
    const out = unpack(readBinary(file));
    if (out.header.tokenizerSha !== tokenizerSha || out.header.builderVer !== builderVer) return null;
    return out;
  } catch (e) { return null; }
}

export { MAGIC, HEADER_VERSION, defaultCacheDir, artifactPath, serializeOps, deserializeOps, pack, unpack, save, load };