// G7.4：worker：SAB 共享静态表（bulk），对分配到的 token id 列表做与主线程完全一致的 f64 累加 + 归一化。
import { parentPort, workerData } from "node:worker_threads";
import { f16ToF32 } from "../models/safetensors.js";

const { sab, meta, idsList } = workerData;
function makeView(Ctor, offset, length) { return new Ctor(sab, offset, length); }
function tableViews(meta) {
  const n = meta.rows * meta.cols;
  let view;
  if (meta.dtype === "I8") view = makeView(Int8Array, meta.viewOffset, n);
  else if (meta.dtype === "U8") view = makeView(Uint8Array, meta.viewOffset, n);
  else if (meta.dtype === "F16") view = makeView(Uint16Array, meta.viewOffset, n);
  else if (meta.dtype === "F32") view = makeView(Float32Array, meta.viewOffset, n);
  else throw new Error("未知 dtype: " + meta.dtype);
  const scales = meta.scalesBytes ? makeView(Float32Array, meta.scalesOffset, meta.rows) : null;
  return { view: view, scales: scales };
}
const t = tableViews(meta);
const cols = meta.cols;
function encodeOne(ids) {
  const acc = new Float64Array(cols);
  if (!ids.length) return new Float32Array(cols);
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  for (const [id, count] of counts) {
    const base = id * cols;
    const scale = t.scales ? t.scales[id] : 1;
    if (meta.dtype === "I8" || meta.dtype === "U8") { for (let j = 0; j < cols; j += 1) acc[j] += t.view[base + j] * scale * count; }
    else if (meta.dtype === "F16") { for (let j = 0; j < cols; j += 1) acc[j] += f16ToF32(t.view[base + j]) * count; }
    else { for (let j = 0; j < cols; j += 1) acc[j] += t.view[base + j] * count; }
  }
  for (let j = 0; j < cols; j += 1) acc[j] /= ids.length;
  if (meta.normalize) {
    let n2 = 0;
    for (let j = 0; j < cols; j += 1) n2 += acc[j] * acc[j];
    const nrm = Math.sqrt(n2);
    if (nrm > 0) for (let j = 0; j < cols; j += 1) acc[j] /= nrm;
  }
  return Float32Array.from(acc);
}
const vectors = (idsList || []).map(encodeOne);
parentPort.postMessage({ vectors: vectors }, vectors.map(v => v.buffer));