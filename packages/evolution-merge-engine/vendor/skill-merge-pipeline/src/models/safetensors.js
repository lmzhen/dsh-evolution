"use strict";
// safetensors 读写（compact header + 空格 pad + 8B LE 长度；流式，不整表进内存）。
import { openFile, readAt, writeAt, closeFile, renameFile, removeFile } from "../io/bytes.js";
import { InvalidDataError } from "../errors.js";

const ITEMSIZE = Object.freeze({ F32: 4, F16: 2, I8: 1 });

function openTensor(file) {
  const fd = openFile(file, "r");
  try {
    const lenBuf = Buffer.alloc(8);
    readAt(fd, lenBuf, 0, 8, 0);
    const hlen = Number(lenBuf.readBigUInt64LE(0));
    if (!Number.isInteger(hlen) || hlen <= 0 || hlen > 100 * 1024 * 1024) throw new InvalidDataError("safetensors header 长度非法: " + file, { where: file });
    const hb = Buffer.alloc(hlen);
    readAt(fd, hb, 0, hlen, 8);
    const hdr = JSON.parse(hb.toString("utf8"));
    const keys = Object.keys(hdr).filter(k => k !== "__metadata__");
    if (keys.length !== 1) throw new InvalidDataError("safetensors 必须单张量: " + file, { where: file });
    const info = hdr[keys[0]];
    const itemsize = ITEMSIZE[info.dtype];
    if (!itemsize) throw new InvalidDataError("不支持的 dtype: " + info.dtype, { where: file });
    return {
      fd, key: keys[0], dtype: info.dtype, rows: info.shape[0], cols: info.shape[1],
      dataOffset: 8 + hlen + (info.data_offsets ? info.data_offsets[0] : 0), itemsize,
      close() { closeFile(fd); }
    };
  } catch (err) { closeFile(fd); throw err; }
}

async function writeTensor(target, spec) {
  const { dtype, rows, cols, writeChunk } = spec;
  const itemsize = ITEMSIZE[dtype];
  const nbytes = rows * cols * itemsize;
  const header = JSON.stringify({ embeddings: { dtype, shape: [rows, cols], data_offsets: [0, nbytes] } });
  let hb = Buffer.from(header, "utf8");
  const pad = (8 - ((8 + hb.length) % 8)) % 8;
  if (pad) hb = Buffer.concat([hb, Buffer.alloc(pad, 0x20)]);
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(hb.length), 0);
  const tmp = target + ".tmp";
  removeFile(tmp);
  const fd = openFile(tmp, "w");
  try {
    writeAt(fd, lenBuf, 0, 8, 0);
    writeAt(fd, hb, 0, hb.length, 8);
    let pos = 8 + hb.length;
    await writeChunk(chunk => { writeAt(fd, chunk, 0, chunk.length, pos); pos += chunk.length; });
    closeFile(fd);
    if (pos !== 8 + hb.length + nbytes) throw new InvalidDataError("safetensors 写出行数不符: " + target, { where: target });
    renameFile(tmp, target);
  } catch (err) { closeFile(fd); removeFile(tmp); throw err; }
}

function f16ToF32(h) {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1F;
  const f = h & 0x3FF;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1F) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

const F32_SCRATCH = new Float32Array(1);
const U32_SCRATCH = new Uint32Array(F32_SCRATCH.buffer);
function f32ToF16(value) {
  F32_SCRATCH[0] = value;
  const x = U32_SCRATCH[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xFF;
  const mant = x & 0x7FFFFF;
  if (exp === 0xFF) return sign | (mant ? 0x7E00 : 0x7C00);
  let e = exp - 127 + 15;
  if (e >= 0x1F) return sign | 0x7C00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    let q = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && (q & 1))) q += 1;
    return sign | q;
  }
  let m = mant >>> 13;
  const rem = mant & 0x1FFF;
  if (rem > 0x1000 || (rem === 0x1000 && (m & 1))) {
    m += 1;
    if (m === 0x400) { m = 0; e += 1; if (e >= 0x1F) return sign | 0x7C00; }
  }
  return sign | (e << 10) | m;
}

export { ITEMSIZE, openTensor, writeTensor, f16ToF32, f32ToF16 };