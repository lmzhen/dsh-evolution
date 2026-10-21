// G7.4：条件 worker 池（默认 off；N≥minItems 且单线程估算 ≥minMs 才启用；SAB 共享静态表）。
import os from "node:os";
import { Worker } from "node:worker_threads";
import { InvalidDataError } from "../errors.js";

export const POOL_DEFAULTS = Object.freeze({ minItems: 500, minMs: 1500, maxWorkers: 4 });

export function poolDecision(opts) {
  const o = opts || {};
  const minItems = o.minItems === undefined ? POOL_DEFAULTS.minItems : Number(o.minItems);
  const minMs = o.minMs === undefined ? POOL_DEFAULTS.minMs : Number(o.minMs);
  const n = Number(o.n || 0);
  const est = Number(o.estimatedMs || 0);
  if (n < minItems) return { use: false, reason: "样本量 " + n + " < " + minItems };
  if (est < minMs) return { use: false, reason: "单线程估算 " + Math.round(est) + "ms < " + minMs + "ms" };
  return { use: true, reason: "样本量 " + n + " ≥ " + minItems + " 且估算 " + Math.round(est) + "ms ≥ " + minMs + "ms" };
}

export function poolSize(configured) {
  const cpus = Math.max(1, Number(os.availableParallelism ? os.availableParallelism() : os.cpus().length));
  const want = Number(configured || 0) > 0 ? Number(configured) : Math.min(POOL_DEFAULTS.maxWorkers, Math.max(1, cpus - 1));
  return Math.max(1, Math.min(want, cpus));
}

export function tableSab(view, cols, rows, itemsize, scales, normalize, dtype) {
  const viewBytes = rows * cols * itemsize;
  const scaleBytes = scales ? rows * 4 : 0;
  const sab = new SharedArrayBuffer(viewBytes + scaleBytes);
  new Uint8Array(sab, 0, viewBytes).set(new Uint8Array(view.buffer, view.byteOffset, viewBytes));
  if (scales) new Float32Array(sab, viewBytes, rows).set(scales);
  return {
    sab: sab,
    meta: { dtype: dtype, rows: rows, cols: cols, itemsize: itemsize, normalize: normalize, viewOffset: 0, viewBytes: viewBytes, scalesOffset: viewBytes, scalesBytes: scaleBytes }
  };
}

export async function runEncodePool(opts) {
  const o = opts || {};
  const idsList = o.idsList || [];
  if (!o.sab) throw new InvalidDataError("缺少共享表 SAB", { where: "worker-pool" });
  const workers = Math.max(1, Math.min(Number(o.workers || 1), idsList.length));
  const timeoutMs = Number(o.timeoutMs || 120000);
  const workerUrl = o.workerUrl || new URL("./encode_worker.js", import.meta.url);
  const chunks = [];
  const per = Math.ceil(idsList.length / workers);
  for (let i = 0; i < idsList.length; i += per) chunks.push(idsList.slice(i, i + per));
  const pending = chunks.map((chunk) => new Promise((resolve, reject) => {
    const w = new Worker(workerUrl, { workerData: { sab: o.sab, meta: o.meta, idsList: chunk } });
    let done = false;
    const timer = setTimeout(() => { if (done) return; done = true; try { w.terminate(); } catch (e) { /* 忽略 */ } reject(new InvalidDataError("worker 池超时 " + timeoutMs + "ms", { where: "worker-pool" })); }, timeoutMs);
    w.once("message", (msg) => { if (done) return; done = true; clearTimeout(timer); try { w.terminate(); } catch (e) { /* 忽略 */ } resolve(msg); });
    w.once("error", (err) => { if (done) return; done = true; clearTimeout(timer); try { w.terminate(); } catch (e) { /* 忽略 */ } reject(new InvalidDataError("worker 失败: " + String(err && err.message ? err.message : err), { where: "worker-pool" })); });
  }));
  const parts = await Promise.all(pending);
  const out = [];
  for (const part of parts) for (const v of part.vectors) out.push(v);
  return { vectors: out, workers: workers, chunks: chunks.length };
}

export function tableWorkerData(view, cols, rows, itemsize, scales, normalize, dtype) {
  const shared = tableSab(view, cols, rows, itemsize, scales, normalize, dtype);
  return shared;
}