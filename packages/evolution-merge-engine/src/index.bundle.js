// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/contracts.js
var CONTRACT_VERSION = "v1";
var ExitCode = Object.freeze({ OK: 0, RUNTIME: 1, USAGE: 2 });
var DiagnosticCode = Object.freeze({
  USAGE: "USAGE",
  CONFIG: "CONFIG",
  MODEL_MISSING: "MODEL_MISSING",
  UNREADABLE: "UNREADABLE",
  INVALID: "INVALID",
  UNAVAILABLE: "UNAVAILABLE",
  BUDGET: "BUDGET",
  PARTIAL: "PARTIAL",
  ALL_DOWN: "ALL_DOWN",
  INTERNAL: "INTERNAL"
});
var ReasonCode = Object.freeze({
  NO_KEY: "no-key",
  HTTP_ERROR: "http-error",
  TIMEOUT: "timeout",
  INVALID_RESPONSE: "invalid-response",
  ALL_DOWN: "all-down",
  PARTIAL_FILL: "partial-fill",
  UNKNOWN: "unknown"
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/errors.js
var AppError = class extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code || DiagnosticCode.INTERNAL;
    this.exitCode = opts.exitCode !== void 0 ? opts.exitCode : ExitCode.RUNTIME;
    this.where = opts.where || "";
    this.retryable = !!opts.retryable;
    if (opts.cause) this.cause = opts.cause;
  }
};
var ConfigError = class extends AppError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: opts.code || DiagnosticCode.CONFIG, exitCode: ExitCode.USAGE }));
  }
};
var ModelMissingError = class extends ConfigError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: DiagnosticCode.MODEL_MISSING }));
  }
};
var PipelineError = class extends AppError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: opts.code || DiagnosticCode.INTERNAL, exitCode: opts.exitCode !== void 0 ? opts.exitCode : ExitCode.RUNTIME }));
  }
};
var UnavailableError = class extends PipelineError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: DiagnosticCode.UNAVAILABLE, retryable: opts.retryable !== false }));
  }
};
var UnreadableError = class extends PipelineError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: DiagnosticCode.UNREADABLE }));
  }
};
var InvalidDataError = class extends PipelineError {
  constructor(message, opts = {}) {
    super(message, Object.assign({}, opts, { code: DiagnosticCode.INVALID }));
  }
};
function isAppError(err) {
  return err instanceof AppError;
}
function toDiagnostic(err, info = {}) {
  if (isAppError(err)) {
    return { code: err.code, where: info.where || err.where || "", detail: err.message, retryable: err.retryable };
  }
  if (err && typeof err === "object") {
    return { code: DiagnosticCode.INTERNAL, where: info.where || "", detail: String(err.message || err), retryable: false };
  }
  return { code: DiagnosticCode.INTERNAL, where: info.where || "", detail: String(err), retryable: false };
}
function exitCodeOf(err) {
  if (isAppError(err)) return err.exitCode;
  return ExitCode.RUNTIME;
}
var HINTS = Object.freeze({
  USAGE: "\u8FD0\u884C --help \u67E5\u770B\u53C2\u6570\uFF1B\u6216\u68C0\u67E5\u53C2\u6570\u503C\u662F\u5426\u5728 choices \u8303\u56F4\u5185\u3002",
  CONFIG: "\u68C0\u67E5\u914D\u7F6E\u6587\u4EF6/\u73AF\u5883\u53D8\u91CF\uFF1B\u7F3A\u5931\u6A21\u578B\u6216\u51ED\u636E\u8BF7\u5148\u8FD0\u884C doctor\u3002",
  MODEL_MISSING: "\u8FD0\u884C skill-merge models ensure \u4E0B\u8F7D/\u6784\u5EFA\uFF0C\u6216 --models-dir \u6307\u5411\u5DF2\u6709\u6A21\u578B\u6839\u76EE\u5F55\u3002",
  UNREADABLE: "\u68C0\u67E5\u6587\u4EF6\u8DEF\u5F84/\u6743\u9650\uFF1B\u5FC5\u8981\u65F6\u91CD\u65B0\u751F\u6210\u4EA7\u7269\u3002",
  UNAVAILABLE: "\u670D\u52A1\u4E0D\u53EF\u7528\uFF1B\u7A0D\u540E\u91CD\u8BD5\u6216\u4F7F\u7528\u964D\u7EA7\u6A21\u5F0F\uFF08\u5982 --rank vec\uFF09\u3002",
  INVALID: "\u8FD4\u56DE\u5185\u5BB9\u975E\u6CD5\uFF1B\u68C0\u67E5\u670D\u52A1\u7248\u672C\u6216\u91CD\u8BD5\u3002",
  BUDGET: "\u8D44\u6E90\u9884\u7B97\u8D85\u9650\uFF1B\u51CF\u5C0F --max-table-mb \u6216\u4F7F\u7528 --stream-mode stream\u3002",
  PARTIAL: "\u90E8\u5206\u7ED3\u679C\u5931\u8D25\uFF1B\u68C0\u67E5 diagnostics \u4E0E\u964D\u7EA7\u539F\u56E0\u3002",
  ALL_DOWN: "\u6240\u6709\u5019\u9009\u901A\u9053\u4E0D\u53EF\u7528\uFF1B\u68C0\u67E5\u6A21\u578B/\u670D\u52A1\u540E\u91CD\u8BD5\u3002",
  INTERNAL: "\u5185\u90E8\u9519\u8BEF\uFF1B\u7528 --debug \u67E5\u770B\u6808\u5E76\u4FDD\u7559\u65E5\u5FD7\u3002"
});
var Diagnostics = class {
  constructor() {
    this.items = [];
  }
  record(diag) {
    this.items.push(diag);
    return diag;
  }
  recordError(err, where) {
    return this.record(toDiagnostic(err, where ? { where } : {}));
  }
  hasErrors() {
    return this.items.some((d) => d.code !== DiagnosticCode.PARTIAL);
  }
  countByCode() {
    const out = {};
    for (const d of this.items) out[d.code] = (out[d.code] || 0) + 1;
    return out;
  }
};

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/pipeline/context.js
function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}
function createContext(options) {
  const o = options || {};
  const diagnostics = new Diagnostics();
  const cleanup = [];
  const timings = [];
  let disposed = false;
  const ctx = {
    cfg: Object.freeze(o.cfg || {}),
    state: o.state || {},
    out: o.out || "",
    argv: o.argv || [],
    env: o.env || process.env,
    log: o.log || ((...args) => console.log(...args)),
    clock: o.clock || (() => Date.now()),
    signal: o.signal || null,
    timings,
    cleanup,
    diagnostics,
    data: {},
    addTiming(stageId, ms, extra) {
      const e = { id: String(stageId), ms: round1(ms), counters: extra && extra.counters || {}, degraded: !!(extra && extra.degraded) };
      timings.push(e);
      return e;
    },
    onCleanup(fn) {
      if (typeof fn !== "function") throw new PipelineError("cleanup \u5FC5\u987B\u662F\u51FD\u6570", { code: DiagnosticCode.INVALID, where: "context" });
      cleanup.push(fn);
      return () => {
        const i = cleanup.indexOf(fn);
        if (i >= 0) cleanup.splice(i, 1);
      };
    },
    record(diag) {
      return diagnostics.record(diag);
    },
    recordError(err, where) {
      return diagnostics.recordError(err, where);
    },
    dispose() {
      if (disposed) return { executed: 0, failed: 0, skipped: true };
      disposed = true;
      let executed = 0;
      let failed = 0;
      while (cleanup.length) {
        const fn = cleanup.pop();
        try {
          fn();
          executed += 1;
        } catch (err) {
          failed += 1;
          diagnostics.recordError(err, "cleanup");
        }
      }
      return { executed, failed };
    }
  };
  return ctx;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/net/signal.js
function abortError(message) {
  const e = new Error(message || "\u64CD\u4F5C\u5DF2\u53D6\u6D88");
  e.name = "AbortError";
  return e;
}
function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError("\u64CD\u4F5C\u5DF2\u53D6\u6D88");
}
function withTimeout(signal, ms) {
  const timeout = Number(ms);
  const timeoutSignal = Number.isFinite(timeout) && timeout > 0 ? AbortSignal.timeout(timeout) : null;
  if (!signal) return timeoutSignal || void 0;
  if (!timeoutSignal) return signal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeoutSignal]);
  return timeoutSignal;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/pipeline/stage.js
function bad(msg) {
  return new PipelineError(msg, { code: DiagnosticCode.INVALID, where: "stage" });
}
function defineStage(spec) {
  const s = spec || {};
  if (!s.id || typeof s.id !== "string") throw bad("stage.id \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32");
  const requires = s.requires === void 0 ? [] : s.requires;
  if (!Array.isArray(requires) || requires.some((r) => typeof r !== "string")) throw bad("stage.requires \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4\uFF08" + s.id + "\uFF09");
  if (typeof s.run !== "function") throw bad("stage.run \u5FC5\u987B\u662F\u51FD\u6570\uFF08" + s.id + "\uFF09");
  return Object.freeze({ id: s.id, requires: Object.freeze(requires.slice()), run: s.run });
}
async function runStage(stage, ctx, input) {
  const env = input || {};
  for (const dep of stage.requires) {
    if (!Object.prototype.hasOwnProperty.call(env, dep) || env[dep] === void 0) {
      throw bad("stage " + stage.id + " \u7F3A\u5C11\u4F9D\u8D56: " + dep);
    }
  }
  throwIfAborted(ctx.signal);
  const t0 = performance.now();
  let result;
  try {
    result = await stage.run(ctx, env);
  } catch (err) {
    ctx.addTiming(stage.id, performance.now() - t0, { degraded: true });
    throw err;
  }
  throwIfAborted(ctx.signal);
  const ms = performance.now() - t0;
  const norm = {
    data: result ? result.data : void 0,
    stats: result && result.stats || {},
    warnings: result && result.warnings || [],
    counters: result && result.counters || {},
    degraded: !!(result && result.degraded)
  };
  for (const w of norm.warnings) ctx.record(w);
  ctx.addTiming(stage.id, ms, { counters: norm.counters, degraded: norm.degraded });
  return norm;
}
async function runStages(stages, ctx, input) {
  const list = Array.isArray(stages) ? stages : [];
  const seen = /* @__PURE__ */ new Set();
  const out = {};
  const results = [];
  for (const stage of list) {
    if (!stage || typeof stage.id !== "string") throw bad("\u975E\u6CD5 stage");
    if (seen.has(stage.id)) throw bad("stage id \u91CD\u590D: " + stage.id);
    for (const dep of stage.requires || []) {
      if (!seen.has(dep)) throw bad("stage " + stage.id + " \u7684\u4F9D\u8D56 " + dep + " \u672A\u5728\u6B64\u4E4B\u524D\u6267\u884C");
    }
    const env = Object.assign({}, input || {}, out);
    const res = await runStage(stage, ctx, env);
    results.push(Object.assign({ id: stage.id }, res));
    if (res.data !== void 0) out[stage.id] = res.data;
    seen.add(stage.id);
  }
  return { results, data: out };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/static_table.js
import path4 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/io/read.js
import fs from "node:fs";
import crypto from "node:crypto";
function wrapRead(path23, err) {
  return new UnreadableError("\u8BFB\u53D6\u5931\u8D25: " + path23 + " (" + String(err && err.message ? err.message : err) + ")", { where: path23, cause: err });
}
function readText(path23) {
  let text;
  try {
    text = fs.readFileSync(path23, "utf8");
  } catch (err) {
    throw wrapRead(path23, err);
  }
  return text.replace(/\r\n?/g, "\n");
}
function readJson(path23) {
  const text = readText(path23);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new InvalidDataError("JSON \u89E3\u6790\u5931\u8D25: " + path23 + " (" + String(err && err.message ? err.message : err) + ")", { where: path23, cause: err });
  }
}
function readBinary(path23) {
  try {
    return fs.readFileSync(path23);
  } catch (err) {
    throw wrapRead(path23, err);
  }
}
function exists(path23) {
  try {
    return fs.existsSync(path23);
  } catch (err) {
    return false;
  }
}
function readWithHash(path23) {
  const buffer = readBinary(path23);
  const sha2562 = crypto.createHash("sha256").update(buffer).digest("hex");
  return { buffer, sha256: sha2562, bytes: buffer.length };
}
function hashFile(path23) {
  return crypto.createHash("sha256").update(readBinary(path23)).digest("hex");
}
function fileMeta(path23) {
  try {
    const st = fs.statSync(path23);
    return { exists: true, bytes: st.size };
  } catch (e) {
    return { exists: false, bytes: 0 };
  }
}
function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
  } catch (err) {
    throw wrapRead(dir, err);
  }
}
function realPath(p) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    throw wrapRead(p, err);
  }
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/io/bytes.js
import fs2 from "node:fs";
import path from "node:path";
function ensureDir(p) {
  fs2.mkdirSync(p, { recursive: true });
}
function createWriteStream(p, flags) {
  return fs2.createWriteStream(p, { flags: flags || "w" });
}
function renameFile(from, to) {
  fs2.renameSync(from, to);
}
function removeFile(p) {
  try {
    fs2.rmSync(p, { force: true });
    return true;
  } catch (e) {
    return false;
  }
}
function openFile(p, flags) {
  return fs2.openSync(p, flags || "r");
}
function readAt(fd, buffer, offset, length, position) {
  return fs2.readSync(fd, buffer, offset, length, position);
}
function writeAt(fd, buffer, offset, length, position) {
  return fs2.writeSync(fd, buffer, offset, length, position);
}
function closeFile(fd) {
  try {
    fs2.closeSync(fd);
  } catch (e) {
  }
}
var SEQ = 0;
function writeFileBytes(p, buffer) {
  ensureDir(path.dirname(path.resolve(p)));
  const tmp = p + ".tmp-" + process.pid + "-" + (SEQ += 1);
  try {
    fs2.writeFileSync(tmp, buffer);
    fs2.renameSync(tmp, p);
  } catch (err) {
    removeFile(tmp);
    throw err;
  }
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/safetensors.js
var ITEMSIZE = Object.freeze({ F32: 4, F16: 2, I8: 1 });
function openTensor(file) {
  const fd = openFile(file, "r");
  try {
    const lenBuf = Buffer.alloc(8);
    readAt(fd, lenBuf, 0, 8, 0);
    const hlen = Number(lenBuf.readBigUInt64LE(0));
    if (!Number.isInteger(hlen) || hlen <= 0 || hlen > 100 * 1024 * 1024) throw new InvalidDataError("safetensors header \u957F\u5EA6\u975E\u6CD5: " + file, { where: file });
    const hb = Buffer.alloc(hlen);
    readAt(fd, hb, 0, hlen, 8);
    const hdr = JSON.parse(hb.toString("utf8"));
    const keys = Object.keys(hdr).filter((k) => k !== "__metadata__");
    if (keys.length !== 1) throw new InvalidDataError("safetensors \u5FC5\u987B\u5355\u5F20\u91CF: " + file, { where: file });
    const info = hdr[keys[0]];
    const itemsize = ITEMSIZE[info.dtype];
    if (!itemsize) throw new InvalidDataError("\u4E0D\u652F\u6301\u7684 dtype: " + info.dtype, { where: file });
    return {
      fd,
      key: keys[0],
      dtype: info.dtype,
      rows: info.shape[0],
      cols: info.shape[1],
      dataOffset: 8 + hlen + (info.data_offsets ? info.data_offsets[0] : 0),
      itemsize,
      close() {
        closeFile(fd);
      }
    };
  } catch (err) {
    closeFile(fd);
    throw err;
  }
}
async function writeTensor(target, spec) {
  const { dtype, rows, cols, writeChunk } = spec;
  const itemsize = ITEMSIZE[dtype];
  const nbytes = rows * cols * itemsize;
  const header = JSON.stringify({ embeddings: { dtype, shape: [rows, cols], data_offsets: [0, nbytes] } });
  let hb = Buffer.from(header, "utf8");
  const pad = (8 - (8 + hb.length) % 8) % 8;
  if (pad) hb = Buffer.concat([hb, Buffer.alloc(pad, 32)]);
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(hb.length), 0);
  const tmp = target + ".tmp";
  removeFile(tmp);
  const fd = openFile(tmp, "w");
  try {
    writeAt(fd, lenBuf, 0, 8, 0);
    writeAt(fd, hb, 0, hb.length, 8);
    let pos = 8 + hb.length;
    await writeChunk((chunk) => {
      writeAt(fd, chunk, 0, chunk.length, pos);
      pos += chunk.length;
    });
    closeFile(fd);
    if (pos !== 8 + hb.length + nbytes) throw new InvalidDataError("safetensors \u5199\u51FA\u884C\u6570\u4E0D\u7B26: " + target, { where: target });
    renameFile(tmp, target);
  } catch (err) {
    closeFile(fd);
    removeFile(tmp);
    throw err;
  }
}
function f16ToF32(h) {
  const s = h & 32768 ? -1 : 1;
  const e = h >> 10 & 31;
  const f = h & 1023;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
var F32_SCRATCH = new Float32Array(1);
var U32_SCRATCH = new Uint32Array(F32_SCRATCH.buffer);
function f32ToF16(value) {
  F32_SCRATCH[0] = value;
  const x = U32_SCRATCH[0];
  const sign = x >>> 16 & 32768;
  const exp = x >>> 23 & 255;
  const mant = x & 8388607;
  if (exp === 255) return sign | (mant ? 32256 : 31744);
  let e = exp - 127 + 15;
  if (e >= 31) return sign | 31744;
  if (e <= 0) {
    if (e < -10) return sign;
    const m2 = mant | 8388608;
    const shift = 14 - e;
    let q = m2 >>> shift;
    const rem2 = m2 & (1 << shift) - 1;
    const half = 1 << shift - 1;
    if (rem2 > half || rem2 === half && q & 1) q += 1;
    return sign | q;
  }
  let m = mant >>> 13;
  const rem = mant & 8191;
  if (rem > 4096 || rem === 4096 && m & 1) {
    m += 1;
    if (m === 1024) {
      m = 0;
      e += 1;
      if (e >= 31) return sign | 31744;
    }
  }
  return sign | e << 10 | m;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/text/trie.js
function buildTrie(scores, ids) {
  const pieces = [...ids.keys()].sort();
  let nodes = 1;
  let prev = "";
  for (const p of pieces) {
    let lcp = 0;
    const m = Math.min(prev.length, p.length);
    while (lcp < m && prev.charCodeAt(lcp) === p.charCodeAt(lcp)) lcp += 1;
    nodes += p.length - lcp;
    prev = p;
  }
  const ch = new Int32Array(nodes);
  const first = new Int32Array(nodes).fill(-1);
  const next = new Int32Array(nodes).fill(-1);
  const last = new Int32Array(nodes).fill(-1);
  const pid = new Int32Array(nodes).fill(-1);
  const score = new Float64Array(nodes);
  let n = 1;
  let path23 = [];
  prev = "";
  for (const piece of pieces) {
    let lcp = 0;
    const m = Math.min(prev.length, piece.length);
    while (lcp < m && prev.charCodeAt(lcp) === piece.charCodeAt(lcp)) lcp += 1;
    path23.length = lcp;
    let parent = lcp > 0 ? path23[lcp - 1] : 0;
    for (let d = lcp; d < piece.length; d += 1) {
      const node = n;
      n += 1;
      ch[node] = piece.charCodeAt(d);
      if (first[parent] === -1) first[parent] = node;
      else next[last[parent]] = node;
      last[parent] = node;
      path23.push(node);
      parent = node;
    }
    pid[parent] = ids.get(piece);
    score[parent] = scores.get(piece);
    prev = piece;
  }
  const rootMap = /* @__PURE__ */ new Map();
  for (let c = first[0]; c !== -1; c = next[c]) rootMap.set(ch[c], c);
  return { ch, first, next, pid, score, rootMap, nodes: n, pieces: pieces.length };
}
function tokenizeWithTrie(trie, tok, text) {
  const s = tok.applyPreTokenizer(tok.applyNormalizer(String(text)));
  const n = s.length;
  const best = new Float64Array(n + 1).fill(Infinity);
  const back = new Int32Array(n + 1).fill(-1);
  const backId = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < n; i += 1) {
    if (best[i] === Infinity) continue;
    let node = trie.rootMap.get(s.charCodeAt(i));
    let len = 1;
    while (node !== void 0) {
      const id = trie.pid[node];
      if (id !== -1) {
        const cand = best[i] - trie.score[node];
        if (cand < best[i + len] - 1e-12) {
          best[i + len] = cand;
          back[i + len] = i;
          backId[i + len] = id;
        }
      }
      if (i + len >= n) break;
      const code = s.charCodeAt(i + len);
      let c = trie.first[node];
      while (c !== -1 && trie.ch[c] !== code) c = trie.next[c];
      if (c === -1) break;
      node = c;
      len += 1;
    }
    const candU = best[i] - tok.unkScore;
    if (candU < best[i + 1] - 1e-12) {
      best[i + 1] = candU;
      back[i + 1] = i;
      backId[i + 1] = tok.unkId;
    }
  }
  const ids = [];
  let pos = n;
  while (pos > 0) {
    const p = back[pos];
    if (p < 0) break;
    ids.push(backId[pos]);
    pos = p;
  }
  ids.reverse();
  return ids;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/text/artifact.js
import path2 from "node:path";
import os from "node:os";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/io/write.js
import fs3 from "node:fs";
import pathMod from "node:path";
var SEQ2 = 0;
function atomicWrite(target, data) {
  ensureDir(pathMod.dirname(pathMod.resolve(target)));
  const tmp = target + ".tmp-" + process.pid + "-" + (SEQ2 += 1);
  try {
    fs3.writeFileSync(tmp, data, "utf8");
    fs3.renameSync(tmp, target);
  } catch (err) {
    try {
      if (fs3.existsSync(tmp)) fs3.unlinkSync(tmp);
    } catch (ignored) {
    }
    throw err;
  }
}
function normalizeNewlines(s) {
  return String(s).replace(/\r\n?/g, "\n");
}
function applyEol(s, eol) {
  const norm = normalizeNewlines(s);
  return eol === "crlf" ? norm.replace(/\n/g, "\r\n") : norm;
}
function resolveDialect(dialect) {
  if (dialect === "python") return { eol: "crlf", sortKeys: true, csvDialect: "python" };
  return { eol: "lf", sortKeys: false, csvDialect: "native" };
}
function writeText(target, s, opts) {
  const eol = opts && opts.eol || "lf";
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
  const indent = o.indent === void 0 ? 2 : o.indent;
  writeText(target, JSON.stringify(v, null, indent), { eol: o.eol || "lf" });
}
function csvField(v, dialect) {
  const s = v === void 0 || v === null ? "" : String(v);
  if (dialect === "python") {
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  return '"' + s.replace(/"/g, '""') + '"';
}
function writeCsv(target, spec) {
  const o = spec || {};
  const d = resolveDialect(o.dialect === "python" ? "python" : "native");
  const rows = o.rows || [];
  const lines = [];
  if (o.header) lines.push(o.header.map((h) => csvField(h, d.csvDialect)).join(","));
  for (const r of rows) lines.push(r.map((c) => csvField(c, d.csvDialect)).join(","));
  const text = lines.length ? lines.join("\n") + "\n" : "";
  writeText(target, text, { eol: o.eol || d.eol });
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/text/artifact.js
var MAGIC = "DSKTOK1";
var HEADER_VERSION = 1;
var ARRAY_ORDER = Object.freeze(["ch", "first", "next", "pid", "score"]);
var ITEMSIZE2 = Object.freeze({ ch: 4, first: 4, next: 4, pid: 4, score: 8 });
function defaultCacheDir() {
  return path2.join(os.tmpdir(), "dsh-skill-merge-cache");
}
function artifactPath(cacheDir, tokenizerSha, builderVer) {
  return path2.join(cacheDir, "tok-" + tokenizerSha + "-v" + builderVer + ".bin");
}
function serializeOps(ops) {
  return (ops || []).map((op) => {
    if (op.kind === "regex") return { kind: "regex", source: op.re.source, flags: op.re.flags, to: op.to };
    return Object.assign({}, op);
  });
}
function deserializeOps(ops) {
  return (ops || []).map((op) => op.kind === "regex" ? { kind: "regex", re: new RegExp(op.source, op.flags), to: op.to } : op);
}
function pack(head, trie) {
  const arrays = {};
  let dataBytes = 0;
  for (const k of ARRAY_ORDER) {
    arrays[k] = trie[k].byteLength;
    dataBytes += trie[k].byteLength;
  }
  const header = Object.assign({}, head, { magic: MAGIC, headerVersion: HEADER_VERSION, nodes: trie.nodes, pieces: trie.pieces, arrays });
  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(headerBuf.length, 0);
  let offset = 4 + headerBuf.length;
  const pad = (8 - offset % 8) % 8;
  offset += pad;
  const parts = [lenBuf, headerBuf, Buffer.alloc(pad)];
  for (const k of ARRAY_ORDER) parts.push(Buffer.from(trie[k].buffer, trie[k].byteOffset, trie[k].byteLength));
  return Buffer.concat(parts, offset + dataBytes);
}
function unpack(buf) {
  if (!buf || buf.length < 8) throw new Error("\u6D3E\u751F\u7269\u8FC7\u77ED");
  const hlen = buf.readUInt32LE(0);
  if (hlen <= 0 || 4 + hlen > buf.length) throw new Error("\u6D3E\u751F\u7269 header \u957F\u5EA6\u975E\u6CD5");
  const header = JSON.parse(buf.subarray(4, 4 + hlen).toString("utf8"));
  if (header.magic !== MAGIC || header.headerVersion !== HEADER_VERSION) throw new Error("\u6D3E\u751F\u7269 magic/\u7248\u672C\u4E0D\u7B26");
  if (!Number.isInteger(header.nodes) || header.nodes <= 0) throw new Error("\u6D3E\u751F\u7269 nodes \u975E\u6CD5");
  let offset = 4 + hlen;
  offset += (8 - offset % 8) % 8;
  const nodes = header.nodes;
  const views = {};
  for (const k of ARRAY_ORDER) {
    const bytes = nodes * ITEMSIZE2[k];
    if (header.arrays[k] !== bytes) throw new Error("\u6D3E\u751F\u7269\u6570\u7EC4\u957F\u5EA6\u4E0D\u7B26: " + k);
    if (offset + bytes > buf.length) throw new Error("\u6D3E\u751F\u7269\u622A\u65AD: " + k);
    const abs = buf.byteOffset + offset;
    const align = ITEMSIZE2[k];
    if (abs % align === 0) {
      views[k] = ITEMSIZE2[k] === 4 ? new Int32Array(buf.buffer, abs, bytes / 4) : new Float64Array(buf.buffer, abs, bytes / 8);
    } else {
      const ab = new ArrayBuffer(bytes);
      Buffer.from(ab).set(buf.subarray(offset, offset + bytes));
      views[k] = ITEMSIZE2[k] === 4 ? new Int32Array(ab) : new Float64Array(ab);
    }
    offset += bytes;
  }
  return { header, trie: { ch: views.ch, first: views.first, next: views.next, pid: views.pid, score: views.score, nodes, pieces: header.pieces } };
}
function save(file, tokenizerSha, builderVer, meta, trie) {
  try {
    atomicWrite(file, pack(Object.assign({ tokenizerSha, builderVer }, meta), trie));
    return true;
  } catch (e) {
    return false;
  }
}
function load(file, tokenizerSha, builderVer) {
  try {
    const out = unpack(readBinary(file));
    if (out.header.tokenizerSha !== tokenizerSha || out.header.builderVer !== builderVer) return null;
    return out;
  } catch (e) {
    return null;
  }
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/text/tokenizer.js
import * as path3 from "node:path";
var BUILDER_VER = 1;
var SUPPORTED_NORMALIZERS = /* @__PURE__ */ new Set(["Sequence", "Precompiled", "Replace", "Strip"]);
var SUPPORTED_PRE_TOKENIZERS = /* @__PURE__ */ new Set(["Metaspace"]);
var PREPEND_SCHEMES = /* @__PURE__ */ new Set(["always", "first", "never"]);
function invalid(msg) {
  return new InvalidDataError(msg, { where: "tokenizer" });
}
function compileNormalizer(node, ops, path23) {
  if (node === null || node === void 0) return;
  if (typeof node !== "object" || typeof node.type !== "string") throw invalid("normalizer \u8282\u70B9\u975E\u6CD5 @" + path23);
  const type = node.type;
  if (!SUPPORTED_NORMALIZERS.has(type)) throw invalid("\u4E0D\u652F\u6301\u7684 normalizer \u7C7B\u578B: " + type + " @" + path23);
  if (type === "Sequence") {
    if (!Array.isArray(node.normalizers)) throw invalid("Sequence.normalizers \u5FC5\u987B\u662F\u6570\u7EC4 @" + path23);
    node.normalizers.forEach((n, i) => compileNormalizer(n, ops, path23 + ".normalizers[" + i + "]"));
    return;
  }
  if (type === "Precompiled") {
    ops.push({ kind: "nfkc" });
    return;
  }
  if (type === "Replace") {
    const pat = node.pattern || {};
    if (pat.String !== void 0) {
      ops.push({ kind: "literal", from: String(pat.String), to: String(node.content === void 0 ? "" : node.content) });
      return;
    }
    if (pat.Regex !== void 0) {
      let re;
      try {
        re = new RegExp(String(pat.Regex), "g");
      } catch (e) {
        throw invalid("Replace \u6B63\u5219\u975E\u6CD5: " + String(pat.Regex) + " @" + path23);
      }
      ops.push({ kind: "regex", re, to: String(node.content === void 0 ? "" : node.content) });
      return;
    }
    throw invalid("Replace.pattern \u4E0D\u652F\u6301 @" + path23);
  }
  if (type === "Strip") {
    if (node.strip_left === true && node.strip_right === true) {
      ops.push({ kind: "trim" });
      return;
    }
    throw invalid("Strip \u53D8\u4F53\u4E0D\u652F\u6301\uFF08\u4EC5\u652F\u6301\u5DE6\u53F3\u540C\u65F6\uFF09@" + path23);
  }
}
function applyOps(ops, s) {
  let out = s;
  for (const op of ops) {
    if (op.kind === "nfkc") out = out.normalize("NFKC");
    else if (op.kind === "literal") out = out.split(op.from).join(op.to);
    else if (op.kind === "regex") out = out.replace(op.re, op.to);
    else if (op.kind === "trim") out = out.trim();
  }
  return out;
}
function compilePreTokenizer(node, path23) {
  if (node === null || node === void 0) return null;
  if (!node || typeof node.type !== "string") throw invalid("pre_tokenizer \u8282\u70B9\u975E\u6CD5 @" + path23);
  if (!SUPPORTED_PRE_TOKENIZERS.has(node.type)) throw invalid("\u4E0D\u652F\u6301\u7684 pre_tokenizer \u7C7B\u578B: " + node.type + " @" + path23);
  const replacement = node.replacement === void 0 ? "\u2581" : String(node.replacement);
  const scheme = node.prepend_scheme === void 0 ? "always" : String(node.prepend_scheme);
  if (!PREPEND_SCHEMES.has(scheme)) throw invalid("pre_tokenizer.prepend_scheme \u4E0D\u652F\u6301: " + scheme + " @" + path23);
  if (node.split === true) throw invalid("pre_tokenizer.split=true \u6682\u4E0D\u652F\u6301 @" + path23);
  return { kind: "metaspace", replacement, scheme };
}
var Tokenizer = class _Tokenizer {
  constructor(jsonPath, opts) {
    const o = opts || {};
    this._cache = o.cache !== false;
    this._cacheDir = o.cacheDir || process.env.DSH_SKILL_MERGE_CACHE || defaultCacheDir();
    this._fromArtifact = false;
    this._artifactPath = null;
    const src = readWithHash(jsonPath);
    this.tokenizerSha = src.sha256;
    if (this._cache) {
      this._artifactPath = artifactPath(this._cacheDir, src.sha256, BUILDER_VER);
      const loaded = load(this._artifactPath, src.sha256, BUILDER_VER);
      if (loaded) {
        this._loadArtifact(loaded);
        return;
      }
    }
    let parsed;
    try {
      parsed = JSON.parse(src.buffer.toString("utf8"));
    } catch (err) {
      throw invalid("tokenizer.json \u89E3\u6790\u5931\u8D25: " + String(err && err.message ? err.message : err));
    }
    this._loadJson(parsed);
    if (this._cache) {
      this._artifactPath = artifactPath(this._cacheDir, src.sha256, BUILDER_VER);
      save(this._artifactPath, src.sha256, BUILDER_VER, this._artifactMeta(), this.trie);
    }
  }
  static fromFile(jsonPath, opts) {
    return new _Tokenizer(jsonPath, opts);
  }
  _loadJson(t) {
    this.modelType = t.model && t.model.type;
    if (this.modelType !== "Unigram") throw invalid("\u4EC5\u652F\u6301 Unigram \u6A21\u578B\uFF0C\u6536\u5230: " + this.modelType);
    const vocab = t.model.vocab;
    if (!Array.isArray(vocab) || !vocab.length) throw invalid("model.vocab \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
    this.model = t.model;
    this.normalizer = t.normalizer;
    this.preTokenizer = t.pre_tokenizer;
    this.unkId = t.model.unk_id != null ? Number(t.model.unk_id) : 0;
    this._ops = [];
    compileNormalizer(t.normalizer, this._ops, "normalizer");
    this._pt = compilePreTokenizer(t.pre_tokenizer, "pre_tokenizer");
    this.scores = /* @__PURE__ */ new Map();
    this.ids = /* @__PURE__ */ new Map();
    this.maxPieceLen = 0;
    for (let i = 0; i < vocab.length; i += 1) {
      const e = vocab[i];
      if (!Array.isArray(e) || e.length < 2 || typeof e[0] !== "string" || typeof e[1] !== "number") throw invalid("vocab[" + i + "] \u975E\u6CD5\uFF08\u5E94\u4E3A [piece, score]\uFF09");
      const piece = e[0];
      const score = e[1];
      this.scores.set(piece, score);
      if (!this.ids.has(piece)) this.ids.set(piece, i);
      if (piece.length > this.maxPieceLen) this.maxPieceLen = piece.length;
    }
    let minScore = Infinity;
    for (const sc of this.scores.values()) if (sc < minScore) minScore = sc;
    this.unkScore = minScore - 10;
    this.vocabSize = this.ids.size;
    this.trie = buildTrie(this.scores, this.ids);
  }
  _artifactMeta() {
    return {
      modelType: this.modelType,
      unkId: this.unkId,
      unkScore: this.unkScore,
      vocabSize: this.vocabSize,
      maxPieceLen: this.maxPieceLen,
      ops: serializeOps(this._ops),
      pt: this._pt
    };
  }
  _loadArtifact(loaded) {
    const h = loaded.header;
    const trie = loaded.trie;
    trie.rootMap = /* @__PURE__ */ new Map();
    for (let c = trie.first[0]; c !== -1; c = trie.next[c]) trie.rootMap.set(trie.ch[c], c);
    this.modelType = h.modelType;
    this.unkId = h.unkId;
    this.unkScore = h.unkScore;
    this.vocabSize = h.vocabSize;
    this.maxPieceLen = h.maxPieceLen;
    this._ops = deserializeOps(h.ops);
    this._pt = h.pt;
    this.trie = trie;
    this.scores = null;
    this.ids = null;
    this._fromArtifact = true;
  }
  applyNormalizer(s) {
    return applyOps(this._ops, String(s));
  }
  applyPreTokenizer(s) {
    if (!this._pt) return s;
    const rep = this._pt.replacement;
    let out = String(s).split(" ").join(rep);
    if (this._pt.scheme === "always" || this._pt.scheme === "first" && !out.startsWith(rep)) out = rep + out;
    return out;
  }
  encode(text) {
    return tokenizeWithTrie(this.trie, this, text);
  }
  encodeBatch(texts) {
    return texts.map((t) => this.encode(t));
  }
  info() {
    return {
      modelType: this.modelType,
      vocabSize: this.vocabSize,
      maxPieceLen: this.maxPieceLen,
      trieNodes: this.trie.nodes,
      normalizerOps: this._ops.length,
      preTokenizer: this._pt ? this._pt.kind : null,
      builderVer: BUILDER_VER,
      artifact: this._fromArtifact ? this._artifactPath : null
    };
  }
};
var SHARED = /* @__PURE__ */ new Map();
function sharedTokenizer(jsonPath, opts) {
  const o = opts || {};
  const key = path3.resolve(jsonPath) + "|" + (o.cache === false ? "nocache" : "cache") + "|" + path3.resolve(o.cacheDir || "");
  let inst = SHARED.get(key);
  if (!inst) {
    inst = new Tokenizer(jsonPath, o);
    SHARED.set(key, inst);
  }
  return inst;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/workers/pool.js
import os2 from "node:os";
import { Worker } from "node:worker_threads";
var POOL_DEFAULTS = Object.freeze({ minItems: 500, minMs: 1500, maxWorkers: 4 });
function poolDecision(opts) {
  const o = opts || {};
  const minItems = o.minItems === void 0 ? POOL_DEFAULTS.minItems : Number(o.minItems);
  const minMs = o.minMs === void 0 ? POOL_DEFAULTS.minMs : Number(o.minMs);
  const n = Number(o.n || 0);
  const est = Number(o.estimatedMs || 0);
  if (n < minItems) return { use: false, reason: "\u6837\u672C\u91CF " + n + " < " + minItems };
  if (est < minMs) return { use: false, reason: "\u5355\u7EBF\u7A0B\u4F30\u7B97 " + Math.round(est) + "ms < " + minMs + "ms" };
  return { use: true, reason: "\u6837\u672C\u91CF " + n + " \u2265 " + minItems + " \u4E14\u4F30\u7B97 " + Math.round(est) + "ms \u2265 " + minMs + "ms" };
}
function poolSize(configured) {
  const cpus = Math.max(1, Number(os2.availableParallelism ? os2.availableParallelism() : os2.cpus().length));
  const want = Number(configured || 0) > 0 ? Number(configured) : Math.min(POOL_DEFAULTS.maxWorkers, Math.max(1, cpus - 1));
  return Math.max(1, Math.min(want, cpus));
}
function tableSab(view, cols, rows, itemsize, scales, normalize, dtype) {
  const viewBytes = rows * cols * itemsize;
  const scaleBytes = scales ? rows * 4 : 0;
  const sab = new SharedArrayBuffer(viewBytes + scaleBytes);
  new Uint8Array(sab, 0, viewBytes).set(new Uint8Array(view.buffer, view.byteOffset, viewBytes));
  if (scales) new Float32Array(sab, viewBytes, rows).set(scales);
  return {
    sab,
    meta: { dtype, rows, cols, itemsize, normalize, viewOffset: 0, viewBytes, scalesOffset: viewBytes, scalesBytes: scaleBytes }
  };
}
async function runEncodePool(opts) {
  const o = opts || {};
  const idsList = o.idsList || [];
  if (!o.sab) throw new InvalidDataError("\u7F3A\u5C11\u5171\u4EAB\u8868 SAB", { where: "worker-pool" });
  const workers = Math.max(1, Math.min(Number(o.workers || 1), idsList.length));
  const timeoutMs = Number(o.timeoutMs || 12e4);
  const workerUrl = o.workerUrl || new URL("./encode_worker.js", import.meta.url);
  const chunks = [];
  const per = Math.ceil(idsList.length / workers);
  for (let i = 0; i < idsList.length; i += per) chunks.push(idsList.slice(i, i + per));
  const pending = chunks.map((chunk) => new Promise((resolve2, reject) => {
    const w = new Worker(workerUrl, { workerData: { sab: o.sab, meta: o.meta, idsList: chunk } });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        w.terminate();
      } catch (e) {
      }
      reject(new InvalidDataError("worker \u6C60\u8D85\u65F6 " + timeoutMs + "ms", { where: "worker-pool" }));
    }, timeoutMs);
    w.once("message", (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        w.terminate();
      } catch (e) {
      }
      resolve2(msg);
    });
    w.once("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        w.terminate();
      } catch (e) {
      }
      reject(new InvalidDataError("worker \u5931\u8D25: " + String(err && err.message ? err.message : err), { where: "worker-pool" }));
    });
  }));
  const parts = await Promise.all(pending);
  const out = [];
  for (const part of parts) for (const v of part.vectors) out.push(v);
  return { vectors: out, workers, chunks: chunks.length };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/static_table.js
var DEFAULT_CACHE_ROWS = 2e4;
function copyView(Ctor, raw, offset, count) {
  const bytes = count * Ctor.BYTES_PER_ELEMENT;
  const ab = new ArrayBuffer(bytes);
  Buffer.from(ab).set(raw.subarray(offset, offset + bytes));
  return new Ctor(ab);
}
var StaticTable = class {
  constructor(modelDir, opts) {
    const o = opts || {};
    this.dir = modelDir;
    this.cfg = readJson(path4.join(modelDir, "config.json"));
    this.dim = Number(this.cfg.hidden_dim || 256);
    this.normalize = this.cfg.normalize !== false;
    this.tok = sharedTokenizer(path4.join(modelDir, "tokenizer.json"), { cache: o.cache !== false, cacheDir: o.cacheDir || "" });
    const modelPath = path4.join(modelDir, "model.safetensors");
    const meta = fileMeta(modelPath);
    if (!meta.exists) throw new InvalidDataError("\u6A21\u578B\u6587\u4EF6\u7F3A\u5931: " + modelPath, { where: "static_table" });
    const t = openTensor(modelPath);
    this.dtype = t.dtype;
    this.rows = t.rows;
    this.cols = t.cols;
    this.itemsize = t.itemsize;
    if (this.cols !== this.dim) throw new InvalidDataError("hidden_dim \u4E0E\u8868\u5217\u6570\u4E0D\u7B26: " + this.dim + " != " + this.cols, { where: "static_table" });
    this.scales = null;
    if (this.dtype === "I8" || this.dtype === "U8") {
      const sp = path4.join(modelDir, this.cfg.scales_file || "scales.f32");
      const sb = readBinary(sp);
      const arr = new Float32Array(sb.length / 4);
      Buffer.from(arr.buffer).set(sb);
      if (arr.length !== this.rows) throw new InvalidDataError("scales \u957F\u5EA6\u4E0D\u7B26", { where: "static_table" });
      this.scales = arr;
    }
    const maxBytes = Number(o.maxTableBytes || 0);
    const wantStream = String(o.streamMode || "bulk") === "stream";
    this.warnings = [];
    this.mode = wantStream ? "stream" : maxBytes > 0 && meta.bytes > maxBytes ? "stream" : "bulk";
    if (this.mode === "stream" && maxBytes > 0 && meta.bytes > maxBytes) this.warnings.push({ code: "BUDGET", detail: "\u8868 " + meta.bytes + " B \u8D85\u8FC7\u9884\u7B97 " + maxBytes + " B\uFF0C\u56DE\u9000 stream" });
    this.workerPool = String(o.workerPool || "off");
    this.workerPoolSize = Number(o.workerPoolSize || 0);
    this.workerPoolMinItems = Number(o.workerPoolMinItems || 500);
    this.workerPoolMinMs = Number(o.workerPoolMinMs || 1500);
    this.workerPoolForce = !!o.workerPoolForce;
    if (this.workerPool !== "off" && this.mode !== "bulk") {
      this.warnings.push({ code: "BUDGET", detail: "stream \u6A21\u5F0F\u4E0D\u652F\u6301 worker \u6C60\uFF0C\u56DE\u9000\u5355\u7EBF\u7A0B" });
      this.workerPool = "off";
    }
    this._shared = null;
    this.lastStats = null;
    this.closed = false;
    this.fd = -1;
    this.data = null;
    this.cache = null;
    if (this.mode === "bulk") {
      const raw = readBinary(modelPath);
      t.close();
      this.raw = raw;
      const off = t.dataOffset;
      const n = this.rows * this.cols;
      if (this.dtype === "I8") this.view = new Int8Array(raw.buffer, raw.byteOffset + off, n);
      else if (this.dtype === "U8") this.view = new Uint8Array(raw.buffer, raw.byteOffset + off, n);
      else if (this.dtype === "F16") this.view = (raw.byteOffset + off) % 2 === 0 ? new Uint16Array(raw.buffer, raw.byteOffset + off, n) : copyView(Uint16Array, raw, off, n);
      else if (this.dtype === "F32") this.view = (raw.byteOffset + off) % 4 === 0 ? new Float32Array(raw.buffer, raw.byteOffset + off, n) : copyView(Float32Array, raw, off, n);
      else throw new InvalidDataError("\u4E0D\u652F\u6301\u7684 dtype: " + this.dtype, { where: "static_table" });
    } else {
      this.fd = t.fd;
      this.tensor = t;
      this.cache = /* @__PURE__ */ new Map();
      this.cacheCap = DEFAULT_CACHE_ROWS;
    }
  }
  _rowInto(acc, id, count) {
    const cols = this.cols;
    if (this.mode === "bulk") {
      const base = id * cols;
      const scale = this.scales ? this.scales[id] : 1;
      if (this.dtype === "I8") {
        const v = this.view;
        for (let j = 0; j < cols; j += 1) acc[j] += v[base + j] * scale * count;
      } else if (this.dtype === "U8") {
        const v = this.view;
        for (let j = 0; j < cols; j += 1) acc[j] += v[base + j] * scale * count;
      } else if (this.dtype === "F16") {
        const v = this.view;
        for (let j = 0; j < cols; j += 1) acc[j] += f16ToF32(v[base + j]) * count;
      } else {
        const v = this.view;
        for (let j = 0; j < cols; j += 1) acc[j] += v[base + j] * count;
      }
      return;
    }
    let row = this.cache.get(id);
    if (!row) {
      const raw = Buffer.alloc(cols * this.itemsize);
      readAt(this.fd, raw, 0, raw.length, this.tensor.dataOffset + id * cols * this.itemsize);
      row = new Float32Array(cols);
      if (this.dtype === "I8") {
        const sc = this.scales[id];
        for (let j = 0; j < cols; j += 1) row[j] = raw.readInt8(j) * sc;
      } else if (this.dtype === "U8") {
        const sc = this.scales ? this.scales[id] : 1;
        for (let j = 0; j < cols; j += 1) row[j] = raw.readUInt8(j) * sc;
      } else if (this.dtype === "F16") {
        for (let j = 0; j < cols; j += 1) row[j] = f16ToF32(raw.readUInt16LE(j * 2));
      } else {
        for (let j = 0; j < cols; j += 1) row[j] = raw.readFloatLE(j * 4);
      }
      if (this.cache.size < this.cacheCap) this.cache.set(id, row);
    }
    for (let j = 0; j < cols; j += 1) acc[j] += row[j] * count;
  }
  _encodeInline(idsList) {
    const out = [];
    for (const ids of idsList) {
      const acc = new Float64Array(this.cols);
      if (!ids.length) {
        out.push(new Float32Array(this.cols));
        continue;
      }
      const counts = /* @__PURE__ */ new Map();
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
      for (const [id, count] of counts) this._rowInto(acc, id, count);
      for (let j = 0; j < this.cols; j += 1) acc[j] /= ids.length;
      if (this.normalize) {
        let n2 = 0;
        for (let j = 0; j < this.cols; j += 1) n2 += acc[j] * acc[j];
        const nrm = Math.sqrt(n2);
        if (nrm > 0) for (let j = 0; j < this.cols; j += 1) acc[j] /= nrm;
      }
      out.push(Float32Array.from(acc));
    }
    return out;
  }
  _shareTable() {
    if (!this._shared) this._shared = tableSab(this.view, this.cols, this.rows, this.itemsize, this.scales, this.normalize, this.dtype);
    return this._shared;
  }
  async fitTransform(texts) {
    if (this.closed) throw new InvalidDataError("static_table \u5DF2\u5173\u95ED\uFF0C\u4E0D\u80FD\u7EE7\u7EED\u7F16\u7801", { where: "static_table" });
    const list = texts || [];
    const tTok = performance.now();
    const idsList = this.tok.encodeBatch(list);
    const tokenizeMs = performance.now() - tTok;
    const stats = { mode: "inline", pool_used: false, workers: 0, items: idsList.length, tokenize_ms: Math.round(tokenizeMs), encode_ms: 0, est_ms: null };
    if (this.workerPool !== "off" && this.mode === "bulk" && idsList.length >= this.workerPoolMinItems) {
      const sampleN = Math.min(20, idsList.length);
      const tS = performance.now();
      this._encodeInline(idsList.slice(0, sampleN));
      const sampleMs = performance.now() - tS;
      const estMs = sampleMs * (idsList.length / sampleN);
      const d = poolDecision({ n: idsList.length, estimatedMs: estMs, minItems: this.workerPoolMinItems, minMs: this.workerPoolMinMs });
      stats.est_ms = Math.round(estMs);
      if (d.use || this.workerPoolForce) {
        const shared = this._shareTable();
        const tE2 = performance.now();
        const pooled = await runEncodePool({ sab: shared.sab, meta: shared.meta, idsList, workers: poolSize(this.workerPoolSize) });
        stats.mode = "pool";
        stats.pool_used = true;
        stats.workers = pooled.workers;
        stats.encode_ms = Math.round(performance.now() - tE2);
        stats.reason = this.workerPoolForce ? "force" : d.reason;
        this.lastStats = stats;
        return pooled.vectors;
      }
      stats.reason = d.reason;
    }
    const tE = performance.now();
    const out = this._encodeInline(idsList);
    stats.encode_ms = Math.round(performance.now() - tE);
    this.lastStats = stats;
    return out;
  }
  async encode(texts) {
    return (await this.fitTransform(texts)).map((v) => Array.from(v));
  }
  async transform(texts) {
    return this.fitTransform(texts);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.fd >= 0) {
      closeFile(this.fd);
      this.fd = -1;
    }
    this.raw = null;
    this.view = null;
    this.cache = null;
    this.tensor = null;
    this._shared = null;
  }
};

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/remote.js
import path5 from "node:path";
import os3 from "node:os";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/net/proxy.js
import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import { Readable } from "node:stream";
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
var PROXY_ENV = {
  http: ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"],
  https: ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
};
var NO_PROXY_ENV = ["NO_PROXY", "no_proxy"];
function envVal(env, names) {
  for (const n of names) {
    const v = env && env[n];
    if (v) return String(v);
  }
  return "";
}
function parseProxyUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).includes("://") ? String(raw) : "http://" + String(raw));
    const protocol = u.protocol === "https:" ? "https:" : "http:";
    return {
      protocol,
      host: u.hostname,
      port: Number(u.port || (protocol === "https:" ? 443 : 80)),
      auth: u.username ? decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password || "") : ""
    };
  } catch (e) {
    return null;
  }
}
function getProxyFor(targetUrl, env) {
  const e = env || process.env;
  let u;
  try {
    u = new URL(targetUrl);
  } catch (err) {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (LOCAL_HOSTS.has(u.hostname)) return null;
  const noProxy = envVal(e, NO_PROXY_ENV);
  if (noProxy) {
    const hostPort = u.hostname + ":" + (u.port || (u.protocol === "https:" ? 443 : 80));
    for (const part of noProxy.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (part === "*") return null;
      const p = part.replace(/^\./, "");
      if (u.hostname === p || u.hostname.endsWith("." + p) || hostPort === part) return null;
    }
  }
  return parseProxyUrl(envVal(e, PROXY_ENV[u.protocol === "https:" ? "https" : "http"]));
}
function proxyAuthHeader(proxy) {
  return proxy.auth ? "Basic " + Buffer.from(proxy.auth).toString("base64") : "";
}
function connectRaw(host, port, timeoutMs) {
  return new Promise((resolve2, reject) => {
    const s = net.connect({ host, port });
    const timer = timeoutMs ? setTimeout(() => {
      s.destroy();
      reject(new UnavailableError("\u4EE3\u7406\u8FDE\u63A5\u8D85\u65F6: " + host + ":" + port, { where: "proxy", retryable: true }));
    }, timeoutMs) : null;
    s.once("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new UnavailableError("\u4EE3\u7406\u8FDE\u63A5\u5931\u8D25: " + host + ":" + port + " (" + String(err && err.message ? err.message : err) + ")", { where: "proxy", retryable: true, cause: err }));
    });
    s.once("connect", () => {
      if (timer) clearTimeout(timer);
      resolve2(s);
    });
  });
}
function readHead(socket, limit) {
  return new Promise((resolve2, reject) => {
    let buf = Buffer.alloc(0);
    const max = limit || 64 * 1024;
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf("\r\n\r\n");
      if (idx < 0) {
        if (buf.length > max) {
          cleanup();
          reject(new UnavailableError("\u4EE3\u7406\u54CD\u5E94\u5934\u8FC7\u5927", { where: "proxy" }));
        }
        return;
      }
      cleanup();
      const head = buf.slice(0, idx).toString("latin1");
      const rest = buf.slice(idx + 4);
      const lines = head.split("\r\n");
      const m = /^HTTP\/(\d\.\d)\s+(\d{3})/.exec(lines[0] || "");
      const headers = {};
      for (const line of lines.slice(1)) {
        const i = line.indexOf(":");
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve2({ status: m ? Number(m[2]) : 0, headers, rest });
    }
    function onErr(err) {
      cleanup();
      reject(new UnavailableError("\u4EE3\u7406\u8BFB\u53D6\u51FA\u9519: " + String(err && err.message ? err.message : err), { where: "proxy", retryable: true, cause: err }));
    }
    function cleanup() {
      socket.removeListener("data", onData);
      socket.removeListener("error", onErr);
      socket.pause();
    }
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}
function toObjectHeaders(h) {
  const o = {};
  for (const [k, v] of Object.entries(h || {})) o[k] = v;
  return o;
}
function makeResponse(status, headers, rest, socket, finalUrl) {
  const stream = new Readable({
    read() {
    },
    destroy(err, cb) {
      try {
        socket.destroy();
      } catch (e) {
      }
      cb(err);
    }
  });
  if (rest && rest.length) stream.push(rest);
  socket.on("data", (c) => stream.push(c));
  socket.on("end", () => stream.push(null));
  socket.on("close", () => {
    try {
      stream.push(null);
    } catch (e) {
    }
  });
  const resp = new Response(Readable.toWeb(stream), { status, headers: toObjectHeaders(headers) });
  try {
    Object.defineProperty(resp, "url", { value: finalUrl, configurable: true });
  } catch (e) {
  }
  return resp;
}
async function viaTunnel(targetUrl, init, proxy, timeoutMs) {
  const u = new URL(targetUrl);
  const raw = await connectRaw(proxy.host, proxy.port, timeoutMs);
  const auth = proxyAuthHeader(proxy);
  raw.write("CONNECT " + u.hostname + ":" + (u.port || 443) + " HTTP/1.1\r\nHost: " + u.hostname + ":" + (u.port || 443) + "\r\n" + (auth ? "Proxy-Authorization: " + auth + "\r\n" : "") + "\r\n");
  const head = await readHead(raw, 64 * 1024);
  if (head.status !== 200) {
    raw.destroy();
    throw new UnavailableError("\u4EE3\u7406 CONNECT \u5931\u8D25: HTTP " + head.status, { where: "proxy", retryable: false });
  }
  const secure = tls.connect({ socket: raw, servername: u.hostname, rejectUnauthorized: true });
  await once(secure, "secureConnect");
  return { socket: secure, targetUrl, absolute: false };
}
async function viaPlainProxy(targetUrl, init, proxy, timeoutMs) {
  const socket = proxy.protocol === "https:" ? await (async () => {
    const raw = await connectRaw(proxy.host, proxy.port, timeoutMs);
    const secure = tls.connect({ socket: raw, servername: proxy.host, rejectUnauthorized: true });
    await once(secure, "secureConnect");
    return secure;
  })() : await connectRaw(proxy.host, proxy.port, timeoutMs);
  return { socket, targetUrl, absolute: true };
}
async function sendRequest(conn, init, proxy) {
  const u = new URL(conn.targetUrl);
  const method = String(init && init.method || "GET").toUpperCase();
  const headers = Object.assign({}, init && init.headers || {});
  headers.Host = u.host;
  headers.Connection = "close";
  const body = init && init.body !== void 0 && init.body !== null ? Buffer.isBuffer(init.body) ? init.body : Buffer.from(String(init.body)) : null;
  if (body) headers["Content-Length"] = String(body.length);
  const pathPart = conn.absolute ? conn.targetUrl : u.pathname + u.search;
  const lines = [method + " " + pathPart + " HTTP/1.1"];
  for (const [k, v] of Object.entries(headers)) lines.push(k + ": " + v);
  const auth = conn.absolute ? proxyAuthHeader(proxy) : "";
  if (auth && !headers["Proxy-Authorization"]) lines.push("Proxy-Authorization: " + auth);
  conn.socket.write(lines.join("\r\n") + "\r\n\r\n");
  if (body) conn.socket.write(body);
}
async function proxiedFetch(targetUrl, init, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const proxy = getProxyFor(targetUrl, env);
  if (!proxy) return fetch(targetUrl, init);
  const timeoutMs = Number(o.timeoutMs || 0);
  const signal = init && init.signal;
  let current = targetUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    if (signal && signal.aborted) throw new UnavailableError("\u8BF7\u6C42\u5DF2\u53D6\u6D88", { where: "proxy" });
    const conn = new URL(current).protocol === "https:" ? await viaTunnel(current, init, proxy, timeoutMs) : await viaPlainProxy(current, init, proxy, timeoutMs);
    await sendRequest(conn, init, proxy);
    const head = await readHead(conn.socket);
    const method = String(init && init.method || "GET").toUpperCase();
    if ([301, 302, 303, 307, 308].includes(head.status) && head.headers.location && method === "GET") {
      const next = new URL(head.headers.location, current).href;
      try {
        conn.socket.destroy();
      } catch (e) {
      }
      current = next;
      continue;
    }
    return makeResponse(head.status, head.headers, head.rest, conn.socket, current);
  }
  throw new UnavailableError("\u4EE3\u7406\u91CD\u5B9A\u5411\u8FC7\u591A: " + targetUrl, { where: "proxy" });
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/remote.js
var USAGE = { calls: 0, input_tokens: 0, ms: 0, cost_cny: 0 };
function readKey(envName, credPath) {
  const envVal2 = process.env[envName] || "";
  if (envVal2) return [envVal2, "env:" + envName];
  const cands = [];
  if (credPath) cands.push(credPath);
  cands.push(path5.join(os3.homedir(), ".dsh", ".credentials.yaml"));
  for (const p of cands) {
    if (!p || !exists(p)) continue;
    try {
      const txt = readText(p);
      const m = new RegExp(envName + "\\s*:\\s*(\\S+)").exec(txt);
      if (m) return [m[1].trim().replace(/^["']|["']$/g, "").replace(/[,;]+$/, "").trim(), "file:" + p];
    } catch (e) {
    }
  }
  return ["", "\u672A\u627E\u5230 key"];
}
function normalizeVec(v) {
  let n2 = 0;
  for (let i = 0; i < v.length; i += 1) n2 += v[i] * v[i];
  const n = Math.sqrt(n2);
  if (n > 0) for (let i = 0; i < v.length; i += 1) v[i] /= n;
  return v;
}
function priceOf(cfg, priceKey) {
  const table = cfg.embed_price_cny_per_ktok || {};
  return Number(table[priceKey] || 0);
}
async function mapLimit(items, limit, fn, signal) {
  const results = new Array(items.length);
  const n = Math.max(1, Math.min(Number(limit) || 1, items.length));
  let next = 0;
  async function worker() {
    for (; ; ) {
      throwIfAborted(signal);
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i, signal);
    }
  }
  const workers = [];
  for (let i = 0; i < n; i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}
var RemoteEmbedError = class extends Error {
};
var RemoteEmbedder = class {
  constructor(model, cfg, opts) {
    const o = opts || {};
    this.model = model;
    this.name = "remote:" + model;
    this.url = cfg.embed_remote_url || "https://api.siliconflow.cn/v1/embeddings";
    this.maxChars = Number(cfg.embed_max_chars || 8e3);
    this.batch = Math.max(1, Number(cfg.embed_batch || 16));
    this.timeout = Number(cfg.embed_timeout || 60);
    this.dimensions = Number(cfg.embed_dimensions || 0);
    this.concurrency = Math.max(1, Math.min(32, Number(cfg.embed_concurrency || 4)));
    this.retries = Math.max(0, Math.min(5, Number(cfg.embed_retries === void 0 ? 2 : cfg.embed_retries)));
    this.signal = o.signal || null;
    this.priceKey = o.priceKey || model;
    this.pricePerKtok = priceOf(cfg, this.priceKey);
    this._sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this._fetch = o.fetch || ((u, i) => proxiedFetch(u, i));
    if (o.key) {
      this.key = o.key;
      this.keySource = "explicit";
    } else {
      const envName = cfg.embed_api_key_env || "SILICONFLOW_API_KEY";
      const [k, src] = readKey(envName, cfg.embed_cred_path || "");
      this.key = k;
      this.keySource = src;
    }
    if (!this.key) throw new RemoteEmbedError("\u7F3A\u5C11 API key\uFF08env " + (cfg.embed_api_key_env || "SILICONFLOW_API_KEY") + " \u6216 ~/.dsh/.credentials.yaml refs\uFF09");
  }
  _backoff(attempt, retryAfter) {
    if (retryAfter !== null && retryAfter !== void 0) return Number(retryAfter);
    return 200 * Math.pow(2, attempt);
  }
  async _postOnce(inputs) {
    const body = { model: this.model, input: inputs, encoding_format: "float" };
    if (this.dimensions) body.dimensions = this.dimensions;
    const t0 = Date.now();
    let resp;
    try {
      resp = await this._fetch(this.url, {
        method: "POST",
        headers: { "Authorization": "Bearer " + this.key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: withTimeout(this.signal, this.timeout * 1e3)
      });
    } catch (exc) {
      const err = new RemoteEmbedError("\u8BF7\u6C42\u5931\u8D25(" + this.model + "): " + String(exc && exc.message ? exc.message : exc).slice(0, 160));
      err.retryable = true;
      throw err;
    }
    USAGE.ms += Date.now() - t0;
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      const err = new RemoteEmbedError("HTTP " + resp.status + " " + String(txt).slice(0, 120));
      err.retryable = resp.status === 429 || resp.status >= 500;
      const ra = resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("retry-after") : null;
      err.retryAfter = ra === null || ra === void 0 ? null : Number(ra) * 1e3;
      throw err;
    }
    const data = await resp.json();
    USAGE.calls += 1;
    const u = data.usage || {};
    const tokens2 = Number(u.prompt_tokens || u.total_tokens || 0);
    USAGE.input_tokens += tokens2;
    USAGE.cost_cny += tokens2 / 1e3 * this.pricePerKtok;
    let items = data.data || [];
    if (items.length !== inputs.length) throw new RemoteEmbedError("\u8FD4\u56DE\u6761\u6570\u4E0D\u7B26: " + items.length + " != " + inputs.length);
    if (items.every((it) => it.index !== void 0)) items = items.slice().sort((a, b) => a.index - b.index);
    return items.map((it) => Float32Array.from(it.embedding));
  }
  async _post(inputs) {
    let lastErr = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      throwIfAborted(this.signal);
      try {
        return await this._postOnce(inputs);
      } catch (err) {
        lastErr = err;
        if (!err.retryable || attempt >= this.retries) break;
        await this._sleep(this._backoff(attempt, err.retryAfter));
      }
    }
    throw lastErr instanceof RemoteEmbedError ? lastErr : new RemoteEmbedError("\u8BF7\u6C42\u5931\u8D25(" + this.model + "): " + String(lastErr && lastErr.message ? lastErr.message : lastErr).slice(0, 160));
  }
  async fitTransform(texts) {
    const cleaned = texts.map((t) => {
      let s = String(t);
      if (!s.trim()) s = " ";
      return s.slice(0, this.maxChars);
    });
    if (!cleaned.length) return [];
    const batches = [];
    for (let i = 0; i < cleaned.length; i += this.batch) batches.push(cleaned.slice(i, i + this.batch));
    const results = await mapLimit(batches, this.concurrency, (b) => this._post(b), this.signal);
    return results.flat().map((v) => normalizeVec(v));
  }
  async encode(texts) {
    return (await this.fitTransform(texts)).map((v) => Array.from(v));
  }
  async transform(texts) {
    return this.fitTransform(texts);
  }
  close() {
  }
};

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/attempt.js
var REASON_CODES = Object.freeze(["no-key", "http-error", "timeout", "invalid-response", "all-down", "partial-fill", "unknown"]);
function classifyReason(err) {
  if (err && typeof err.reasonCode === "string" && REASON_CODES.includes(err.reasonCode)) return err.reasonCode;
  const msg = String(err && err.message || err || "");
  if (err && err.name === "AbortError") return "timeout";
  if (/timeout|timed out|aborted|ETIMEDOUT|超时/i.test(msg)) return "timeout";
  if (/缺少 API key|api key|未设.+KEY|key 缺失|未找到 key/i.test(msg)) return "no-key";
  if (/HTTP \d+|status [45]\d\d|429|5\d\d/.test(msg)) return "http-error";
  if (/条数不符|非法|invalid|缺少.+概率|no completion/i.test(msg)) return "invalid-response";
  if (/全部不可用|全部失败|all-down/i.test(msg)) return "all-down";
  return "unknown";
}
function errText(err) {
  return String(err && err.message || err || "").slice(0, 160);
}
async function attemptSequence(steps) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) {
    const e2 = new RemoteEmbedError("attempt: \u6CA1\u6709\u53EF\u7528\u6863\u4F4D");
    e2.reasonCode = "all-down";
    e2.attempts = [];
    throw e2;
  }
  const attempts = [];
  const failed = /* @__PURE__ */ new Set();
  const t0 = Date.now();
  let lastReason = null;
  for (; ; ) {
    const step = list.find((s) => !failed.has(s.tier));
    if (!step) break;
    const b0 = Date.now();
    let inst;
    try {
      inst = await step.build();
    } catch (err) {
      failed.add(step.tier);
      const rc = classifyReason(err);
      lastReason = rc;
      attempts.push({ tier: step.tier, phase: "build", ok: false, reasonCode: rc, error: errText(err), ms: Date.now() - b0 });
      continue;
    }
    attempts.push({ tier: step.tier, phase: "build", ok: true, ms: Date.now() - b0 });
    const i0 = Date.now();
    try {
      const value = await step.infer(inst);
      const degraded = attempts.some((a) => !a.ok);
      return { value, tier: step.tier, attempts, degraded, reasonCode: degraded ? lastReason : null, cost: { ms: Date.now() - t0 }, instance: inst };
    } catch (err) {
      failed.add(step.tier);
      const rc = classifyReason(err);
      lastReason = rc;
      attempts.push({ tier: step.tier, phase: "infer", ok: false, reasonCode: rc, error: errText(err), ms: Date.now() - i0 });
    }
  }
  const e = new RemoteEmbedError("embedding \u94FE\u5168\u90E8\u4E0D\u53EF\u7528: " + JSON.stringify(attempts).slice(0, 300));
  e.reasonCode = "all-down";
  e.attempts = attempts;
  throw e;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/chain.js
var ChainEmbedder = class {
  constructor(builders, opts) {
    this.builders = builders;
    this.signal = opts && opts.signal || null;
    this.chosen = null;
    this.instance = null;
    this.label = null;
    this.name = "chain";
    this.failed = /* @__PURE__ */ new Set();
    this.attempts = [];
    this._degraded = false;
    this._reasonCode = null;
    this._cost = null;
  }
  _record(res) {
    for (const a of res.attempts) this.attempts.push(a);
    for (const a of res.attempts) if (!a.ok) this.failed.add(a.tier);
    this.chosen = res.tier;
    this.label = res.tier;
    this.instance = res.instance;
    this.name = "chain:" + res.tier;
    this._degraded = res.degraded;
    this._reasonCode = res.reasonCode;
    this._cost = res.cost;
    return res.value;
  }
  async _run(texts) {
    throwIfAborted(this.signal);
    const steps = this.builders.filter(([label]) => !this.failed.has(label)).map(([label, build]) => ({
      tier: label,
      build,
      infer: (inst) => {
        throwIfAborted(this.signal);
        return inst.fitTransform(texts);
      }
    }));
    try {
      return this._record(await attemptSequence(steps));
    } catch (err) {
      if (err && Array.isArray(err.attempts)) {
        for (const a of err.attempts) {
          this.attempts.push(a);
          if (!a.ok) this.failed.add(a.tier);
        }
      }
      this._degraded = true;
      this._reasonCode = err && err.reasonCode ? err.reasonCode : classifyReason(err);
      throw err;
    }
  }
  async fitTransform(texts) {
    throwIfAborted(this.signal);
    if (this.instance) {
      const inst = this.instance;
      const label = this.label;
      const i0 = Date.now();
      try {
        return await inst.fitTransform(texts);
      } catch (err) {
        this.failed.add(label);
        this.attempts.push({ tier: label, phase: "infer", ok: false, reasonCode: classifyReason(err), error: String(err && err.message ? err.message : err).slice(0, 160), ms: Date.now() - i0 });
        this.chosen = null;
        this.instance = null;
        this.label = null;
        this._degraded = true;
        this._reasonCode = classifyReason(err);
      }
    }
    return this._run(texts);
  }
  async encode(texts) {
    return (await this.fitTransform(texts)).map((v) => Array.from(v));
  }
  async transform(texts) {
    return this.fitTransform(texts);
  }
  degrade() {
    return { tier: this.chosen, attempts: this.attempts, degraded: !!this._degraded, reasonCode: this._reasonCode || null, cost: this._cost || { ms: 0 } };
  }
  close() {
    if (this.instance && typeof this.instance.close === "function") this.instance.close();
  }
};

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/registry.js
import path7 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/registry.js
import path6 from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = path6.dirname(fileURLToPath(import.meta.url));
var REGISTRY_SCHEMA_VERSION = 1;
var KIND = /* @__PURE__ */ new Set(["source", "derived"]);
var ORIGIN = /* @__PURE__ */ new Set(["hf", "repo"]);
var DTYPES = /* @__PURE__ */ new Set(["F32", "F16", "I8"]);
var TOP_KEYS = /* @__PURE__ */ new Set(["schemaVersion", "modelsRoot", "recipes", "artifacts", "models", "tiers", "calibration"]);
var ART_KEYS = /* @__PURE__ */ new Set(["id", "kind", "origin", "repo", "target", "files", "recipe", "base", "proj", "manifest", "description", "optional"]);
var FILE_KEYS = /* @__PURE__ */ new Set(["path", "sha256", "bytes", "lfs"]);
var MANIFEST_KEYS = /* @__PURE__ */ new Set(["dtype", "dim", "rows", "tokenizerSha", "builderVer", "scalesDtype", "projSha", "reproducibility"]);
var REPRODUCIBILITY = /* @__PURE__ */ new Set(["bytes", "numeric"]);
var RECIPE_KEYS = /* @__PURE__ */ new Set(["builderVer", "description", "params"]);
var CALIBRATION_KEYS = /* @__PURE__ */ new Set(["version", "samplesSha", "n", "quantile", "margin", "floors", "generatedAt"]);
var MODEL_KEYS = /* @__PURE__ */ new Set(["id", "provider", "compute", "overrideField", "artifactRef", "tokenizerRef", "limits", "floors", "transport", "price"]);
var TIER_KEYS = /* @__PURE__ */ new Set(["id", "modelRef", "floorPreset"]);
var COMPUTE = /* @__PURE__ */ new Set(["api", "local-static"]);
var SHA_RE = /^[0-9a-f]{64}$/;
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
function bad2(msg) {
  return new InvalidDataError("registry: " + msg, { where: "models/registry.json" });
}
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function unknownKeys(obj, allowed, ctx) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) throw bad2("\u672A\u77E5\u5B57\u6BB5 " + ctx + "." + k);
}
function relSafe(p) {
  return typeof p === "string" && p.length > 0 && !path6.isAbsolute(p) && !p.split(/[\\/]/).includes("..");
}
function assertSha(v, ctx) {
  if (typeof v !== "string" || !SHA_RE.test(v)) throw bad2("sha256 \u975E\u6CD5: " + ctx);
}
function assertPosInt(v, ctx) {
  if (!Number.isInteger(v) || v <= 0) throw bad2("\u5FC5\u987B\u4E3A\u6B63\u6574\u6570: " + ctx);
}
function validateFiles(files, ctx) {
  if (!Array.isArray(files) || !files.length) throw bad2(ctx + ".files \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
  const seen = /* @__PURE__ */ new Set();
  for (const f of files) {
    if (!isObj(f)) throw bad2(ctx + ".files \u5143\u7D20\u5FC5\u987B\u662F\u5BF9\u8C61");
    unknownKeys(f, FILE_KEYS, ctx + ".files[]");
    if (!relSafe(f.path)) throw bad2(ctx + ".files[].path \u5FC5\u987B\u662F\u76F8\u5BF9\u8DEF\u5F84\u4E14\u4E0D\u542B ..");
    if (seen.has(f.path)) throw bad2(ctx + ".files \u8DEF\u5F84\u91CD\u590D: " + f.path);
    seen.add(f.path);
    assertSha(f.sha256, ctx + ".files[" + f.path + "].sha256");
    assertPosInt(f.bytes, ctx + ".files[" + f.path + "].bytes");
    if (f.lfs !== void 0 && typeof f.lfs !== "boolean") throw bad2(ctx + ".files[].lfs \u5FC5\u987B\u662F\u5E03\u5C14");
  }
}
function validateManifest(m, ctx) {
  if (!isObj(m)) throw bad2(ctx + ".manifest \u5FC5\u987B\u662F\u5BF9\u8C61");
  unknownKeys(m, MANIFEST_KEYS, ctx + ".manifest");
  if (!DTYPES.has(m.dtype)) throw bad2(ctx + ".manifest.dtype \u975E\u6CD5: " + m.dtype);
  assertPosInt(m.dim, ctx + ".manifest.dim");
  assertPosInt(m.rows, ctx + ".manifest.rows");
  assertSha(m.tokenizerSha, ctx + ".manifest.tokenizerSha");
  assertPosInt(m.builderVer, ctx + ".manifest.builderVer");
  if (m.scalesDtype !== void 0 && !DTYPES.has(m.scalesDtype)) throw bad2(ctx + ".manifest.scalesDtype \u975E\u6CD5");
  if (m.projSha !== void 0) assertSha(m.projSha, ctx + ".manifest.projSha");
  if (m.reproducibility !== void 0 && !REPRODUCIBILITY.has(m.reproducibility)) throw bad2(ctx + ".manifest.reproducibility \u975E\u6CD5");
}
function validateRecipes(recipes) {
  if (!isObj(recipes) || !Object.keys(recipes).length) throw bad2("recipes \u5FC5\u987B\u662F\u975E\u7A7A\u5BF9\u8C61");
  for (const [id, r] of Object.entries(recipes)) {
    if (!isObj(r)) throw bad2("recipes." + id + " \u5FC5\u987B\u662F\u5BF9\u8C61");
    unknownKeys(r, RECIPE_KEYS, "recipes." + id);
    assertPosInt(r.builderVer, "recipes." + id + ".builderVer");
    if (r.description !== void 0 && typeof r.description !== "string") throw bad2("recipes." + id + ".description \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    if (r.params !== void 0 && !isObj(r.params)) throw bad2("recipes." + id + ".params \u5FC5\u987B\u662F\u5BF9\u8C61");
  }
}
function validateFloors(floors, ctx) {
  if (!isObj(floors)) throw bad2(ctx + ".floors \u5FC5\u987B\u662F\u5BF9\u8C61");
  for (const k of ["body", "summary"]) if (typeof floors[k] !== "number" || !Number.isFinite(floors[k])) throw bad2(ctx + ".floors." + k + " \u5FC5\u987B\u662F\u6709\u9650\u6570");
}
function validateCalibration(cal, tierIds) {
  if (cal === null || cal === void 0) return;
  if (!isObj(cal)) throw bad2("calibration \u5FC5\u987B\u662F\u5BF9\u8C61\u6216 null");
  unknownKeys(cal, CALIBRATION_KEYS, "calibration");
  if (!Number.isInteger(cal.version) || cal.version < 1) throw bad2("calibration.version \u5FC5\u987B\u662F\u6B63\u6574\u6570");
  assertSha(cal.samplesSha, "calibration.samplesSha");
  if (!Number.isInteger(cal.n) || cal.n <= 0) throw bad2("calibration.n \u5FC5\u987B\u662F\u6B63\u6574\u6570");
  if (cal.quantile !== void 0 && typeof cal.quantile !== "number") throw bad2("calibration.quantile \u5FC5\u987B\u662F\u6570\u503C");
  if (cal.margin !== void 0 && typeof cal.margin !== "number") throw bad2("calibration.margin \u5FC5\u987B\u662F\u6570\u503C");
  if (!isObj(cal.floors) || !Object.keys(cal.floors).length) throw bad2("calibration.floors \u5FC5\u987B\u662F\u975E\u7A7A\u5BF9\u8C61");
  for (const [k, v] of Object.entries(cal.floors)) {
    if (!tierIds.has(k)) throw bad2("calibration.floors \u672A\u77E5 tier: " + k);
    validateFloors(v, "calibration.floors." + k);
  }
}
function validateModelsTiers(reg) {
  if (!Array.isArray(reg.models)) throw bad2("models \u5FC5\u987B\u662F\u6570\u7EC4\uFF08G4 \u5206\u533A\uFF09");
  if (!Array.isArray(reg.tiers)) throw bad2("tiers \u5FC5\u987B\u662F\u6570\u7EC4\uFF08G4 \u5206\u533A\uFF09");
  const ids = /* @__PURE__ */ new Set();
  for (const m of reg.models) {
    if (!isObj(m)) throw bad2("models \u5143\u7D20\u5FC5\u987B\u662F\u5BF9\u8C61");
    unknownKeys(m, MODEL_KEYS, "models[]");
    if (typeof m.id !== "string" || !m.id) throw bad2("models[].id \u975E\u6CD5");
    if (ids.has(m.id)) throw bad2("models[].id \u91CD\u590D: " + m.id);
    ids.add(m.id);
    if (typeof m.provider !== "string" || !m.provider) throw bad2(m.id + ".provider \u7F3A\u5931");
    if (!COMPUTE.has(m.compute)) throw bad2(m.id + ".compute \u975E\u6CD5: " + m.compute);
    if (typeof m.overrideField !== "string" || !m.overrideField) throw bad2(m.id + ".overrideField \u7F3A\u5931");
    validateFloors(m.floors, m.id);
    if (m.compute === "api") {
      if (!isObj(m.transport) || m.transport.kind !== "openai-embeddings" || typeof m.transport.model !== "string" || !m.transport.model) throw bad2(m.id + ".transport \u975E\u6CD5\uFF08api \u9700 kind=openai-embeddings + model\uFF09");
    } else if (m.artifactRef !== void 0) {
      if (typeof m.artifactRef !== "string" || !reg.artifacts.some((a) => a.id === m.artifactRef)) throw bad2(m.id + ".artifactRef \u4E0D\u5B58\u5728: " + m.artifactRef);
    }
  }
  const tierIds = /* @__PURE__ */ new Set();
  for (const t of reg.tiers) {
    if (!isObj(t)) throw bad2("tiers \u5143\u7D20\u5FC5\u987B\u662F\u5BF9\u8C61");
    unknownKeys(t, TIER_KEYS, "tiers[]");
    if (typeof t.id !== "string" || !t.id) throw bad2("tiers[].id \u975E\u6CD5");
    if (tierIds.has(t.id)) throw bad2("tiers[].id \u91CD\u590D: " + t.id);
    tierIds.add(t.id);
    if (typeof t.modelRef !== "string" || !ids.has(t.modelRef)) throw bad2(t.id + ".modelRef \u4E0D\u5B58\u5728: " + t.modelRef);
    if (typeof t.floorPreset !== "string" || !t.floorPreset) throw bad2(t.id + ".floorPreset \u7F3A\u5931");
  }
  validateCalibration(reg.calibration, tierIds);
}
function validateRegistry(reg) {
  if (!isObj(reg)) throw bad2("\u9876\u5C42\u5FC5\u987B\u662F\u5BF9\u8C61");
  unknownKeys(reg, TOP_KEYS, "$");
  if (reg.schemaVersion !== REGISTRY_SCHEMA_VERSION) throw bad2("schemaVersion \u5FC5\u987B\u4E3A " + REGISTRY_SCHEMA_VERSION);
  if (typeof reg.modelsRoot !== "string" || !relSafe(reg.modelsRoot)) throw bad2("modelsRoot \u5FC5\u987B\u662F\u76F8\u5BF9\u8DEF\u5F84\u4E14\u4E0D\u542B ..");
  validateRecipes(reg.recipes);
  if (!Array.isArray(reg.artifacts) || !reg.artifacts.length) throw bad2("artifacts \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
  const ids = /* @__PURE__ */ new Set();
  for (const a of reg.artifacts) {
    if (!isObj(a)) throw bad2("artifacts \u5143\u7D20\u5FC5\u987B\u662F\u5BF9\u8C61");
    unknownKeys(a, ART_KEYS, "artifacts[]");
    if (typeof a.id !== "string" || !ID_RE.test(a.id)) throw bad2("artifact.id \u975E\u6CD5: " + a.id);
    if (ids.has(a.id)) throw bad2("artifact.id \u91CD\u590D: " + a.id);
    ids.add(a.id);
    if (!KIND.has(a.kind)) throw bad2(a.id + ".kind \u975E\u6CD5: " + a.kind);
    if (!relSafe(a.target)) throw bad2(a.id + ".target \u5FC5\u987B\u662F\u76F8\u5BF9\u8DEF\u5F84\u4E14\u4E0D\u542B ..");
    validateFiles(a.files, a.id);
    if (a.optional !== void 0 && typeof a.optional !== "boolean") throw bad2(a.id + ".optional \u5FC5\u987B\u662F\u5E03\u5C14");
    if (a.kind === "source") {
      if (!ORIGIN.has(a.origin)) throw bad2(a.id + ".origin \u5FC5\u987B\u4E3A hf|repo");
      if (a.origin === "hf" && (typeof a.repo !== "string" || !a.repo)) throw bad2(a.id + ".repo \u7F3A\u5931\uFF08origin=hf\uFF09");
      if (a.origin === "repo" && a.repo !== void 0) throw bad2(a.id + ".repo \u4E0D\u5E94\u51FA\u73B0\u5728 origin=repo");
      if (a.recipe !== void 0 || a.base !== void 0 || a.proj !== void 0 || a.manifest !== void 0) throw bad2(a.id + ": source \u4E0D\u5E94\u5E26 recipe/base/proj/manifest");
    } else {
      if (typeof a.recipe !== "string" || !Object.prototype.hasOwnProperty.call(reg.recipes, a.recipe)) throw bad2(a.id + ".recipe \u672A\u5B9A\u4E49: " + a.recipe);
      if (typeof a.base !== "string" || !a.base) throw bad2(a.id + ".base \u7F3A\u5931");
      if (a.origin !== void 0 || a.repo !== void 0) throw bad2(a.id + ": derived \u4E0D\u5E94\u5E26 origin/repo");
      validateManifest(a.manifest, a.id);
      if (a.proj !== void 0 && (typeof a.proj !== "string" || !a.proj)) throw bad2(a.id + ".proj \u975E\u6CD5");
    }
  }
  for (const a of reg.artifacts) {
    if (a.kind !== "derived") continue;
    if (!ids.has(a.base)) throw bad2(a.id + ".base \u4E0D\u5B58\u5728: " + a.base);
    if (a.proj !== void 0 && !ids.has(a.proj)) throw bad2(a.id + ".proj \u4E0D\u5B58\u5728: " + a.proj);
  }
  validateModelsTiers(reg);
  if (reg.calibration !== void 0 && reg.calibration !== null && !isObj(reg.calibration)) throw bad2("calibration \u5FC5\u987B\u662F\u5BF9\u8C61\u6216 null\uFF08G4 \u5206\u533A\uFF09");
  return reg;
}
function defaultRegistryPath() {
  return path6.join(__dirname, "..", "..", "models", "registry.json");
}
function loadRegistry(file) {
  const f = file || defaultRegistryPath();
  const reg = readJson(f);
  return { file: f, registry: validateRegistry(reg) };
}
function modelsRootOf(registry, registryFile, override) {
  const base = override || process.env.SKILL_MERGE_MODELS_ROOT;
  if (base) return path6.resolve(base);
  return path6.resolve(path6.dirname(registryFile || defaultRegistryPath()), "..", registry.modelsRoot);
}
function artifactById(registry, id) {
  const a = registry.artifacts.find((x) => x.id === id);
  if (!a) throw bad2("\u672A\u77E5 artifact: " + id);
  return a;
}
function artifactDir(registry, registryFile, id, override) {
  const a = artifactById(registry, id);
  const rootDir = modelsRootOf(registry, registryFile, override);
  const dir = path6.resolve(rootDir, a.target);
  const prefix = rootDir.endsWith(path6.sep) ? rootDir : rootDir + path6.sep;
  if (dir !== rootDir && !dir.startsWith(prefix)) throw bad2("artifact \u8DEF\u5F84\u8D8A\u754C: " + id);
  return dir;
}
function verifyArtifact(registry, registryFile, id, opts) {
  const o = opts || {};
  const a = artifactById(registry, id);
  const dir = artifactDir(registry, registryFile, id, o.rootDir);
  const numeric = !!(a.manifest && a.manifest.reproducibility === "numeric");
  const missing = [];
  const mismatched = [];
  for (const f of a.files) {
    const abs = path6.join(dir, f.path);
    const meta = fileMeta(abs);
    if (!meta.exists) {
      missing.push(f.path);
      continue;
    }
    if (meta.bytes !== f.bytes) {
      mismatched.push({ path: f.path, reason: "size", expected: f.bytes, actual: meta.bytes });
      continue;
    }
    if (o.hash !== false && !numeric) {
      const h = hashFile(abs);
      if (h !== f.sha256) mismatched.push({ path: f.path, reason: "sha256" });
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, id, dir, missing, mismatched };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/provider.js
var KNOWN_EMBED_BACKENDS = Object.freeze(["chain", "local", "remote", "onnx"]);
function assertKnownBackend(cfg) {
  const backend = String(cfg && cfg.embed_backend || "local");
  if (!KNOWN_EMBED_BACKENDS.includes(backend)) {
    throw new InvalidDataError("\u672A\u77E5 embed_backend: " + backend + "\uFF08\u53EF\u9009: " + KNOWN_EMBED_BACKENDS.join("/") + "\uFF09", { where: "embed-provider" });
  }
  return backend;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/registry.js
var _cached = null;
var CALIBRATED_NAME = "registry.calibrated.json";
function attachCalibration(loaded) {
  const dir = path7.dirname(loaded.file);
  const calFile = path7.join(dir, CALIBRATED_NAME);
  if (!exists(calFile)) return loaded.registry;
  let doc;
  try {
    doc = readJson(calFile);
  } catch (err) {
    throw new InvalidDataError("\u6821\u51C6\u4EA7\u7269\u65E0\u6CD5\u89E3\u6790: " + calFile + "\uFF08" + String(err && err.message ? err.message : err) + "\uFF09", { where: "embed-registry" });
  }
  if (!doc || !doc.calibration) throw new InvalidDataError("\u6821\u51C6\u4EA7\u7269\u7F3A\u5C11 calibration \u5B57\u6BB5: " + calFile, { where: "embed-registry" });
  const tierIds = new Set((loaded.registry.tiers || []).map((t) => t.id));
  validateCalibration(doc.calibration, tierIds);
  loaded.registry.calibration = doc.calibration;
  return loaded.registry;
}
function embedRegistry(file) {
  if (file) return attachCalibration(loadRegistry(file));
  if (!_cached) _cached = attachCalibration(loadRegistry());
  return _cached;
}
function modelMap(registry) {
  return new Map(registry.models.map((m) => [m.id, m]));
}
function resolveConfiguredDir(cfg, field) {
  const explicit = String(cfg && cfg[field] || "").trim();
  if (explicit) return explicit;
  const reg = embedRegistry();
  const model = (reg.models || []).find((m) => m.overrideField === field && m.artifactRef);
  if (!model) return "";
  return artifactDir(reg, defaultRegistryPath(), model.artifactRef, cfg && cfg.models_dir ? cfg.models_dir : void 0);
}
function resolveChain(cfg, registry) {
  const r = registry || embedRegistry();
  const models = modelMap(r);
  const mode = cfg.embed_backend || "local";
  if (!KNOWN_EMBED_BACKENDS.includes(mode)) throw new InvalidDataError("\u672A\u77E5 embed_backend: " + mode + "\uFF08\u53EF\u9009: " + KNOWN_EMBED_BACKENDS.join("/") + "\uFF09", { where: "embed-registry" });
  let tiers = r.tiers;
  if (mode === "remote") tiers = tiers.filter((t) => models.get(t.modelRef).compute === "api").slice(0, 1);
  else if (mode === "local") tiers = tiers.filter((t) => models.get(t.modelRef).compute === "local-static").slice(0, 1);
  if (!tiers.length) throw new InvalidDataError("registry.tiers \u4E3A\u7A7A\u6216\u4E0D\u6EE1\u8DB3 backend=" + mode, { where: "embed-registry" });
  return {
    mode,
    tiers: tiers.map((t) => {
      const m = models.get(t.modelRef);
      const kind = m.compute === "api" ? "remote" : "local";
      return {
        tier: t.id,
        modelId: m.id,
        floorPreset: t.floorPreset,
        kind,
        provider: m.provider,
        overrideField: m.overrideField,
        artifactRef: m.artifactRef || null,
        floors: { body: m.floors.body, summary: m.floors.summary },
        effectiveModel: kind === "remote" ? cfg[m.overrideField] || m.transport.model : null
      };
    })
  };
}
function resolveFloorPreset(cfg, registry, tierLabel) {
  const r = registry || embedRegistry();
  const presets = cfg.embed_floor_presets || {};
  const t = (r.tiers || []).find((x) => x.id === tierLabel);
  let preset = null;
  let source = null;
  if (presets[tierLabel]) {
    preset = presets[tierLabel];
    source = "cfg:tier";
  }
  let registryFloors = null;
  if (t) {
    const m = r.models.find((x) => x.id === t.modelRef);
    if (m && m.floors) registryFloors = m.floors;
    if (!preset && presets[t.floorPreset]) {
      preset = presets[t.floorPreset];
      source = "cfg:preset";
    }
  }
  const calibrationFloors = r.calibration && r.calibration.floors ? r.calibration.floors[tierLabel] : null;
  if (!preset && calibrationFloors) {
    preset = calibrationFloors;
    source = "calibration";
  }
  if (!preset && registryFloors) {
    preset = registryFloors;
    source = "registry";
  }
  if (!preset) {
    preset = presets["local"] || {};
    source = presets["local"] ? "cfg:local" : "cfg:default";
  }
  return {
    body_core: Number(preset.body !== void 0 ? preset.body : cfg.semantic_body_floor),
    summary: Number(preset.summary !== void 0 ? preset.summary : cfg.semantic_summary_floor),
    source
  };
}
function floorsFor(cfg, registry, tierLabel) {
  const p = resolveFloorPreset(cfg, registry, tierLabel);
  return { body_core: p.body_core, summary: p.summary };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/onnx.js
import path8 from "node:path";
var ONNX_ARTIFACT = "onnx:e5-small";
var INSTALL_HINT = "embed_backend=onnx \u9700\u8981\u53EF\u9009\u4F9D\u8D56 onnxruntime-node\uFF08npm install onnxruntime-node\uFF09\u4E0E ONNX \u6A21\u578B\uFF08skill-merge models ensure --include onnx\uFF09";
var probeCache = null;
async function probeOnnx() {
  if (probeCache) return probeCache;
  try {
    const mod = await import("onnxruntime-node");
    probeCache = { available: true, version: mod && mod.env && mod.env.versions && mod.env.versions.common || "unknown" };
  } catch (err) {
    probeCache = { available: false, error: String(err && err.message ? err.message : err) };
  }
  return probeCache;
}
var OnnxEmbedder = class {
  constructor(cfg) {
    this.cfg = cfg || {};
    this.name = "onnx:e5-small";
    this.maxTokens = Math.max(8, Number(this.cfg.onnx_max_tokens || 512));
    this.batch = Math.max(1, Number(this.cfg.onnx_batch || 8));
    this.dir = null;
    this.session = null;
    this.tok = null;
    this.ort = null;
  }
  _resolveDir() {
    const cfg = this.cfg;
    if (cfg.onnx_model_dir) return cfg.onnx_model_dir;
    const loaded = loadRegistry();
    return artifactDir(loaded.registry, loaded.file, ONNX_ARTIFACT, cfg.models_dir || void 0);
  }
  async _ensure() {
    if (this.session) return;
    const probe2 = await probeOnnx();
    if (!probe2.available) throw new UnavailableError(INSTALL_HINT + "\uFF08" + String(probe2.error).slice(0, 160) + "\uFF09", { where: "embed-onnx" });
    const dir = this._resolveDir();
    this.dir = dir;
    const modelPath = path8.join(dir, "onnx", "model_quantized.onnx");
    const tokPath = path8.join(dir, "tokenizer.json");
    if (!exists(modelPath) || !exists(tokPath)) {
      throw new UnavailableError("\u7F3A\u5C11 ONNX \u6A21\u578B\u6587\u4EF6: " + dir + "\n\u8BF7\u5148\u4E0B\u8F7D: skill-merge models ensure --include onnx", { where: "embed-onnx" });
    }
    const ort = await import("onnxruntime-node");
    this.ort = ort;
    this.session = await ort.InferenceSession.create(modelPath);
    this.tok = new Tokenizer(tokPath, { cache: false });
    this.hasMask = Array.isArray(this.session.inputNames) && this.session.inputNames.includes("attention_mask");
  }
  async _runBatch(texts) {
    const idsList = this.tok.encodeBatch(texts || []).map((ids2) => ids2.slice(0, this.maxTokens));
    const maxLen = Math.max(1, ...idsList.map((x) => x.length));
    const n = idsList.length;
    const ids = new BigInt64Array(n * maxLen);
    const mask = new BigInt64Array(n * maxLen);
    for (let i = 0; i < n; i += 1) {
      const row = idsList[i];
      for (let j = 0; j < maxLen; j += 1) {
        ids[i * maxLen + j] = BigInt(j < row.length ? row[j] : 0);
        mask[i * maxLen + j] = BigInt(j < row.length ? 1 : 0);
      }
    }
    const feeds = { input_ids: new this.ort.Tensor("int64", ids, [n, maxLen]) };
    if (this.hasMask) feeds.attention_mask = new this.ort.Tensor("int64", mask, [n, maxLen]);
    const results = await this.session.run(feeds);
    const outName = this.session.outputNames && this.session.outputNames[0] || Object.keys(results)[0];
    const hidden = results[outName];
    const dims = hidden.dims;
    if (!dims || dims.length !== 3) throw new InvalidDataError("ONNX \u8F93\u51FA\u7EF4\u5EA6\u975E\u6CD5: " + JSON.stringify(dims), { where: "embed-onnx" });
    const seq = dims[1];
    const dim = dims[2];
    const data = hidden.data;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const acc = new Float64Array(dim);
      let count = 0;
      for (let j = 0; j < seq; j += 1) {
        if (!mask[i * maxLen + j]) continue;
        count += 1;
        for (let d = 0; d < dim; d += 1) acc[d] += Number(data[(i * seq + j) * dim + d]);
      }
      if (!count) count = 1;
      let n2 = 0;
      for (let d = 0; d < dim; d += 1) {
        acc[d] /= count;
        n2 += acc[d] * acc[d];
      }
      const nrm = Math.sqrt(n2);
      if (nrm > 0) for (let d = 0; d < dim; d += 1) acc[d] /= nrm;
      out.push(Float32Array.from(acc));
    }
    return out;
  }
  async fitTransform(texts) {
    await this._ensure();
    const list = texts || [];
    const out = [];
    for (let i = 0; i < list.length; i += this.batch) out.push(...await this._runBatch(list.slice(i, i + this.batch)));
    return out;
  }
  async encode(texts) {
    return (await this.fitTransform(texts)).map((v) => Array.from(v));
  }
  async transform(texts) {
    return this.fitTransform(texts);
  }
  close() {
    if (this.session && typeof this.session.release === "function") this.session.release();
    this.session = null;
  }
};

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/screening/contract.js
var VIAS = Object.freeze(["summary", "body", "both"]);
function viaFromNets(nets) {
  const set = new Set(Array.isArray(nets) ? nets : []);
  if (set.has("summary") && set.has("body")) return "both";
  if (set.has("summary")) return "summary";
  if (set.has("body")) return "body";
  return "both";
}
function assertSelectedPair(row, at) {
  const where = "screening:" + (at || "pair");
  if (!row || typeof row !== "object") throw new InvalidDataError("\u7B5B\u9009 pair \u4E0D\u662F\u5BF9\u8C61: " + where, { where: "screening" });
  for (const k of ["a", "b", "a_path", "b_path"]) {
    if (typeof row[k] !== "string" || row[k] === "") throw new InvalidDataError("\u7B5B\u9009 pair \u7F3A\u5C11 " + k + ": " + where, { where: "screening" });
  }
  if (!VIAS.includes(row.via)) throw new InvalidDataError("\u7B5B\u9009 pair via \u975E\u6CD5: " + String(row.via) + " (" + where + ")", { where: "screening" });
  if (!Array.isArray(row.arm) || row.arm.some((x) => typeof x !== "string" || x === "")) throw new InvalidDataError("\u7B5B\u9009 pair arm \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4: " + where, { where: "screening" });
  if (typeof row.score !== "number" || !Number.isFinite(row.score)) throw new InvalidDataError("\u7B5B\u9009 pair score \u5FC5\u987B\u662F\u6709\u9650\u6570\u503C: " + where, { where: "screening" });
  return row;
}
function assertSelectedPairs(rows, at) {
  for (const row of rows || []) assertSelectedPair(row, at);
  return rows;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/screening/semantic.js
var StreamedStaticEmbedder = class {
  constructor(modelDir, opts) {
    this.name = "model2vec-stream";
    this.m = new StaticTable(modelDir, opts || {});
    this.model = this.m;
  }
  async fitTransform(texts) {
    return this.m.fitTransform(texts);
  }
  async encode(texts) {
    return (await this.fitTransform(texts)).map((v) => Array.from(v));
  }
  async transform(texts) {
    return this.fitTransform(texts);
  }
  close() {
    if (this.m) this.m.close();
  }
};
var TfidfEmbedder = class {
  constructor() {
    this.name = "tfidf";
    this.vocab = /* @__PURE__ */ new Map();
    this.idf = null;
  }
  _analyze(text) {
    const s = String(text).toLowerCase();
    const grams = /* @__PURE__ */ new Map();
    for (let n = 3; n <= 5; n += 1) {
      for (let i = 0; i + n <= s.length + 1; i += 1) {
        const piece = s.slice(i, i + n);
        if (piece.length < n) continue;
        if (/^\s*$/.test(piece)) continue;
        grams.set(piece, (grams.get(piece) || 0) + 1);
      }
    }
    return grams;
  }
  async fitTransform(texts) {
    const docs = texts.map((t) => this._analyze(t));
    const df = /* @__PURE__ */ new Map();
    for (const g of docs) for (const k of g.keys()) df.set(k, (df.get(k) || 0) + 1);
    const N2 = docs.length;
    this.idf = /* @__PURE__ */ new Map();
    for (const [k, c] of df) this.idf.set(k, Math.log((1 + N2) / (1 + c)) + 1);
    let idx = 0;
    for (const k of this.idf.keys()) this.vocab.set(k, idx++);
    return docs.map((g) => this._vec(g));
  }
  _vec(grams) {
    const v = new Float64Array(this.vocab.size);
    for (const [k, c] of grams) {
      const i = this.vocab.get(k);
      if (i !== void 0) v[i] = (1 + Math.log(c)) * this.idf.get(k);
    }
    let n2 = 0;
    for (const x of v) n2 += x * x;
    const n = Math.sqrt(n2);
    if (n > 0) for (let i = 0; i < v.length; i += 1) v[i] /= n;
    return v;
  }
  async encode(texts) {
    return (await this.fitTransform(texts)).map((v) => Array.from(v));
  }
  async transform(texts) {
    return texts.map((t) => this._vec(this._analyze(t)));
  }
};
var SentenceTransformerEmbedder = class {
  constructor() {
    throw new Error("Node \u7248\u4E0D\u652F\u6301 sentence-transformers \u540E\u7AEF\uFF08\u8BF7\u7528 model2vec-stream / chain\uFF09");
  }
};
function tokenizerOpts(cfg) {
  return { cache: cfg.tokenizer_cache !== false, cacheDir: cfg.tokenizer_cache_dir || "" };
}
function localEmbedder(cfg, modelDir) {
  const dir = modelDir || cfg.embedder_model;
  if (cfg.embedder === "model2vec-stream") return new StreamedStaticEmbedder(dir, Object.assign({}, tokenizerOpts(cfg), { streamMode: cfg.stream_mode, maxTableBytes: (Number(cfg.max_table_mb) || 0) * 1024 * 1024, workerPool: cfg.worker_pool, workerPoolSize: cfg.worker_pool_size, workerPoolMinItems: cfg.worker_pool_min_items, workerPoolMinMs: cfg.worker_pool_min_ms }));
  if (cfg.embedder === "tfidf") return new TfidfEmbedder();
  if (cfg.embedder === "tfidf-svd") throw new Error("Node \u7248\u6682\u4E0D\u652F\u6301 tfidf-svd\uFF08\u9700 sklearn SVD\uFF09");
  if (cfg.embedder === "model2vec") throw new Error("Node \u7248\u6682\u4E0D\u652F\u6301 model2vec \u76F4\u8F7D\uFF08\u7528 model2vec-stream\uFF09");
  if (cfg.embedder === "sentence-transformers") return new SentenceTransformerEmbedder();
  throw new InvalidDataError("\u672A\u77E5 embedder provider: " + String(cfg.embedder) + "\uFF08\u53EF\u9009: model2vec-stream/tfidf/tfidf-svd/model2vec/sentence-transformers\uFF09", { where: "embed-provider" });
}
function buildTier(tier, cfg, opts) {
  if (tier.kind === "remote") return new RemoteEmbedder(tier.effectiveModel, cfg, { priceKey: tier.modelId, signal: opts && opts.signal });
  const dir = cfg[tier.overrideField] || resolveConfiguredDir(cfg, tier.overrideField) || cfg.embedder_model;
  return localEmbedder(cfg, dir);
}
function makeEmbedder(cfg, opts) {
  const backend = assertKnownBackend(cfg);
  if (backend === "onnx") return new OnnxEmbedder(cfg);
  const chain = resolveChain(cfg, embedRegistry());
  if (chain.mode === "chain") return new ChainEmbedder(chain.tiers.map((t) => [t.tier, async () => buildTier(t, cfg, opts)]), opts);
  return buildTier(chain.tiers[0], cfg, opts);
}
function projectionOf(skill, projection) {
  return projection === "summary" ? skill.summary : skill.body_core || skill.body;
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}
async function semanticSelect(passed, byPath, cfg, opts) {
  const signal = opts && opts.signal;
  throwIfAborted(signal);
  const stats = { pairs_in: passed.length, top_n: cfg.semantic_top_n, body_floor: cfg.semantic_body_floor, summary_floor: cfg.semantic_summary_floor, embedder: cfg.embedder, model: cfg.embedder_model, per_projection: {} };
  if (!passed.length) return [[], [], stats];
  const emb = makeEmbedder(cfg, opts);
  try {
    const participants = [...new Set(passed.flatMap((r) => [r.a_path, r.b_path]))].sort();
    const paths = participants;
    stats.embed_inputs = { participants: participants.length, total_skills: byPath.size };
    const valsByProj = {};
    for (const projection of ["body_core", "summary"]) {
      throwIfAborted(signal);
      const texts = paths.map((p) => projectionOf(byPath.get(p), projection));
      const vecs = await emb.fitTransform(texts);
      const idx = new Map(paths.map((p, i) => [p, i]));
      valsByProj[projection] = passed.map((r) => dot(vecs[idx.get(r.a_path)], vecs[idx.get(r.b_path)]));
    }
    stats.embedder = emb.name;
    const tier = emb.chosen || "local";
    const floors = floorsFor(cfg, embedRegistry(), tier);
    stats.floors_used = { tier, body: floors.body_core, summary: floors.summary };
    const acc = /* @__PURE__ */ new Map();
    for (const projection of ["body_core", "summary"]) {
      const vals = valsByProj[projection];
      const floor = floors[projection];
      const order = [...Array(vals.length).keys()].sort((a, b) => vals[b] - vals[a] || a - b);
      const top = new Set(order.slice(0, cfg.semantic_top_n));
      const flr = new Set(vals.map((v, i) => i).filter((i) => vals[i] >= floor));
      const picked = /* @__PURE__ */ new Set([...top, ...flr]);
      for (const i of [...picked].sort((a, b) => a - b)) {
        const r = passed[i];
        const key = r.a_path + "\0" + r.b_path;
        let row = acc.get(key);
        if (!row) {
          row = Object.assign({}, r);
          acc.set(key, row);
        }
        row[projection + "_cosine"] = Math.round(vals[i] * 1e4) / 1e4;
        row.arms = row.arms || [];
        row.arms.push(projection + (flr.has(i) ? "_floor" : "_top"));
        if (!Array.isArray(row.arm)) row.arm = [];
        const semanticArm = "semantic:" + projection + (flr.has(i) ? "_floor" : "_top");
        if (!row.arm.includes(semanticArm)) row.arm.push(semanticArm);
        row.via = row.via || viaFromNets(row.nets);
        if (typeof row.score !== "number" || !Number.isFinite(row.score)) row.score = Math.max(Number(row.body_core_cosine) || 0, Number(row.summary_cosine) || 0);
      }
      const cut = order.length >= cfg.semantic_top_n ? Math.round(vals[order[cfg.semantic_top_n - 1]] * 1e4) / 1e4 : null;
      stats.per_projection[projection] = { top_n_count: top.size, floor_count: flr.size, union_count: picked.size, floor, cutoff_cosine: cut };
    }
    const out = [...acc.keys()].sort().map((k) => acc.get(k));
    assertSelectedPairs(out, "semantic");
    stats.selected = out.length;
    if (emb.attempts) {
      stats.embedder_used = emb.chosen;
      stats.embedder_chain = emb.attempts;
    }
    if (typeof emb.degrade === "function") {
      const d = emb.degrade();
      if (d && d.degraded) {
        stats.embedder_degraded = true;
        stats.embedder_reason = d.reasonCode;
      }
    }
    if (USAGE.calls) stats.remote_usage = Object.assign({}, USAGE);
    return [out, out, stats];
  } finally {
    if (emb && typeof emb.close === "function") emb.close();
  }
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/semantic.js
async function runSemantic(passed, byPath, cfg, opts) {
  if (cfg.skip_stage4) {
    const stats2 = { skipped: true, pairs_in: passed.length, selected: passed.length };
    return { selected: passed, scored: passed, stats: stats2 };
  }
  const [selected, scored, stats] = await semanticSelect(passed, byPath, cfg, opts);
  return { selected, scored, stats };
}
var semanticStage = defineStage({
  id: "semantic",
  requires: ["passed", "byPath"],
  async run(ctx, env) {
    const { selected, scored, stats } = await runSemantic(env.passed, env.byPath, ctx.cfg, { signal: ctx.signal });
    return {
      data: { selected, scored },
      stats,
      counters: { pairs_in: Number(stats.pairs_in || 0), selected: Number(stats.selected || 0) },
      degraded: stats.embedder_degraded === true
    };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/corpus.js
import path9 from "node:path";
import crypto2 from "node:crypto";
var FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
var Skill = class {
  constructor(p, name, description, body) {
    this.path = p;
    this.name = name;
    this.description = description;
    this.body = body;
    this.body_core = "";
  }
  get summary() {
    return (this.name + " " + this.description).trim();
  }
};
function frontmatter(text) {
  const m = FM_RE.exec(text);
  if (!m) return [{}, text];
  const fm = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    const mm = /^(name|description|tags)\s*:\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    fm[mm[1]] = v;
  }
  return [fm, text.slice(m[0].length)];
}
function loadCorpus(roots) {
  const skip = /* @__PURE__ */ new Set(["node_modules", "__pycache__"]);
  const skills = [];
  const seen = /* @__PURE__ */ new Set();
  let skippedDirs = 0, nestedPruned = 0;
  for (const root of roots) {
    walk(path9.resolve(root));
  }
  function walk(dir) {
    let entries;
    try {
      entries = listDir(dir);
    } catch (e) {
      return;
    }
    const dirs = entries.filter((e) => e.isDirectory).map((e) => e.name);
    const files = entries.filter((e) => e.isFile).map((e) => e.name);
    const keep = [];
    for (const d of dirs) {
      if (skip.has(d) || d.startsWith(".")) skippedDirs += 1;
      else keep.push(d);
    }
    if (files.includes("SKILL.md")) {
      if (keep.length) nestedPruned += keep.length;
      let p;
      try {
        p = realPath(path9.join(dir, "SKILL.md"));
      } catch (e) {
        return;
      }
      if (seen.has(p)) return;
      seen.add(p);
      let text;
      try {
        text = readText(p);
      } catch (e) {
        return;
      }
      const [fm, body] = frontmatter(text);
      const name = fm.name || path9.basename(dir);
      skills.push(new Skill(p, name, fm.description || "", body));
      return;
    }
    for (const d of keep) walk(path9.join(dir, d));
  }
  skills.sort((x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
  return [skills, { skipped_archive_dirs: skippedDirs, pruned_nested_dirs: nestedPruned }];
}
function paragraphs(body) {
  return String(body).split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x);
}
function round3(x) {
  return Math.round(x * 1e3) / 1e3;
}
function stripBoilerplate(skills, cfg) {
  const counts = {};
  const rows = [];
  for (const s of skills) {
    const seen = /* @__PURE__ */ new Set();
    for (const para of paragraphs(s.body)) {
      const key = crypto2.createHash("sha256").update(para.replace(/\s+/g, " ").toLowerCase()).digest("hex").slice(0, 16);
      rows.push([s, para, key]);
      if (!seen.has(key)) {
        seen.add(key);
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  }
  const floor = Math.max(cfg.boilerplate_min_docs, Math.floor(skills.length * cfg.boilerplate_min_ratio));
  const common = new Set(Object.entries(counts).filter(([k, c]) => c >= floor).map(([k]) => k));
  const kept = {};
  let total = 0, dropped = 0;
  for (const [s, para, key] of rows) {
    total += 1;
    if (common.has(key)) {
      dropped += 1;
      continue;
    }
    (kept[s.path] = kept[s.path] || []).push(para);
  }
  for (const s of skills) s.body_core = (kept[s.path] || []).join("\n\n");
  return { paragraphs: total, boilerplate_paragraphs: dropped, floor, kinds: common.size };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/screening/prefilter.js
function nameEntropy(name) {
  const s = String(name).toLowerCase().replace(/\s+/g, "");
  if (!s) return 0;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  const n = s.length;
  let h = 0;
  for (const c of Object.values(freq)) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}
function prefilter(skills, cfg) {
  const kept = [], dropped = [];
  for (const s of skills) {
    const raw = String(s.name).trim();
    const toks = raw.split(/[-_\s]+/).filter((x) => x);
    const ent = nameEntropy(s.name);
    let reason = null;
    if (raw.length < cfg.min_name_len && toks.length < cfg.min_name_tokens) reason = "name \u8FC7\u77ED\u4E14 token \u6570\u4E0D\u8DB3";
    else if (ent < cfg.min_name_entropy) reason = "name \u71B5\u8FC7\u4F4E\uFF08\u7591\u4F3C\u5360\u4F4D/\u6D41\u6C34\u53F7\uFF09";
    if (reason) dropped.push({ name: s.name, path: s.path, entropy: round3(ent), tokens: toks.length, reason });
    else kept.push(s);
  }
  const ents = skills.map((s) => nameEntropy(s.name)).sort((a, b) => a - b);
  const stats = {
    input: skills.length,
    kept: kept.length,
    dropped: dropped.length,
    entropy_min: ents.length ? round3(ents[0]) : 0,
    entropy_median: ents.length ? round3(ents[Math.floor(ents.length / 2)]) : 0
  };
  return [kept, dropped, stats];
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/prefilter.js
var prefilterStage = defineStage({
  id: "prefilter",
  requires: [],
  async run(ctx, env) {
    if (!Array.isArray(env.skills)) throw new PipelineError("prefilter \u9700\u8981 input.skills", { code: DiagnosticCode.INVALID, where: "pipeline" });
    const [kept, dropped, stats] = prefilter(env.skills, ctx.cfg);
    return { data: { kept, dropped }, stats, counters: { skills: env.skills.length, kept: kept.length, dropped: dropped.length } };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/ledger.js
function pairKey(a, b) {
  return [a, b].sort().join("|");
}
function load2(p) {
  if (!p || !exists(p)) return {};
  try {
    return readJson(p);
  } catch (e) {
    return {};
  }
}
function save2(p, data) {
  if (!p) return;
  writeJson(p, data, { indent: 2 });
}
function mark(p, pairs, extra) {
  const data = load2(p);
  const now = Math.trunc(Date.now() / 1e3);
  for (const [a, b] of pairs) {
    const k = pairKey(a, b);
    const rec = data[k] || (data[k] = { seen_at: now, rounds: 0, meta: {} });
    rec.rounds = Number(rec.rounds || 0) + 1;
    rec.seen_at = now;
    if (extra) rec.meta = extra;
  }
  save2(p, data);
  return Object.keys(data).length;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/textutil.js
var CJK_RE = /^[\u4e00-\u9fff]+$/;
var TOKEN_RE = /[A-Za-z0-9_]+|[\u4e00-\u9fff]+/g;
function tokens(text) {
  const out = [];
  const s0 = String(text).toLowerCase();
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s0)) !== null) {
    const s = m[0];
    if (CJK_RE.test(s)) {
      if (s.length === 1) out.push(s);
      else for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
    } else out.push(s);
  }
  return out;
}
function tokenSet(text) {
  return new Set(tokens(text));
}
function shingles(text, k) {
  const toks = tokens(text);
  const out = /* @__PURE__ */ new Set();
  if (!toks.length) return out;
  if (toks.length < k) {
    out.add(toks.join(" "));
    return out;
  }
  for (let i = 0; i <= toks.length - k; i += 1) out.add(toks.slice(i, i + k).join(" "));
  return out;
}
function jaccardSets(a, b) {
  if (!a || !b || !a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/minhash/signature.js
import path10 from "node:path";
import crypto3 from "node:crypto";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var __dirname2 = path10.dirname(fileURLToPath2(import.meta.url));
var PARAMS = readJson(path10.join(__dirname2, "..", "data", "minhash_params.json"));
var NUM_PERM = PARAMS.num_perm;
var A = Uint32Array.from(PARAMS.a);
var B = Uint32Array.from(PARAMS.b);
var FEATURE_CACHE_LIMIT = 5e5;
var featureCache = /* @__PURE__ */ new Map();
function sha1Hash32(buf) {
  return crypto3.createHash("sha1").update(buf).digest().readUInt32LE(0);
}
function fmix32(hv) {
  hv = (hv ^ hv >>> 16) >>> 0;
  hv = Math.imul(hv, 2246822507) >>> 0;
  hv = (hv ^ hv >>> 13) >>> 0;
  hv = Math.imul(hv, 3266489909) >>> 0;
  hv = (hv ^ hv >>> 16) >>> 0;
  return hv;
}
function featureHash(feature) {
  const key = typeof feature === "string" ? feature : String(feature);
  const cached = featureCache.get(key);
  if (cached !== void 0) return cached;
  const hv = fmix32(sha1Hash32(Buffer.from(key, "utf8")));
  if (featureCache.size >= FEATURE_CACHE_LIMIT) featureCache.clear();
  featureCache.set(key, hv);
  return hv;
}
function minhashSignature(features, numPerm) {
  const n = numPerm === void 0 ? NUM_PERM : Number(numPerm);
  if (!Number.isInteger(n) || n < 1 || n > NUM_PERM) throw new InvalidDataError("numPerm \u5FC5\u987B\u5728 1.." + NUM_PERM, { where: "minhash" });
  const sig = new Uint32Array(n).fill(4294967295);
  for (const f of features) {
    const hv = featureHash(f);
    for (let k = 0; k < n; k += 1) {
      const phv = Math.imul(A[k], hv) + B[k] >>> 0;
      if (phv < sig[k]) sig[k] = phv;
    }
  }
  return sig;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/minhash/lsh.js
import path11 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var __dirname3 = path11.dirname(fileURLToPath3(import.meta.url));
var PARAMS2 = readJson(path11.join(__dirname3, "..", "data", "minhash_params.json"));
var GRID = Object.keys(PARAMS2.params).map((k) => ({ t: Number(k), b: PARAMS2.params[k][0], r: PARAMS2.params[k][1] })).sort((x, y) => x.t - y.t);
function lshParamsEx(threshold) {
  const t = Number(threshold);
  if (!Number.isFinite(t)) throw new InvalidDataError("LSH threshold \u5FC5\u987B\u662F\u6570\u503C\uFF0C\u6536\u5230: " + threshold, { where: "lsh" });
  let best = null;
  let bestD = Infinity;
  for (const g of GRID) {
    const d = Math.abs(g.t - t);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  const snapped = bestD > 1e-9;
  return { b: best.b, r: best.r, snapped, snappedTo: best.t, requested: t };
}
function lshParams(threshold, onSnap) {
  const p = lshParamsEx(threshold);
  if (p.snapped && typeof onSnap === "function") onSnap({ requested: p.requested, snappedTo: p.snappedTo, b: p.b, r: p.r });
  return [p.b, p.r];
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/numeric.js
function roundHalfEven(x, digits) {
  const d = digits === void 0 ? 0 : digits;
  const f = Math.pow(10, d);
  const sign = x < 0 ? -1 : 1;
  const y = Math.abs(x) * f;
  const lower = Math.floor(y);
  const diff = y - lower;
  let r;
  if (Math.abs(diff - 0.5) < 1e-9) r = lower % 2 === 0 ? lower : lower + 1;
  else r = Math.round(y);
  if (r === 0) return 0;
  return sign * r / f;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/pyrandom.js
var N = 624;
var M = 397;
var MATRIX_A = 2567483615;
var UPPER_MASK = 2147483648;
var LOWER_MASK = 2147483647;
var PyRandom = class {
  constructor(seed) {
    this.mt = new Uint32Array(N);
    this.mti = N + 1;
    if (seed !== void 0) this.seed(seed);
  }
  seed(a) {
    const key = [];
    let s = a < 0 ? -a : a;
    key.push(s >>> 0);
    s = Math.floor(s / 4294967296);
    while (s > 0) {
      key.push(s >>> 0);
      s = Math.floor(s / 4294967296);
    }
    this._initByArray(key);
  }
  _initGenrand(s) {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i += 1) {
      const prev = this.mt[i - 1] ^ this.mt[i - 1] >>> 30;
      this.mt[i] = Math.imul(1812433253, prev) + i >>> 0;
    }
    this.mti = N;
  }
  _initByArray(key) {
    this._initGenrand(19650218);
    let i = 1, j = 0;
    let k = Math.max(N, key.length);
    for (; k > 0; k -= 1) {
      const prev = this.mt[i - 1] ^ this.mt[i - 1] >>> 30;
      this.mt[i] = (this.mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j >>> 0;
      i += 1;
      j += 1;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k > 0; k -= 1) {
      const prev = this.mt[i - 1] ^ this.mt[i - 1] >>> 30;
      this.mt[i] = (this.mt[i] ^ Math.imul(prev, 1566083941)) - i >>> 0;
      i += 1;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
    }
    this.mt[0] = 2147483648;
    this.mti = N;
  }
  _genrand() {
    let y;
    if (this.mti >= N) {
      let kk;
      for (kk = 0; kk < N - M; kk += 1) {
        y = this.mt[kk] & UPPER_MASK | this.mt[kk + 1] & LOWER_MASK;
        this.mt[kk] = this.mt[kk + M] ^ y >>> 1 ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk += 1) {
        y = this.mt[kk] & UPPER_MASK | this.mt[kk + 1] & LOWER_MASK;
        this.mt[kk] = this.mt[kk + (M - N)] ^ y >>> 1 ^ (y & 1 ? MATRIX_A : 0);
      }
      y = this.mt[N - 1] & UPPER_MASK | this.mt[0] & LOWER_MASK;
      this.mt[N - 1] = this.mt[M - 1] ^ y >>> 1 ^ (y & 1 ? MATRIX_A : 0);
      this.mti = 0;
    }
    y = this.mt[this.mti];
    this.mti += 1;
    y ^= y >>> 11;
    y ^= y << 7 & 2636928640;
    y ^= y << 15 & 4022730752;
    y ^= y >>> 18;
    return y >>> 0;
  }
  getrandbits(k) {
    if (k <= 32) return this._genrand() >>> 32 - k;
    const words = Math.ceil(k / 32);
    const top = k % 32;
    let v = this._genrand() >>> 32 - top;
    for (let i = 1; i < words; i += 1) v = v * 4294967296 + this._genrand();
    return v;
  }
  _randbelow(n) {
    const k = n.toString(2).length;
    let r;
    do {
      r = this.getrandbits(k);
    } while (r >= n);
    return r;
  }
  random() {
    const a = this._genrand() >>> 5, b = this._genrand() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }
  randint(a, b) {
    return a + this._randbelow(b - a + 1);
  }
  uniform(a, b) {
    return a + (b - a) * this.random();
  }
  sample(population, k) {
    const n = population.length;
    if (k > n) throw new Error("sample larger than population");
    const result = [];
    let setsize = 21;
    if (k > 5) {
      const est = Math.log(k * 3) / Math.log(4);
      setsize += Math.pow(4, Math.ceil(est));
    }
    if (n <= setsize) {
      const pool = population.slice();
      for (let i = 0; i < k; i += 1) {
        const j = this._randbelow(n - i);
        result.push(pool[j]);
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = /* @__PURE__ */ new Set();
      for (let i = 0; i < k; i += 1) {
        let j = this._randbelow(n);
        while (selected.has(j)) j = this._randbelow(n);
        selected.add(j);
        result.push(population[j]);
      }
    }
    return result;
  }
};

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/screening/candidates.js
function projectionText(s, projection) {
  return projection === "summary" ? s.summary : s.body_core || s.body;
}
function pairScore(js, jb) {
  return Math.max(js, jb);
}
function roundParams(cfg, rnd, useRng, rng) {
  let seed, floor;
  if (useRng) seed = rng.randint(1, 1e6);
  else seed = cfg.minhash_seed + rnd;
  if (cfg.floor_jitter > 0) {
    if (useRng) floor = cfg.lsh_floor + rng.uniform(-cfg.floor_jitter, cfg.floor_jitter);
    else floor = cfg.lsh_floor + (rnd % 2 ? cfg.floor_jitter : -cfg.floor_jitter);
  } else floor = cfg.lsh_floor;
  floor = Math.max(0.01, roundHalfEven(floor, 4));
  return [seed, floor];
}
function pairCmp(ka, kb) {
  const a = ka.split("\0"), b = kb.split("\0");
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}
function reach(skills, projection, sigs, floor, onSnap) {
  const [b, r] = lshParams(floor, onSnap);
  const buckets = /* @__PURE__ */ new Map();
  for (const s of skills) {
    const sig = sigs.get(s.path);
    if (!sig) continue;
    for (let bi = 0; bi < b; bi += 1) {
      const key = bi + "|" + sig.slice(bi * r, (bi + 1) * r).join(",");
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push(s.path);
    }
  }
  const pairs = /* @__PURE__ */ new Set();
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i += 1) for (let j = i + 1; j < arr.length; j += 1) {
      const a = arr[i], bb = arr[j];
      pairs.add(a < bb ? a + "\0" + bb : bb + "\0" + a);
    }
  }
  return pairs;
}
function selectPerProjection(poolKeys, exactOne, totalPairs, cfg) {
  const armStrong = /* @__PURE__ */ new Set();
  for (const k of poolKeys) if (exactOne.get(k) >= cfg.select_jaccard_min) armStrong.add(k);
  const perSkill = /* @__PURE__ */ new Map();
  for (const k of poolKeys) {
    const sc = exactOne.get(k);
    for (const p of k.split("\0")) {
      let arr = perSkill.get(p);
      if (!arr) {
        arr = [];
        perSkill.set(p, arr);
      }
      arr.push([sc, k]);
    }
  }
  const armTopk = /* @__PURE__ */ new Set();
  for (const arr of perSkill.values()) {
    arr.sort((x, y) => y[0] - x[0] || pairCmp(x[1], y[1]));
    for (const [, k] of arr.slice(0, cfg.top_k)) armTopk.add(k);
  }
  const budget = Math.min(Math.trunc(totalPairs * cfg.global_frac), cfg.global_cap);
  const ranked = [...poolKeys].sort((x, y) => exactOne.get(y) - exactOne.get(x) || pairCmp(x, y));
  const armGlobal = new Set(ranked.slice(0, budget));
  return [/* @__PURE__ */ new Set([...armStrong, ...armTopk, ...armGlobal]), { arm_strong: armStrong.size, arm_topk: armTopk.size, arm_global: armGlobal.size, global_budget: budget }];
}
function selectMerged(poolKeys, exact, totalPairs, cfg) {
  const armStrong = /* @__PURE__ */ new Set();
  for (const k of poolKeys) {
    const [js, jb] = exact.get(k);
    if (js >= cfg.select_jaccard_min || jb >= cfg.select_jaccard_min) armStrong.add(k);
  }
  const perSkill = /* @__PURE__ */ new Map();
  for (const k of poolKeys) {
    const [js, jb] = exact.get(k);
    const sc = pairScore(js, jb);
    for (const p of k.split("\0")) {
      let arr = perSkill.get(p);
      if (!arr) {
        arr = [];
        perSkill.set(p, arr);
      }
      arr.push([sc, k]);
    }
  }
  const armTopk = /* @__PURE__ */ new Set();
  for (const arr of perSkill.values()) {
    arr.sort((x, y) => y[0] - x[0] || pairCmp(x[1], y[1]));
    for (const [, k] of arr.slice(0, cfg.top_k)) armTopk.add(k);
  }
  const budget = Math.min(Math.trunc(totalPairs * cfg.global_frac), cfg.global_cap);
  const ranked = [...poolKeys].sort((x, y) => pairScore(...exact.get(y)) - pairScore(...exact.get(x)) || pairCmp(x, y));
  const armGlobal = new Set(ranked.slice(0, budget));
  return [/* @__PURE__ */ new Set([...armStrong, ...armTopk, ...armGlobal]), { arm_strong: armStrong.size, arm_topk: armTopk.size, arm_global: armGlobal.size, global_budget: budget }];
}
function runSeedOf(cfg) {
  if (cfg.seed_mode === "fixed") return cfg.minhash_seed;
  return (Date.now() ^ process.pid << 8 >>> 0) & 2147483647;
}
function generateCandidates(skills, cfg) {
  const byPath = new Map(skills.map((s) => [s.path, s]));
  const totalPairs = Math.trunc(skills.length * (skills.length - 1) / 2);
  const projections = [];
  if (cfg.use_summary_index) projections.push("summary");
  if (cfg.use_body_index) projections.push("body");
  const seed0 = runSeedOf(cfg);
  const useRng = cfg.randomize_seed || cfg.seed_mode === "run";
  const rng = new PyRandom(seed0);
  const tok = /* @__PURE__ */ new Map();
  for (const s of skills) {
    const m = {};
    for (const proj of projections) m[proj] = tokenSet(projectionText(s, proj));
    tok.set(s.path, m);
  }
  const sigByProj = new Map(projections.map((p) => [p, /* @__PURE__ */ new Map()]));
  for (const s of skills) {
    for (const proj of projections) {
      const text = projectionText(s, proj);
      if (!String(text).trim()) continue;
      const feats = cfg.net_vocabulary === "shingle" ? shingles(text, cfg.shingle_size) : tok.get(s.path)[proj];
      sigByProj.get(proj).set(s.path, minhashSignature(feats));
    }
  }
  const snapWarnings = [];
  const onSnap = (info) => {
    if (!snapWarnings.some((w) => w.requested === info.requested)) snapWarnings.push(info);
  };
  const selected = /* @__PURE__ */ new Map();
  const roundsMeta = [];
  let prev = 0;
  for (let rnd = 0; rnd < cfg.round_count; rnd += 1) {
    const [seed, floor] = roundParams(cfg, rnd, useRng, rng);
    const netOf = /* @__PURE__ */ new Map();
    const reachByProj = {};
    const pool = /* @__PURE__ */ new Set();
    for (const proj of projections) {
      const r = reach(skills, proj, sigByProj.get(proj), floor, onSnap);
      reachByProj[proj] = r;
      for (const k of r) {
        let arr = netOf.get(k);
        if (!arr) {
          arr = /* @__PURE__ */ new Set();
          netOf.set(k, arr);
        }
        arr.add(proj);
        pool.add(k);
      }
    }
    const exact = /* @__PURE__ */ new Map();
    for (const k of pool) {
      const [pa, pb] = k.split("\0");
      const js = projections.includes("summary") ? jaccardSets(tok.get(pa).summary, tok.get(pb).summary) : 0;
      const jb = projections.includes("body") ? jaccardSets(tok.get(pa).body, tok.get(pb).body) : 0;
      exact.set(k, [js, jb]);
    }
    let chosen, arms;
    if (cfg.topk_mode === "merged") {
      [chosen, arms] = selectMerged(pool, exact, totalPairs, cfg);
    } else {
      chosen = /* @__PURE__ */ new Set();
      arms = { arm_strong: 0, arm_topk: 0, arm_global: 0, global_budget: 0 };
      for (const proj of projections) {
        const one = /* @__PURE__ */ new Map();
        for (const k of reachByProj[proj]) one.set(k, proj === "summary" ? exact.get(k)[0] : exact.get(k)[1]);
        const [selP, armsP] = selectPerProjection([...one.keys()], one, totalPairs, cfg);
        for (const k of selP) chosen.add(k);
        arms.arm_strong += armsP.arm_strong;
        arms.arm_topk += armsP.arm_topk;
        arms.arm_global += armsP.arm_global;
        arms.global_budget = armsP.global_budget;
      }
    }
    for (const k of chosen) {
      let row = selected.get(k);
      if (!row) {
        row = { jaccard_summary: 0, jaccard_body: 0, rounds: [], nets: [] };
        selected.set(k, row);
      }
      const [pa, pb] = k.split("\0");
      row.a = byPath.get(pa).name;
      row.b = byPath.get(pb).name;
      row.a_path = pa;
      row.b_path = pb;
      for (const p of [...netOf.get(k) || []].sort()) if (!row.nets.includes(p)) row.nets.push(p);
      const [js, jb] = exact.get(k);
      row.jaccard_summary = Math.max(row.jaccard_summary, Math.round(js * 1e4) / 1e4);
      row.jaccard_body = Math.max(row.jaccard_body, Math.round(jb * 1e4) / 1e4);
      row.via = viaFromNets(row.nets);
      row.arm = ["lsh"];
      row.score = Math.max(row.jaccard_summary, row.jaccard_body);
      if (!row.rounds.includes(rnd)) row.rounds.push(rnd);
    }
    const reachCounts = {};
    for (const proj of projections) reachCounts[proj] = reachByProj[proj].size;
    const meta = { round: rnd, seed, floor, reach_by_projection: reachCounts, pool: pool.size, selected: chosen.size, cumulative_pairs: selected.size, new_pairs: selected.size - prev };
    Object.assign(meta, arms);
    prev = selected.size;
    roundsMeta.push(meta);
  }
  const stats = {
    skills_indexed: skills.length,
    possible_pairs: totalPairs,
    floor_base: cfg.lsh_floor,
    floor_jitter: cfg.floor_jitter,
    net_vocabulary: cfg.net_vocabulary,
    rounds: cfg.round_count,
    randomize_seed: cfg.randomize_seed,
    top_k: cfg.top_k,
    run_seed: seed0,
    seed_mode: cfg.seed_mode,
    rounds_detail: roundsMeta,
    candidate_pairs: selected.size,
    budget_ratio: skills.length ? Math.round(selected.size / skills.length * 100) / 100 : 0,
    via_summary: [...selected.values()].filter((v) => v.nets.includes("summary")).length,
    via_body: [...selected.values()].filter((v) => v.nets.includes("body")).length,
    via_both: [...selected.values()].filter((v) => v.nets.length > 1).length,
    found_in_multiple_rounds: [...selected.values()].filter((v) => v.rounds.length > 1).length
  };
  if (snapWarnings.length) stats.lsh_snapped = snapWarnings;
  if (cfg.ledger_path) {
    const seen = load2(cfg.ledger_path);
    let known = 0;
    for (const [k, row] of selected) {
      const [a, b] = k.split("\0");
      const lk = pairKey(a, b);
      row.known = Object.prototype.hasOwnProperty.call(seen, lk);
      if (row.known) known += 1;
    }
    stats.ledger_total_before = Object.keys(seen).length;
    stats.known_pairs = known;
    stats.unseen_pairs = selected.size - known;
    if (cfg.emit_only_new) {
      for (const k of [...selected.keys()]) if (selected.get(k).known) selected.delete(k);
      stats.emitted_pairs = selected.size;
    }
  }
  stats.candidate_pairs = selected.size;
  assertSelectedPairs([...selected.values()], "candidates");
  return [selected, stats, byPath];
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/candidates.js
var candidatesStage = defineStage({
  id: "candidates",
  requires: ["prefilter"],
  async run(ctx, env) {
    const [pairs, stats] = generateCandidates(env.prefilter.kept, ctx.cfg);
    return { data: { pairs }, stats, counters: { kept: env.prefilter.kept.length, pairs: pairs.size } };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/screening/lexical.js
function lexicalGate(skills, pairs, cfg) {
  const byPath = new Map(skills.map((s) => [s.path, s]));
  const rows = [];
  for (const [k, via] of pairs) {
    const [pa, pb] = k.split("\0");
    const js = Number(via.jaccard_summary || 0);
    const jb = Number(via.jaccard_body || 0);
    rows.push({ a: byPath.get(pa).name, b: byPath.get(pb).name, a_path: pa, b_path: pb, jaccard_summary: js, jaccard_body: jb, score: pairScore(js, jb), via: via.via || viaFromNets(via.nets), arm: Array.isArray(via.arm) ? via.arm.slice() : ["lsh"] });
  }
  const n = rows.length;
  const absArm = /* @__PURE__ */ new Set();
  for (let i = 0; i < n; i += 1) if (rows[i].jaccard_body >= cfg.body_gate || rows[i].jaccard_summary >= cfg.summary_gate) absArm.add(i);
  const budget = n ? Math.min(Math.trunc(n * cfg.gate_global_frac), cfg.gate_global_cap) : 0;
  const armsTop1 = {}, armsGlobal = {};
  const top1 = /* @__PURE__ */ new Set(), glob = /* @__PURE__ */ new Set();
  for (const metric of ["jaccard_summary", "jaccard_body"]) {
    const perSkill = /* @__PURE__ */ new Map();
    for (let i = 0; i < n; i += 1) {
      const r = rows[i];
      for (const p of [r.a_path, r.b_path]) {
        let arr = perSkill.get(p);
        if (!arr) {
          arr = [];
          perSkill.set(p, arr);
        }
        arr.push([r[metric], i]);
      }
    }
    const k = cfg.gate_per_skill_topk || 1;
    const picked1 = /* @__PURE__ */ new Set();
    for (const arr of perSkill.values()) {
      arr.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
      for (const [, idx] of arr.slice(0, k)) picked1.add(idx);
    }
    armsTop1[metric] = picked1.size;
    for (const idx of picked1) top1.add(idx);
    const order = [...Array(n).keys()].sort((x, y) => rows[y][metric] - rows[x][metric] || x - y);
    const pickedg = new Set(order.slice(0, budget));
    armsGlobal[metric] = pickedg.size;
    for (const idx of pickedg) glob.add(idx);
  }
  for (const i of absArm) rows[i].arm.push("absolute");
  for (const i of top1) rows[i].arm.push("topk");
  for (const i of glob) rows[i].arm.push("global");
  const passedIdx = [.../* @__PURE__ */ new Set([...absArm, ...top1, ...glob])].sort((a, b) => a - b);
  const passed = passedIdx.map((i) => {
    const r = rows[i];
    r.arm = [...new Set(r.arm)];
    return r;
  });
  assertSelectedPairs(passed, "lexical");
  return [passed, rows, {
    candidates: n,
    passed_lexical: passed.length,
    arm_absolute: absArm.size,
    arm_topk_per_projection: top1.size,
    arm_topk_detail: armsTop1,
    gate_per_skill_topk: cfg.gate_per_skill_topk || 1,
    arm_top1_per_projection: top1.size,
    arm_top1_detail: armsTop1,
    arm_global_per_projection: glob.size,
    arm_global_detail: armsGlobal,
    gate_global_budget_per_projection: budget,
    gate_global_cap: cfg.gate_global_cap,
    gate_global_denominator: "candidates",
    body_gate: cfg.body_gate,
    summary_gate: cfg.summary_gate
  }];
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/lexical.js
var lexicalStage = defineStage({
  id: "lexical",
  requires: ["prefilter", "candidates"],
  async run(ctx, env) {
    const [passed, scored, stats] = lexicalGate(env.prefilter.kept, env.candidates.pairs, ctx.cfg);
    return { data: { passed, scored }, stats, counters: { pairs: env.candidates.pairs.size, passed: passed.length, scored: scored.length } };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/extract.js
var WHEN_RE = /何时用|何时使用|When to Use|触发|适用场景/i;
var BOUND_RE = /不适用|不要用|边界|不覆盖|not cover|does not|限定|前提/;
function sections(body) {
  const out = [];
  let cur = ["(\u5F15\u8A00)", []];
  for (const line of String(body).split(/\r?\n/)) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      out.push([cur[0], cur[1].join("\n").trim()]);
      cur = [m[1].trim(), []];
      continue;
    }
    cur[1].push(line);
  }
  out.push([cur[0], cur[1].join("\n").trim()]);
  return out;
}
function headExtract(skill, maxChars) {
  const mc = maxChars || 2400;
  const parts = [String(skill.description).trim()];
  const secs = sections(skill.body_core || skill.body);
  if (secs.length) parts.push(secs[0][1]);
  const when = secs.filter(([h]) => WHEN_RE.test(h)).map(([, t]) => t);
  if (when.length) parts.push(when[0]);
  const bound = String(skill.body_core || skill.body).split(/\r?\n/).map((l) => l.trim()).filter((l) => BOUND_RE.test(l));
  if (bound.length) parts.push(bound.slice(0, 6).join("\n"));
  return parts.filter((p) => p).join("\n\n").slice(0, mc);
}
function bodyExcerpt(skill, maxChars) {
  return String(skill.body_core || skill.body).trim().slice(0, maxChars || 4e3);
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/rerank/provider.js
var RANKER_SCORE_RANGE = Object.freeze([0, 1]);
function makeRankerProvider(spec) {
  const s = spec || {};
  const provider = {
    id: String(s.id || ""),
    modelId: String(s.modelId || s.id || ""),
    scoreRange: Array.isArray(s.scoreRange) ? s.scoreRange.slice() : RANKER_SCORE_RANGE.slice(),
    score: s.score
  };
  return assertRankerProvider(provider);
}
function assertRankerProvider(provider) {
  if (!provider || typeof provider !== "object") throw new InvalidDataError("ranker provider \u5FC5\u987B\u662F\u5BF9\u8C61", { where: "ranker-provider" });
  if (!provider.id) throw new InvalidDataError("ranker provider \u7F3A\u5C11 id", { where: "ranker-provider" });
  if (!provider.modelId) throw new InvalidDataError("ranker provider \u7F3A\u5C11 modelId: " + provider.id, { where: "ranker-provider" });
  if (!Array.isArray(provider.scoreRange) || provider.scoreRange.length !== 2 || Number(provider.scoreRange[0]) !== 0 || Number(provider.scoreRange[1]) !== 1) {
    throw new InvalidDataError("ranker provider scoreRange \u5FC5\u987B\u662F [0,1]: " + provider.id, { where: "ranker-provider" });
  }
  if (typeof provider.score !== "function") throw new InvalidDataError("ranker provider \u7F3A\u5C11 score(rows): " + provider.id, { where: "ranker-provider" });
  return provider;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/net/retry.js
function retryableReason(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/HTTP (429|5\d\d)\b/.test(msg)) return true;
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed/i.test(msg)) return true;
  return false;
}
function sleep(ms, signal) {
  return new Promise((resolve2, reject) => {
    if (signal && signal.aborted) {
      reject(abortError("\u64CD\u4F5C\u5DF2\u53D6\u6D88"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve2();
    }, Math.max(0, Number(ms) || 0));
    const onAbort = () => {
      cleanup();
      reject(abortError("\u64CD\u4F5C\u5DF2\u53D6\u6D88"));
    };
    function cleanup() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}
async function withRetry(fn, opts) {
  const o = opts || {};
  const retries = Math.max(0, Math.min(5, Number(o.retries) || 0));
  const baseMs = Math.max(0, Number(o.baseMs) || 0);
  const isRetryable = typeof o.isRetryable === "function" ? o.isRetryable : retryableReason;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(o.signal);
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (o.signal && o.signal.aborted) throw err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      if (o.onRetry) o.onRetry(attempt + 1, err);
      await sleep(baseMs * Math.pow(2, attempt), o.signal);
    }
  }
  throw lastErr;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/rerank/index.js
import path12 from "node:path";
import crypto4 from "node:crypto";
var LIDS = [];
for (let i = 32; i < 58; i += 1) LIDS.push(i);
var TEMP_CHOICE = 1.7565;
var SYSTEM = "Apply the criterion to the evidence. Choose exactly one listed option. Answer with its letter only.";
var QUESTION = "\u4EE5\u4E0B\u4E24\u4E2Askill\u5728\u804C\u80FD\u548C\u573A\u666F\u9886\u57DF\u5B58\u5728\u54EA\u4E9B\u5171\u6027\uFF1F";
var OPTIONS = { a: "\u5728\u573A\u666F\u65B9\u9762\u5B58\u5728\u5171\u6027\uFF0C\u4F46\u804C\u80FD\u4E0A\u4E0D\u5B58\u5728\u5171\u6027", b: "\u804C\u80FD\u5B58\u5728\u5171\u6027\uFF0C\u4F46\u5728\u573A\u666F\u65B9\u9762\u4E0D\u5B58\u5728\u5171\u6027", c: "\u5728\u573A\u666F\u65B9\u9762\u548C\u804C\u80FD\u4E0A\u5747\u5B58\u5728\u5171\u6027", d: "\u5728\u573A\u666F\u65B9\u9762\u548C\u804C\u80FD\u4E0A\u5747\u4E0D\u5B58\u5728\u5171\u6027" };
var RankerUnavailable = class extends Error {
};
var PROMPT_BASE = JSON.stringify({ system: SYSTEM, question: QUESTION, options: OPTIONS });
function promptShaOf(cap) {
  return crypto4.createHash("sha256").update(PROMPT_BASE + "|cap=" + Number(cap)).digest("hex");
}
function checkpointKey(rankerId, cap, promptSha, row) {
  return String(rankerId) + "|cap=" + Number(cap) + "|prompt=" + promptSha + "|" + row.a_path + "|" + row.b_path;
}
async function httpJson(url, body, timeout, signal) {
  const opts = { signal: withTimeout(signal, (timeout || 5) * 1e3) };
  if (body === void 0) opts.method = "GET";
  else {
    opts.method = "POST";
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}
async function probeLocal(cfg, signal) {
  const base = cfg.rank_server || "";
  if (!base) return [false, "rank_server \u672A\u914D\u7F6E"];
  try {
    const h = await httpJson(base.replace(/\/$/, "") + "/health", void 0, Number(cfg.rank_probe_timeout || 2), signal);
    if (String(h.status || "").toLowerCase() === "ok") return [true, ""];
    return [false, "health \u8FD4\u56DE " + String(JSON.stringify(h)).slice(0, 120)];
  } catch (exc) {
    if (signal && signal.aborted) throw exc;
    return [false, "\u63A2\u6D3B\u5931\u8D25: " + String(exc).slice(0, 120)];
  }
}
function state(byPath, aPath, bPath, cap) {
  function blk(tag, p) {
    const f = byPath.get(p);
    const body = f.body_core || f.body;
    return "<skill_" + tag + ' name="' + f.name + '">\n<description>' + f.description + "</description>\n<capability_and_triggers>\n" + headExtract(f) + "\n</capability_and_triggers>\n<full_body>\n" + String(body).slice(0, cap) + "\n</full_body>\n</skill_" + tag + ">";
  }
  return blk("a", aPath) + "\n" + blk("b", bPath);
}
var EXP = Math.E;
async function askLocal(prompt, cfg, signal) {
  const base = String(cfg.rank_server || "").replace(/\/$/, "");
  const tmp = await httpJson(base + "/apply-template", { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], chat_template_kwargs: { enable_thinking: false } }, Number(cfg.rank_request_timeout || 120), signal);
  const out = await httpJson(base + "/completion", { prompt: tmp.prompt, n_predict: 1, temperature: -1, n_probs: 256, cache_prompt: false }, Number(cfg.rank_request_timeout || 120), signal);
  const rows = out.completion_probabilities || out.probs;
  if (!rows || !rows.length) throw new RankerUnavailable("\u8FD4\u56DE\u65E0 completion_probabilities");
  const got = /* @__PURE__ */ new Map();
  for (const t of rows[0].top_logprobs) got.set(t.id, t.logprob);
  const ids = Object.keys(OPTIONS);
  for (let i = 0; i < ids.length; i += 1) if (!got.has(LIDS[i])) throw new RankerUnavailable("\u8FD4\u56DE\u7F3A\u5C11\u5B57\u6BCD token \u6982\u7387");
  const sc = {};
  for (let i = 0; i < ids.length; i += 1) sc[i] = got.get(LIDS[i]) / TEMP_CHOICE;
  const mx = Math.max(...Object.values(sc));
  const ex = {};
  let tot = 0;
  for (const k of Object.keys(sc)) {
    ex[k] = Math.pow(EXP, sc[k] - mx);
    tot += ex[k];
  }
  const probs = {};
  for (const k of Object.keys(ids)) probs[ids[k]] = ex[k] / tot;
  return probs.c + 0.5 * (probs.a + probs.b);
}
var Checkpoint = class {
  constructor(filePath, batchSize) {
    this.file = filePath || "";
    this.batch = Math.max(1, Number(batchSize) || 25);
    this.data = this._load();
    this.pending = 0;
    this.writes = 0;
    this.hits = 0;
  }
  _load() {
    try {
      if (this.file && exists(this.file)) {
        const j = readJson(this.file);
        if (j && typeof j === "object" && !Array.isArray(j)) return j;
      }
    } catch (e) {
    }
    return {};
  }
  has(key) {
    const h = Object.prototype.hasOwnProperty.call(this.data, key);
    if (h) this.hits += 1;
    return h;
  }
  get(key) {
    return this.data[key];
  }
  set(key, value) {
    this.data[key] = value;
    this.pending += 1;
    if (this.pending >= this.batch) this.flush();
  }
  flush() {
    if (!this.file) return;
    atomicWrite(this.file, JSON.stringify(this.data, null, 1));
    this.pending = 0;
    this.writes += 1;
  }
  size() {
    return Object.keys(this.data).length;
  }
};
function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function apiKeyConfigured(cfg) {
  const envName = String(cfg.rank_api_key_env || "BAMBOO_API_KEY").trim() || "BAMBOO_API_KEY";
  return Boolean(process.env[envName]);
}
function localTiers(cfg) {
  const raw = String(cfg.rank_local_chain === void 0 ? "q8,q4" : cfg.rank_local_chain || "").trim();
  if (!raw) return cfg.rank_server ? [{ name: "local", url: String(cfg.rank_server) }] : [];
  const legacy = cfg.rank_server ? String(cfg.rank_server) : "";
  const out = [];
  for (const token of raw.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (token === "q8") {
      const url = String(cfg.rank_server_q8 || legacy || "").trim();
      if (url) out.push({ name: "q8", url });
    } else if (token === "q4") {
      const url = String(cfg.rank_server_q4 || "").trim();
      if (url) out.push({ name: "q4", url });
    } else if (token === "local" || token === "default") {
      const url = legacy.trim();
      if (url) out.push({ name: token === "default" ? "local" : token, url });
    } else if (token.includes("=")) {
      const i = token.indexOf("=");
      const name = token.slice(0, i).trim();
      const url = token.slice(i + 1).trim();
      if (name && url) out.push({ name, url });
    }
  }
  return out;
}
function tierCheckpointPath(cfg, tier, index) {
  const base = String(cfg.rank_checkpoint || "");
  if (!base || index === 0) return base;
  const ext = path12.extname(base);
  return ext ? base.slice(0, -ext.length) + "." + tier.name + ext : base + "." + tier.name;
}
async function scoreTier(tier, rows, byPath, cfg, checkpoint, signal) {
  const tcfg = Object.assign({}, cfg, { rank_server: tier.url });
  const ckpt = new Checkpoint(checkpoint, cfg.rank_ckpt_batch);
  const cap = Number(cfg.rank_cap || 5e3);
  const promptSha = promptShaOf(cap);
  const keyOf = (r) => checkpointKey(tier.name, cap, promptSha, r);
  const allCached = rows.every((r) => Object.prototype.hasOwnProperty.call(ckpt.data, keyOf(r)));
  let probeOk = true;
  let probeReason = "";
  if (!allCached) {
    const pr = await probeLocal(tcfg, signal);
    probeOk = pr[0];
    probeReason = pr[1];
  }
  if (!probeOk) return { tier, ckpt, allCached, probeOk: false, probeReason, scored: [], failures: [], retries: 0, requestedConc: 1, conc: 1, slotsInfo: null };
  const requestedConc = Math.max(1, Math.min(8, Number(cfg.rank_concurrency || 1)));
  let conc = requestedConc;
  let slotsInfo = { slots: null, reason: requestedConc > 1 ? "" : "\u9ED8\u8BA4 1\uFF0C\u4E0D\u63A2\u6D4B" };
  if (requestedConc > 1) {
    slotsInfo = await probeSlots(tcfg, signal);
    if (slotsInfo.slots) conc = Math.min(requestedConc, slotsInfo.slots);
  }
  const [scored, failures, retries] = await scoreLocal(rows, byPath, tcfg, ckpt, conc, signal, tier.name);
  ckpt.flush();
  return { tier, ckpt, allCached, probeOk: true, probeReason: "", scored, failures, retries: retries || 0, requestedConc, conc, slotsInfo };
}
function vecSelect(rows, cfg) {
  const k = Number(cfg.rank_vec_topk || 10);
  if (!rows.length) return [];
  const acc = /* @__PURE__ */ new Map();
  for (const [projection, key] of [["body_core", "body_core_cosine"], ["summary", "summary_cosine"]]) {
    const order = [...Array(rows.length).keys()].sort((a, b) => (Number(rows[b][key]) || 0) - (Number(rows[a][key]) || 0) || a - b);
    for (const i of order.slice(0, k)) {
      const r = rows[i];
      const kk = r.a_path + "\0" + r.b_path;
      let row = acc.get(kk);
      if (!row) {
        row = Object.assign({}, r);
        acc.set(kk, row);
      }
      row.rank_arms = row.rank_arms || [];
      row.rank_arms.push(projection + "_top");
    }
  }
  const picked = [...acc.keys()].sort().map((x) => acc.get(x));
  for (const r of picked) {
    const s = Number(r.body_core_cosine || r.summary_cosine || 0);
    r.rank_score = Math.round(s * 1e4) / 1e4;
    r.rank_source = "vec_top" + k;
  }
  picked.sort((a, b) => (Number(b.rank_score) || 0) - (Number(a.rank_score) || 0));
  return picked;
}
async function probeSlots(cfg, signal) {
  const base = String(cfg.rank_server || "").replace(/\/$/, "");
  if (!base) return { slots: null, reason: "rank_server \u672A\u914D\u7F6E" };
  const timeout = Number(cfg.rank_probe_timeout || 2);
  for (const p of ["/props", "/slots"]) {
    try {
      const data = await httpJson(base + p, void 0, timeout, signal);
      let slots = null;
      if (data && Number.isInteger(data.total_slots) && data.total_slots > 0) slots = data.total_slots;
      else if (data && Array.isArray(data.slots) && data.slots.length) slots = data.slots.length;
      else if (data && Array.isArray(data.slot_list) && data.slot_list.length) slots = data.slot_list.length;
      if (slots) return { slots, reason: "\u63A2\u6D4B " + p + " \u6210\u529F" };
    } catch (e) {
      if (signal && signal.aborted) throw e;
    }
  }
  return { slots: null, reason: "slots \u63A2\u6D4B\u5931\u8D25/\u4E0D\u652F\u6301" };
}
async function plan(cfg, opts) {
  const requested = String(cfg.rank_mode || "auto");
  if (requested === "vec") return { requested, use_local: false, reason: "\u663E\u5F0F\u6307\u5B9A vec" };
  const [ok, reason] = await probeLocal(cfg, opts && opts.signal);
  return { requested, use_local: !!ok, reason: ok ? "\u63A2\u6D3B\u901A\u8FC7" : reason };
}
async function scoreLocal(rows, byPath, cfg, ckpt, concurrencyOverride, signal, rankerId) {
  const cap = Number(cfg.rank_cap || 5e3);
  const ranker = rankerId || "local";
  const promptSha = promptShaOf(cap);
  const keyOf = (r) => checkpointKey(ranker, cap, promptSha, r);
  const concurrency = concurrencyOverride !== void 0 ? Math.max(1, Math.min(8, Number(concurrencyOverride) || 1)) : Math.max(1, Math.min(8, Number(cfg.rank_concurrency || 1)));
  const results = await mapLimit(rows, concurrency, async (r) => {
    const key = keyOf(r);
    if (ckpt.has(key)) return { r, score: Number(ckpt.get(key)), source: "local_quad_ckpt", retries: 0 };
    let retries2 = 0;
    try {
      const st = state(byPath, r.a_path, r.b_path, cap);
      const prompt = "Evidence:\n" + st + "\n\nQuestion: " + QUESTION + "\nOptions:\n" + Object.values(OPTIONS).map((v, k) => String.fromCharCode(65 + k) + ") " + v).join("\n") + "\nAnswer:";
      const score = Math.round(await withRetry(() => askLocal(prompt, cfg, signal), {
        retries: cfg.rank_retries,
        baseMs: cfg.rank_retry_backoff_ms,
        signal,
        onRetry: () => {
          retries2 += 1;
        }
      }) * 1e4) / 1e4;
      return { r, score, source: "local_quad", retries: retries2 };
    } catch (exc) {
      if (signal && signal.aborted) throw exc;
      return { r, error: String(exc).slice(0, 140), retries: retries2 };
    }
  }, signal);
  const scored = [];
  const failures = [];
  let retries = 0;
  for (const x of results) {
    retries += Number(x.retries || 0);
    if (x.error) failures.push({ a: x.r.a, b: x.r.b, error: x.error });
    else {
      const r2 = Object.assign({}, x.r);
      r2.rank_score = x.score;
      r2.rank_source = x.source;
      scored.push(r2);
    }
  }
  for (const x of results) if (!x.error && x.source === "local_quad") {
    ckpt.set(keyOf(x.r), x.score);
  }
  return [scored, failures, retries];
}
async function scoreRemote(rows, byPath, cfg, signal) {
  const url = String(cfg.rank_api_url || "").trim();
  const envName = String(cfg.rank_api_key_env || "BAMBOO_API_KEY").trim() || "BAMBOO_API_KEY";
  const key = process.env[envName] || "";
  if (!url) return [[], rows.map((r) => ({ a: r.a, b: r.b, error: "rank_api_url \u672A\u914D\u7F6E" })), "rank_api_url \u672A\u914D\u7F6E"];
  if (!key) return [[], rows.map((r) => ({ a: r.a, b: r.b, error: "\u73AF\u5883\u53D8\u91CF " + envName + " \u672A\u8BBE\u7F6E" })), "\u73AF\u5883\u53D8\u91CF " + envName + " \u672A\u8BBE\u7F6E"];
  const cap = Number(cfg.rank_cap || 5e3);
  const concurrency = Math.max(1, Math.min(8, Number(cfg.rank_concurrency || 1)));
  const model = String(cfg.rank_api_model || "startlux-decision-27b-autothink");
  const thinkMode = String(cfg.rank_api_think_mode || "never");
  const timeoutMs = Math.max(1e3, Number(cfg.rank_api_timeout || 120) * 1e3);
  const results = await mapLimit(rows, concurrency, async (r) => {
    let retries2 = 0;
    try {
      const score = await withRetry(async () => {
        const st = state(byPath, r.a_path, r.b_path, cap);
        const body = {
          model,
          state: st,
          questions: { pair: { type: "choice", instructions: QUESTION, criteria: OPTIONS } },
          think_mode: thinkMode,
          allow_none: false,
          none_check: false
        };
        const resp = await proxiedFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify(body),
          signal: withTimeout(signal, timeoutMs)
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 160));
        const data = await resp.json();
        const probabilities = data && data.answers && data.answers.pair && data.answers.pair.probabilities;
        if (!probabilities) throw new Error("\u8FD4\u56DE\u7F3A\u5C11 answers.pair.probabilities");
        const a = Number(probabilities.a);
        const b = Number(probabilities.b);
        const c = Number(probabilities.c);
        const d = Number(probabilities.d);
        if (![a, b, c, d].every(Number.isFinite)) throw new Error("probabilities \u7F3A\u5C11 a/b/c/d");
        return Math.round((c + 0.5 * (a + b)) * 1e4) / 1e4;
      }, { retries: cfg.rank_retries, baseMs: cfg.rank_retry_backoff_ms, signal, onRetry: () => {
        retries2 += 1;
      } });
      return { r, score, source: "api_quad", retries: retries2 };
    } catch (exc) {
      if (signal && signal.aborted) throw exc;
      return { r, error: String(exc).slice(0, 160), retries: retries2 };
    }
  }, signal);
  const scored = [];
  const failures = [];
  let retries = 0;
  for (const x of results) {
    retries += Number(x.retries || 0);
    if (x.error) failures.push({ a: x.r.a, b: x.r.b, error: x.error });
    else {
      const r2 = Object.assign({}, x.r);
      r2.rank_score = x.score;
      r2.rank_source = x.source;
      scored.push(r2);
    }
  }
  const reason = failures.length ? failures[0].error : "";
  return [scored, failures, reason, retries];
}
async function rerank(rows, byPath, cfg, opts) {
  const signal = opts && opts.signal;
  throwIfAborted(signal);
  const t0 = Date.now();
  const requested = String(cfg.rank_mode || "auto");
  const stats = {
    mode_requested: requested,
    mode_used: null,
    degraded: false,
    reason: "",
    reason_code: null,
    n_in: rows.length,
    n_out: 0,
    n: Number(cfg.rank_n || 20),
    cap: Number(cfg.rank_cap || 5e3),
    ckpt_hits: 0,
    ckpt_all: false,
    attempts: [],
    local_scored: 0,
    local_failed: 0,
    rank_retries: 0,
    failures: [],
    vec_ranker: { id: "vec", modelId: "vec:cosine", scoreRange: [0, 1] }
  };
  let apiPartial = null;
  if (!rows.length) {
    stats.mode_used = "none";
    stats.reason = "\u65E0\u5019\u9009";
    stats.secs = (Date.now() - t0) / 1e3;
    return [[], stats];
  }
  if (requested === "api" || requested === "auto" && apiKeyConfigured(cfg)) {
    const apiModelId = String(cfg.rank_api_model || "startlux-decision-27b-autothink");
    const apiProvider = makeRankerProvider({ id: "api:" + apiModelId, modelId: apiModelId, scoreRange: RANKER_SCORE_RANGE, score: async (rs, bp, o) => {
      const [scored, failures, reason, retries] = await scoreRemote(rs, bp, cfg, o && o.signal);
      return { scored, failures, reason, retries };
    } });
    stats.api_ranker = { id: apiProvider.id, modelId: apiProvider.modelId, scoreRange: apiProvider.scoreRange };
    const apiRes = await apiProvider.score(rows, byPath, { signal });
    const apiScored = apiRes.scored || [];
    const apiFailures = apiRes.failures || [];
    const apiReason = apiRes.reason || "";
    stats.rank_retries += Number(apiRes.retries || 0);
    stats.api_scored = apiScored.length;
    stats.api_failed = apiFailures.length;
    stats.api_reason = apiReason;
    if (apiFailures.length === 0 && apiScored.length === rows.length) {
      apiScored.sort((x, y) => (Number(y.rank_score) || 0) - (Number(x.rank_score) || 0) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      const picked2 = apiScored.slice(0, stats.n);
      picked2.forEach((r, i) => {
        r.rank_rank = i + 1;
      });
      stats.mode_used = "api";
      stats.reason = "API \u7CBE\u6392\u53EF\u7528";
      stats.n_out = picked2.length;
      stats.secs = Math.round((Date.now() - t0) / 100) / 10;
      return [picked2, stats];
    }
    stats.attempts.push({ tier: "api", phase: "run", ok: false, reasonCode: "api-unavailable", error: apiReason || "unknown" });
    if (apiScored.length > 0) {
      apiPartial = { scored: apiScored, failures: apiFailures };
      stats.api_partial = true;
      stats.degraded = true;
      stats.reason_code = "api-partial";
      stats.reason = "API \u90E8\u5206\u6210\u529F\uFF0C\u4EC5\u5931\u8D25\u884C\u56DE\u9000\u672C\u5730/\u5411\u91CF";
      stats.attempts.push({ tier: "api", phase: "run", ok: true, reasonCode: "partial", error: apiFailures.length + " \u5BF9\u5931\u8D25" });
    }
  }
  const apiScoredKeys = new Set((apiPartial ? apiPartial.scored : []).map((r) => r.a_path + "\0" + r.b_path));
  const workRows = apiPartial ? rows.filter((r) => !apiScoredKeys.has(r.a_path + "\0" + r.b_path)) : rows;
  let picked = null;
  if (requested === "vec") {
    picked = vecSelect(rows, cfg);
    stats.mode_used = "vec";
    stats.reason = "\u663E\u5F0F\u6307\u5B9A vec";
  } else {
    const tiers = localTiers(cfg);
    stats.local_chain = tiers.map((t) => t.name);
    let firstFailReason = "";
    let used = null;
    for (let ti = 0; ti < tiers.length; ti += 1) {
      const tier = tiers[ti];
      const r = await scoreTier(tier, workRows, byPath, cfg, tierCheckpointPath(cfg, tier, ti), signal);
      stats.ckpt_hits += r.ckpt.hits;
      stats.rank_retries += Number(r.retries || 0);
      if (!r.probeOk) {
        stats.attempts.push({ tier: tier.name, phase: "probe", ok: false, reasonCode: classifyReason(r.probeReason), error: r.probeReason });
        if (!firstFailReason) firstFailReason = r.probeReason;
        continue;
      }
      stats.rank_concurrency_requested = r.requestedConc;
      stats.rank_concurrency_used = r.conc;
      stats.rank_slots = r.slotsInfo && r.slotsInfo.slots;
      stats.rank_slots_reason = r.slotsInfo && r.slotsInfo.reason;
      stats.local_scored += r.scored.length;
      stats.local_failed += r.failures.length;
      stats.attempts.push(...r.failures.map((f) => ({ tier: tier.name, phase: "run", ok: false, reasonCode: classifyReason(f.error), error: f.error })).slice(0, 20));
      if (!r.scored.length) {
        if (!firstFailReason) firstFailReason = r.failures.length ? r.failures[0].error : "\u672C\u5730\u6253\u5206\u5168\u90E8\u5931\u8D25";
        continue;
      }
      used = r;
      stats.local_tier_used = tier.name;
      stats.local_ranker = { id: "local:" + tier.name, modelId: tier.name, scoreRange: [0, 1] };
      break;
    }
    if (!used) {
      picked = vecSelect(workRows, cfg);
      stats.mode_used = "vec";
      stats.degraded = true;
      stats.reason_code = firstFailReason ? classifyReason(firstFailReason) : "all-down";
      stats.reason = "\u672C\u5730\u7CBE\u6392\u94FE\u5168\u90E8\u4E0D\u53EF\u7528 \u21D2 \u5411\u91CF\u53E3\u5F84: " + String(firstFailReason || "\u65E0\u672C\u5730\u5019\u9009").slice(0, 160);
    } else if (used.allCached && !used.failures.length) {
      const scored = used.scored.slice().sort((x, y) => (Number(y.rank_score) || 0) - (Number(x.rank_score) || 0) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      picked = scored.slice(0, stats.n);
      stats.ckpt_all = true;
      stats.mode_used = "local";
      stats.reason = "\u5168\u90E8\u547D\u4E2D checkpoint\uFF080 \u8C03\u7528\uFF0Ctier=" + used.tier.name + "\uFF09";
    } else if (used.failures.length) {
      const scored = used.scored.slice().sort((x, y) => (Number(y.rank_score) || 0) - (Number(x.rank_score) || 0) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      picked = scored.slice(0, stats.n);
      const have = new Set(picked.map((x) => x.a_path + "\0" + x.b_path));
      const rest = workRows.filter((x) => !have.has(x.a_path + "\0" + x.b_path));
      const fill = vecSelect(rest, cfg);
      for (const x of fill) x.rank_source = "vec_fallback";
      picked = picked.concat(fill.slice(0, stats.n - picked.length));
      stats.mode_used = "local_partial";
      stats.degraded = true;
      stats.reason_code = "partial-fill";
      stats.reason = used.failures.length + " \u5BF9\u672C\u5730\u6253\u5206\u5931\u8D25\uFF08tier=" + used.tier.name + "\uFF09\uFF0C\u5176\u4F59\u6309\u5411\u91CF\u53E3\u5F84\u8865\u4F4D";
      stats.failures = used.failures.slice(0, 10);
    } else {
      const scored = used.scored.slice().sort((x, y) => (Number(y.rank_score) || 0) - (Number(x.rank_score) || 0) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
      picked = scored.slice(0, stats.n);
      stats.mode_used = "local";
      stats.reason = "\u672C\u5730\u7CBE\u6392\u53EF\u7528\uFF08tier=" + used.tier.name + "\uFF09";
    }
  }
  if (apiPartial) {
    const localMode = stats.mode_used;
    const seen = /* @__PURE__ */ new Set();
    const combined = [];
    for (const row of apiPartial.scored.concat(picked || [])) {
      const key = row.a_path + "\0" + row.b_path;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(row);
    }
    combined.sort((x, y) => (Number(y.rank_score) || 0) - (Number(x.rank_score) || 0) || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
    picked = combined.slice(0, stats.n);
    stats.mode_used = "api_partial";
    stats.degraded = true;
    stats.reason_code = "api-partial";
    stats.reason = "API \u90E8\u5206\u6210\u529F\uFF0C\u4EC5 " + apiPartial.failures.length + " \u5BF9\u5931\u8D25\u884C\u56DE\u9000\uFF08" + localMode + "\uFF09";
  }
  picked.forEach((r, i) => {
    r.rank_rank = i + 1;
  });
  stats.n_out = picked.length;
  stats.secs = Math.round((Date.now() - t0) / 100) / 10;
  return [picked, stats];
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/rerank.js
var rerankStage = defineStage({
  id: "rerank",
  requires: ["semantic"],
  async run(ctx, env) {
    const [ranked, stats] = await rerank(env.semantic.selected, env.semantic.byPath, ctx.cfg, { signal: ctx.signal });
    return { data: { ranked }, stats, counters: { n_in: stats.n_in, n_out: stats.n_out }, degraded: stats.degraded === true };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/judge.js
import path15 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/cascade.js
import path14 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/prompt.js
import crypto5 from "node:crypto";
var PROMPT_VERSION = "judge-prompt-v1";
var SYSTEM2 = [
  "You judge whether two agent-skill documents describe the SAME reusable capability that should be merged.",
  "Sharing vocabulary or a common preamble is NOT duplication.",
  "Reply with STRICT JSON only.",
  "verdict=1 means they should be merged; verdict=-1 means they are clearly different; verdict=0 means the given material is not enough to decide."
].join("\n");
var L0_NOTE_PLAIN = "\u4EC5\u51ED\u540D\u79F0\u4E0E\u63CF\u8FF0\u5224\u65AD\uFF1B\u82E5\u4E0D\u591F\u5224\u65AD\u8BF7\u56DE 0\uFF0C\u4E0D\u8981\u731C\u3002";
var L0_NOTE_CAUTION = "\u4EC5\u51ED\u540D\u79F0\u4E0E\u63CF\u8FF0\u5224\u65AD\u3002\u8C28\u614E\u51B3\u7B56\uFF1A\u53EA\u6709\u5F53\u4E24\u8005\u660E\u663E\u5C5E\u4E8E\u4E0D\u540C\u80FD\u529B\u57DF\u65F6\u624D\u56DE -1\uFF1B\u53EA\u8981\u5B58\u5728\u540C\u4E00\u79CD\u53EF\u590D\u7528\u80FD\u529B\u7684\u53EF\u80FD\uFF0C\u5C31\u56DE 0 \u4EA4\u7ED9\u4E0B\u4E00\u7EA7\uFF08\u4E0B\u4E00\u7EA7\u80FD\u770B\u5230\u80FD\u529B\u5BA3\u8A00\uFF09\u3002";
var SCHEMA = { verdict: "1 | 0 | -1", reason: "<one sentence, in Chinese>", evidence: [{ path: "<file>", line: "<n or -1>", quote: "<short quote>" }] };
var EVIDENCE_ORDER = ["jaccard_summary", "jaccard_body", "body_cosine", "summary_cosine"];
function promptScores(evidence) {
  const ev = evidence || {};
  const out = {};
  for (const key of EVIDENCE_ORDER) {
    if (ev[key] === void 0 || ev[key] === null) continue;
    out[key] = ev[key];
  }
  return out;
}
function buildPrompt(level, a, b, evidence, cfg) {
  let payload;
  if (level === "L0") {
    payload = {
      level: "L0",
      skill_a: { id: a.name, name: a.name, description: a.description },
      skill_b: { id: b.name, name: b.name, description: b.description },
      scores: promptScores(evidence),
      note: cfg.l0_caution ? L0_NOTE_CAUTION : L0_NOTE_PLAIN,
      schema: SCHEMA
    };
  } else if (level === "L1") {
    payload = {
      level: "L1",
      skill_a: { id: a.name, description: a.description, head: headExtract(a) },
      skill_b: { id: b.name, description: b.description, head: headExtract(b) },
      scores: promptScores(evidence),
      note: "\u8FD9\u662F\u4E24\u4EFD\u6280\u80FD\u7684\u80FD\u529B\u5BA3\u8A00\u6BB5\u4E0E\u89E6\u53D1\u6761\u4EF6\uFF1B\u4ECD\u4E0D\u8DB3\u8BF7\u56DE 0\u3002",
      schema: SCHEMA
    };
  } else {
    const mc = cfg.judge_max_chars_per_skill;
    payload = {
      level: "L2",
      skill_a: { id: a.name, description: a.description, body_excerpt: bodyExcerpt(a, mc) },
      skill_b: { id: b.name, description: b.description, body_excerpt: bodyExcerpt(b, mc) },
      head_a: headExtract(a),
      head_b: headExtract(b),
      scores: promptScores(evidence),
      note: "\u6B63\u6587\u5173\u952E\u6BB5\u5DF2\u7ED9\u51FA\uFF1B\u82E5\u4ECD\u4E0D\u8DB3\u8BF7\u56DE 0\uFF08\u4F1A\u8BB0\u4E3A UNDECIDED\uFF09\u3002",
      schema: SCHEMA
    };
  }
  return JSON.stringify(payload, null, 2);
}
function canonicalStringify(value) {
  function norm(v) {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  }
  return JSON.stringify(norm(value));
}
function promptDigest(level, prompt) {
  const rec = { version: PROMPT_VERSION, level, prompt };
  return crypto5.createHash("sha256").update(canonicalStringify(rec)).digest("hex");
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/stub.js
var STUB_VERSION = "stub-v1";
var STUB2_VERSION = "stub-v2";
var V1 = Object.freeze({
  l0: Object.freeze({ merge: 0.6, forward: 0.45 }),
  l1: Object.freeze({ merge: 0.95, forward: 0.9 }),
  l2: Object.freeze({ merge: 0.94 })
});
var DEFAULT_STUB2_FLOORS = Object.freeze({ body: 0.95, summary: 0.6 });
function scoreFor(level, evidence) {
  const body = evidence.body_cosine;
  const summ = evidence.summary_cosine;
  if (level === "L0") return summ !== void 0 && summ !== null ? summ : evidence.jaccard_summary || 0;
  return body !== void 0 && body !== null ? body : 0;
}
function stubVerdict(level, evidence) {
  const s = scoreFor(level, evidence);
  let v;
  if (level === "L0") v = s >= V1.l0.merge ? 1 : s >= V1.l0.forward ? 0 : -1;
  else if (level === "L1") v = s >= V1.l1.merge ? 1 : s >= V1.l1.forward ? 0 : -1;
  else v = s >= V1.l2.merge ? 1 : -1;
  return { verdict: v, reason: "stub(\u542F\u53D1\u5F0F): score=" + Number(s).toFixed(3), evidence: [] };
}
function stubVerdictV2(level, evidence, floors) {
  const f = Object.assign({}, DEFAULT_STUB2_FLOORS, floors || {});
  const s = scoreFor(level, evidence);
  const th = level === "L0" ? f.summary : f.body;
  let v;
  if (level === "L2") v = s >= th ? 1 : -1;
  else v = s >= th ? 1 : 0;
  return { verdict: v, reason: "stub2(\u5730\u677F\u9A71\u52A8): score=" + Number(s).toFixed(3) + " floor=" + Number(th).toFixed(3), evidence: [] };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/deepseek.js
var USAGE2 = { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 };
var EFFORT_WIRE = {
  off: { thinking: { type: "disabled" } },
  high: { thinking: { type: "enabled" }, reasoning_effort: "high" },
  max: { thinking: { type: "enabled" }, reasoning_effort: "max" }
};
function priceOf2(cfg, model) {
  const table = cfg.judge_price_cny_per_ktok || {};
  const p = table[model || cfg.judge_model] || {};
  return { input: Number(p.input || 0), output: Number(p.output || 0) };
}
async function callDeepseek(prompt, cfg) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("\u672A\u8BBE DEEPSEEK_API_KEY\uFF08\u8BBE\u4E86\u624D\u8D70\u771F\u5B9E\u5224\u51B3\uFF1B\u5426\u5219\u7528 --judge stub\uFF09");
  const body = { model: cfg.judge_model, messages: [{ role: "system", content: SYSTEM2 }, { role: "user", content: prompt }], temperature: 0 };
  Object.assign(body, EFFORT_WIRE[cfg.judge_effort || "high"] || {});
  const resp = await proxiedFetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 160));
  const data = await resp.json();
  const u = data.usage || {};
  const pt = Number(u.prompt_tokens || 0);
  const ct = Number(u.completion_tokens || 0);
  const price = priceOf2(cfg);
  USAGE2.calls += 1;
  USAGE2.prompt_tokens += pt;
  USAGE2.completion_tokens += ct;
  USAGE2.cost_cny += pt / 1e3 * price.input + ct / 1e3 * price.output;
  return data.choices[0].message.content;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/cache.js
import crypto6 from "node:crypto";
import path13 from "node:path";
var CACHE_VERSION = 1;
function cacheKey(promptSha, model, params) {
  return crypto6.createHash("sha256").update(JSON.stringify({ promptSha: String(promptSha), model: String(model || ""), params: params || {} })).digest("hex");
}
var VerdictCache = class {
  constructor(filePath) {
    this.file = filePath || "";
    this.data = {};
    this.stats = { enabled: true, hits: 0, misses: 0, size: 0 };
    this.dirty = false;
    this._load();
  }
  _load() {
    try {
      if (this.file && exists(this.file)) {
        const j = readJson(this.file);
        if (j && typeof j === "object" && j.entries && typeof j.entries === "object" && !Array.isArray(j.entries)) {
          this.data = j.entries;
          this.stats.size = Object.keys(this.data).length;
        }
      }
    } catch (e) {
      this.data = {};
    }
  }
  get(key) {
    const e = this.data[key];
    if (e && e.verdict !== void 0) {
      this.stats.hits += 1;
      return { verdict: e.verdict, reason: e.reason || "", evidence: e.evidence || [], cached: true };
    }
    this.stats.misses += 1;
    return null;
  }
  put(key, verdict) {
    this.data[key] = { verdict: verdict.verdict, reason: verdict.reason || "", evidence: verdict.evidence || [] };
    this.dirty = true;
    this.stats.size = Object.keys(this.data).length;
  }
  flush() {
    if (!this.dirty || !this.file) return;
    writeJson(this.file, { version: CACHE_VERSION, entries: this.data });
    this.dirty = false;
  }
};
function openVerdictCache(cfg, promptDir) {
  if (!cfg || !cfg.judge_cache) return null;
  const file = cfg.judge_cache_path ? String(cfg.judge_cache_path) : path13.join(promptDir, "judge_cache.json");
  return new VerdictCache(file);
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/evidence.js
var EVIDENCE_KEYS = Object.freeze(["jaccard_summary", "jaccard_body", "body_cosine", "summary_cosine"]);
function numOrNull(v) {
  if (v === void 0 || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function buildEvidence(row) {
  const r = row || {};
  return {
    jaccard_summary: numOrNull(r.jaccard_summary),
    jaccard_body: numOrNull(r.jaccard_body),
    body_cosine: numOrNull(r.body_cosine !== void 0 && r.body_cosine !== null ? r.body_cosine : r.body_core_cosine),
    summary_cosine: numOrNull(r.summary_cosine)
  };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/provider.js
import crypto7 from "node:crypto";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/verdict.js
function parseVerdict(raw) {
  let t = String(raw).trim();
  if (t.startsWith("```")) {
    t = t.replace(/`/g, "");
    const idx = t.indexOf("\n");
    if (idx >= 0) t = t.slice(idx + 1);
  }
  let obj;
  try {
    obj = JSON.parse(t);
  } catch (e) {
    const m = /\{[\s\S]*\}/.exec(t);
    if (!m) throw e;
    obj = JSON.parse(m[0]);
  }
  const v = obj.verdict;
  obj.verdict = String(v).trim() === "1" || String(v).trim() === "0" || String(v).trim() === "-1" ? parseInt(v, 10) : 0;
  return obj;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/provider.js
function sha256(s) {
  return crypto7.createHash("sha256").update(String(s)).digest("hex");
}
function providerId(mode, cfg) {
  if (mode === "deepseek") return "deepseek:" + String(cfg.judge_model || "deepseek-flash");
  return "stub:" + (mode === "stub2" ? STUB2_VERSION : STUB_VERSION);
}
function makeJudgeProvider(spec) {
  const s = spec || {};
  const provider = {
    id: String(s.id || ""),
    mode: String(s.mode || ""),
    promptSha: String(s.promptSha || ""),
    heuristic: !!s.heuristic,
    fallback: String(s.fallback || ""),
    judge: s.judge
  };
  return assertJudgeProvider(provider);
}
function assertJudgeProvider(provider) {
  if (!provider || typeof provider !== "object") throw new InvalidDataError("judge provider \u5FC5\u987B\u662F\u5BF9\u8C61", { where: "judge-provider" });
  if (!provider.id) throw new InvalidDataError("judge provider \u7F3A\u5C11 id", { where: "judge-provider" });
  if (typeof provider.promptSha !== "string" || !/^[0-9a-f]{64}$/.test(provider.promptSha)) throw new InvalidDataError("judge provider promptSha \u975E\u6CD5: " + provider.id, { where: "judge-provider" });
  if (typeof provider.heuristic !== "boolean") throw new InvalidDataError("judge provider heuristic \u5FC5\u987B\u662F\u5E03\u5C14: " + provider.id, { where: "judge-provider" });
  if (typeof provider.judge !== "function") throw new InvalidDataError("judge provider \u7F3A\u5C11 judge(rows): " + provider.id, { where: "judge-provider" });
  return provider;
}
function resolveJudgeProvider(cfg, env) {
  const c = cfg || {};
  const e = env || process.env;
  const requested = String(c.judge || "stub");
  let mode = requested;
  let fallback = "";
  if (requested === "auto") {
    if (e && e.DEEPSEEK_API_KEY) mode = "deepseek";
    else {
      mode = "stub";
      fallback = "\u672A\u8BBE DEEPSEEK_API_KEY \u21D2 \u2464 \u9000\u5316\u4E3A stub\uFF0C\u5019\u9009\u672A\u5224\u51B3";
    }
  }
  if (!["stub", "stub2", "deepseek"].includes(mode)) throw new InvalidDataError("\u672A\u77E5 judge provider: " + mode + "\uFF08\u53EF\u9009: stub/stub2/deepseek/auto\uFF09", { where: "judge-provider" });
  const id = providerId(mode, c);
  const promptSha = sha256(PROMPT_VERSION + "|" + id);
  if (mode === "deepseek") {
    return makeJudgeProvider({ id, mode, promptSha, heuristic: false, fallback, judge: async (rows, ctx) => {
      const runner = ctx && ctx.runner;
      if (typeof runner !== "function") throw new UnavailableError("deepseek judge \u9700\u8981 ctx.runner(prompt,cfg)", { where: "judge-provider" });
      const out = [];
      for (const r of rows || []) out.push(parseVerdict(await runner(String(r.prompt || ""), ctx && ctx.cfg || c)));
      return out;
    } });
  }
  const stubFn = mode === "stub2" ? (level, ev) => stubVerdictV2(level, ev, c.stub2_floors || {}) : stubVerdict;
  return makeJudgeProvider({ id, mode, promptSha, heuristic: true, fallback, judge: async (rows) => (rows || []).map((r) => stubFn(r.level, r.evidence || {})) });
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/judge/cascade.js
var ROUTE = { l0_forward: [1, 0], l1_forward: [0] };
function resolveJudge(cfg, env) {
  const p = resolveJudgeProvider(cfg, env);
  return { mode: p.mode, fallback: p.fallback || "" };
}
async function runLevel(level, a, b, evidence, cfg, runner, stubFn, cache) {
  const prompt = buildPrompt(level, a, b, evidence, cfg);
  const sha = promptDigest(level, prompt);
  if (runner === null || runner === void 0) return [stubFn(level, evidence, a, b), prompt, sha];
  const key = cache ? cacheKey(sha, cfg.judge_model, { effort: cfg.judge_effort || "", temperature: 0 }) : "";
  if (cache) {
    const hit = cache.get(key);
    if (hit) return [hit, prompt, sha];
  }
  try {
    const verdict = parseVerdict(await runner(prompt, cfg));
    if (cache) cache.put(key, verdict);
    return [verdict, prompt, sha];
  } catch (exc) {
    return [{ verdict: 0, reason: "ERROR " + String(exc).slice(0, 160), evidence: [], error: true }, prompt, sha];
  }
}
async function judgeCascade(pairs, byPath, cfg, promptDir, runner) {
  const parity = cfg.parity_bytes === true || cfg.io_dialect === "python";
  const eol = parity ? "crlf" : "lf";
  const writePrompt = (pf, text) => writeText(pf, text, { eol });
  const cache = openVerdictCache(cfg, promptDir);
  const provider = resolveJudgeProvider(cfg, process.env);
  const mode = provider.mode;
  const autoFallback = !!provider.fallback;
  if ((runner === null || runner === void 0) && mode === "deepseek") runner = callDeepseek;
  const stubFn = mode === "stub2" ? (level, ev, a, b) => stubVerdictV2(level, ev, a, b, cfg.stub2_floors || {}) : stubVerdict;
  const out = [];
  Object.assign(USAGE2, { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 });
  const stats = { cache: cache ? Object.assign({}, cache.stats) : { enabled: false, hits: 0, misses: 0, size: 0 }, pairs: pairs.length, model: cfg.judge_model, prompt_version: PROMPT_VERSION, stub_version: mode === "stub2" ? STUB2_VERSION : STUB_VERSION, judge_mode: mode, judge_provider: { id: provider.id, promptSha: provider.promptSha, heuristic: provider.heuristic }, judge_auto_fallback: autoFallback, levels: { L0: 0, L1: 0, L2: 0 }, verdicts: { "1": 0, "0": 0, "-1": 0 }, l0_forwarded: 0, l1_forwarded: 0, l0_verdicts: { "1": 0, "0": 0, "-1": 0 }, l1_verdicts: { "1": 0, "0": 0, "-1": 0 }, l0_dropped: 0, undecided: 0, errors: 0, audit_pool: 0, audit_sampled: 0, audit_overrides: 0, usage: {} };
  for (let i = 0; i < pairs.length; i += 1) {
    const r = pairs[i];
    const a = byPath.get(r.a_path), b = byPath.get(r.b_path);
    const evidence = buildEvidence(r);
    const trail = [], promptFiles = [];
    const emitPrompt = (pf2, text) => {
      if (cfg.write_prompts === true) {
        writePrompt(pf2, text);
        promptFiles.push(pf2);
      }
    };
    let levelUsed = null, final = null;
    let [v0, p0, s0] = await runLevel("L0", a, b, evidence, cfg, runner, stubFn, cache);
    trail.push(Object.assign({ level: "L0", prompt_sha: s0 }, v0));
    let finalSha = s0;
    stats.l0_verdicts[String(v0.verdict)] += 1;
    let pf = path14.join(promptDir, String(i + 1).padStart(3, "0") + "_" + a.name + "__" + b.name + "_L0.md");
    emitPrompt(pf, p0);
    if (ROUTE.l0_forward.includes(v0.verdict)) {
      stats.l0_forwarded += 1;
      let [v1, p1, s1] = await runLevel("L1", a, b, evidence, cfg, runner, stubFn, cache);
      trail.push(Object.assign({ level: "L1", prompt_sha: s1 }, v1));
      finalSha = s1;
      stats.l1_verdicts[String(v1.verdict)] += 1;
      pf = path14.join(promptDir, String(i + 1).padStart(3, "0") + "_" + a.name + "__" + b.name + "_L1.md");
      emitPrompt(pf, p1);
      if (ROUTE.l1_forward.includes(v1.verdict)) {
        stats.l1_forwarded += 1;
        const [v2, p2, s2] = await runLevel("L2", a, b, evidence, cfg, runner, stubFn, cache);
        trail.push(Object.assign({ level: "L2", prompt_sha: s2 }, v2));
        finalSha = s2;
        pf = path14.join(promptDir, String(i + 1).padStart(3, "0") + "_" + a.name + "__" + b.name + "_L2.md");
        emitPrompt(pf, p2);
        levelUsed = "L2";
        final = v2;
        if (v2.verdict === 0) stats.undecided += 1;
      } else {
        levelUsed = "L1";
        final = v1;
      }
    } else {
      stats.l0_dropped += 1;
      levelUsed = "L0";
      final = v0;
    }
    stats.levels[levelUsed] += 1;
    const rowError = !!final.error;
    if (rowError) stats.errors += 1;
    stats.verdicts[String(final.verdict)] += 1;
    const action = final.verdict === 1 ? "MERGE" : final.verdict === 0 ? levelUsed === "L2" ? "UNDECIDED" : "ESCALATED" : "KEEP_BOTH";
    const row = Object.assign({}, r, {
      error: rowError,
      level: levelUsed,
      verdict_id: final.verdict,
      action,
      reason: final.reason,
      prompt_sha: finalSha,
      prompt_files: promptFiles,
      trail,
      judge_id: provider.id,
      heuristic: provider.heuristic,
      verdict_record: { level: levelUsed, verdict: final.verdict, action, reason: String(final.reason).slice(0, 240), prompt_sha: finalSha, model: cfg.judge_model, judge_id: provider.id, heuristic: provider.heuristic },
      evidence: final.evidence || []
    });
    out.push(row);
  }
  const poolIdx = out.map((r, i) => i).filter((i) => out[i].level === "L0" && out[i].verdict_id === -1);
  stats.audit_pool = poolIdx.length;
  if (poolIdx.length) {
    const k = Math.ceil(0.1 * poolIdx.length);
    const rng = new PyRandom(Number(cfg.audit_seed || 1) + poolIdx.length);
    const pickedIdx = rng.sample(poolIdx, Math.min(k, poolIdx.length));
    let changed = 0;
    for (const i of pickedIdx) {
      const r = out[i];
      const a = byPath.get(r.a_path), b = byPath.get(r.b_path);
      const ev = buildEvidence(r);
      const [v2, p2, s2] = await runLevel("L2", a, b, ev, cfg, runner, stubFn, cache);
      r.trail = r.trail || [];
      r.trail.push(Object.assign({ level: "L2(audit)", prompt_sha: s2 }, v2));
      r.audit_sampled = true;
      if (v2.verdict !== -1) {
        changed += 1;
        r.verdict_id = v2.verdict;
        r.action = v2.verdict === 1 ? "MERGE" : v2.verdict === 0 ? "UNDECIDED" : "KEEP_BOTH";
        r.reason = "[\u62BD\u68C0\u6539\u5224] " + String(v2.reason);
        r.level = "L2(audit)";
        r.prompt_sha = s2;
        r.verdict_record = Object.assign({}, r.verdict_record, { level: "L2(audit)", verdict: v2.verdict, action: r.action, reason: String(r.reason).slice(0, 240), prompt_sha: s2, judge_id: provider.id, heuristic: provider.heuristic });
        r.evidence = v2.evidence || [];
      }
      stats.levels.L2 += 1;
    }
    stats.audit_sampled = pickedIdx.length;
    stats.audit_overrides = changed;
  }
  if (cache) {
    cache.flush();
    stats.cache = Object.assign({}, cache.stats);
  }
  stats.usage = Object.assign({}, USAGE2);
  stats.judge_mode = mode;
  return [out, stats];
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/judge.js
var judgeStage = defineStage({
  id: "judge",
  requires: ["semantic", "rerank"],
  async run(ctx, env) {
    const cfg = Object.assign({}, ctx.cfg);
    const resolution = resolveJudge(cfg, ctx.env);
    if (cfg.judge === "auto") cfg.judge = resolution.mode;
    if (cfg.judge === "stub2" && env.semantic && env.semantic.floors_used) {
      cfg.stub2_floors = { body: env.semantic.floors_used.body, summary: env.semantic.floors_used.summary };
      ctx.state.stub2Floors = cfg.stub2_floors;
    }
    ctx.state.judgeMode = cfg.judge;
    const [verdicts, stats] = await judgeCascade(env.rerank.ranked, env.semantic.byPath, cfg, path15.join(ctx.out, "prompts"));
    return { data: { verdicts, fallback: resolution.fallback }, stats, counters: { pairs: verdicts.length } };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/pipeline/index.js
function semanticCfg(ctx) {
  const cfg = Object.assign({}, ctx.cfg);
  const dirs = ctx.state && ctx.state.modelDirs;
  if (dirs) {
    if (dirs.int8) cfg.embedder_model = dirs.int8;
    if (dirs.pca) cfg.embedder_model_last = dirs.pca;
  }
  if (ctx.state && ctx.state.semanticTopN !== void 0) cfg.semantic_top_n = ctx.state.semanticTopN;
  return cfg;
}
function makeSemanticStage() {
  return defineStage({
    id: "semantic",
    requires: ["prefilter", "lexical"],
    async run(ctx, env) {
      const byPath = new Map(env.prefilter.kept.map((s) => [s.path, s]));
      const args = env.params && env.params.semanticArgs ? env.params.semanticArgs : {};
      const res = await runSemantic(env.lexical.passed, byPath, semanticCfg(ctx), { signal: ctx.signal });
      return { data: { selected: res.selected, scored: res.scored, byPath, floors_used: res.stats.floors_used || null }, stats: res.stats, counters: { pairs_in: res.stats.pairs_in || 0, selected: res.stats.selected || 0 }, degraded: res.stats.embedder_degraded === true };
    }
  });
}
function defaultStages() {
  return [prefilterStage, candidatesStage, lexicalStage, makeSemanticStage(), rerankStage, judgeStage];
}
function wrapProgress(stage, progress) {
  return {
    id: stage.id,
    requires: stage.requires || [],
    async run(ctx, env) {
      if (progress) progress({ phase: "stage-start", stage: stage.id });
      const res = await stage.run(ctx, env);
      if (progress) {
        const last = ctx.timings.length ? ctx.timings[ctx.timings.length - 1] : null;
        progress({ phase: "stage-done", stage: stage.id, ms: last ? last.ms : null });
      }
      return res;
    }
  };
}
async function runPipeline(options) {
  const o = options || {};
  const progress = typeof o.onProgress === "function" ? o.onProgress : null;
  const ctx = createContext({ cfg: o.cfg || {}, state: o.state, out: o.out || "", env: o.env, clock: o.clock, log: o.log, signal: o.signal });
  const stages = o.stages !== void 0 ? Array.isArray(o.stages) ? o.stages : [] : defaultStages();
  const input = o.input || {};
  let data = {};
  let results = [];
  let failure = null;
  try {
    if (progress) progress({ phase: "start", stages: stages.map((s) => s.id) });
    if (typeof o.provision === "function") {
      if (progress) progress({ phase: "provision" });
      await o.provision(ctx);
    }
    const wrapped = stages.map((s) => wrapProgress(s, progress));
    const res = await runStages(wrapped, ctx, input);
    data = res.data;
    results = res.results;
  } catch (err) {
    failure = err;
    ctx.recordError(err, "pipeline");
    if (progress) progress({ phase: "error", error: String(err && err.message ? err.message : err) });
  }
  const cleanup = ctx.dispose();
  const out = {
    ok: !failure,
    exitCode: failure ? exitCodeOf(failure) : 0,
    data,
    stages: results,
    timings: ctx.timings.slice(),
    diagnostics: ctx.diagnostics.items.slice(),
    diagnosticsSummary: ctx.diagnostics.countByCode(),
    cleanup,
    cfg: ctx.cfg
  };
  if (failure) {
    out.error = failure;
    out.diagnostic = toDiagnostic(failure, { where: "pipeline" });
  }
  if (progress) progress({ phase: failure ? "failed" : "done", stages: results.map((r) => r.id), exitCode: out.exitCode });
  return out;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/supply.js
import path19 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/firstrun.js
import path18 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/build.js
import path17 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/provision.js
import path16 from "node:path";
import { Readable as Readable2, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
var DEFAULT_ENDPOINT = "https://huggingface.co";
var HF_HOSTS = Object.freeze(["huggingface.co", "cdn-lfs.huggingface.co", "hf-mirror.com", "cdn-lfs.hf-mirror.com"]);
var HF_HOST_SUFFIXES = Object.freeze([".hf.co", ".huggingface.co", ".hf-mirror.com"]);
var DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
var delay = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function endpointOf(opts) {
  const ep = opts && opts.endpoint || process.env.HF_ENDPOINT || DEFAULT_ENDPOINT;
  return String(ep).replace(/\/+$/, "");
}
function resolveUrl(endpoint, repo, file) {
  return endpoint + "/" + repo + "/resolve/main/" + String(file).split("/").map((s) => encodeURIComponent(s)).join("/");
}
function assertUrlAllowed(url, opts) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    throw new UnavailableError("\u4E0B\u8F7D URL \u975E\u6CD5: " + url, { where: "provision" });
  }
  const insecureOk = !!(opts && opts.allowInsecure);
  if (u.protocol !== "https:" && !insecureOk) throw new UnavailableError("\u53EA\u5141\u8BB8 https \u4E0B\u8F7D\uFF08\u5F53\u524D " + u.protocol + "\uFF09: " + u.host, { where: "provision" });
  let epHost = "";
  try {
    epHost = new URL(endpointOf(opts)).host;
  } catch (e) {
  }
  const allowed = u.host === epHost || HF_HOSTS.includes(u.hostname) || HF_HOST_SUFFIXES.some((s) => u.hostname.endsWith(s));
  if (!allowed) throw new UnavailableError("\u4E0B\u8F7D\u57DF\u540D\u4E0D\u5728\u767D\u540D\u5355: " + u.host + "\uFF08\u5141\u8BB8 HF \u5B98\u65B9/\u955C\u50CF\u6216 HF_ENDPOINT \u6307\u5B9A\u57DF\uFF09", { where: "provision" });
  return u;
}
function partOf(dest) {
  return dest + ".part";
}
async function downloadFile(spec) {
  const o = spec.opts || {};
  const { url, dest, sha256: sha2562, bytes, id, file, onProgress } = spec;
  if (!Number.isInteger(bytes) || bytes <= 0) throw new InvalidDataError("\u58F0\u660E bytes \u975E\u6CD5: " + dest, { where: "provision" });
  const maxBytes = o.maxBytes === void 0 ? DEFAULT_MAX_BYTES : Number(o.maxBytes);
  if (bytes > maxBytes) throw new InvalidDataError("\u6587\u4EF6\u8D85\u8FC7\u4F53\u79EF\u4E0A\u9650: " + file + " bytes=" + bytes + " > " + maxBytes, { where: "provision" });
  ensureDir(path16.dirname(dest));
  const part = partOf(dest);
  const fetchImpl = o.fetchImpl || ((u, i) => proxiedFetch(u, i));
  let start = 0;
  if (o.resume !== false) {
    const m = fileMeta(part);
    if (m.exists) start = m.bytes;
  }
  if (start > bytes) {
    removeFile(part);
    start = 0;
  }
  if (start > 0 && start === bytes) {
    if (hashFile(part) === sha2562) {
      renameFile(part, dest);
      return { downloaded: 0, resumed: true };
    }
    removeFile(part);
    start = 0;
  }
  const doFetch = (s) => fetchImpl(url, { headers: s > 0 ? { Range: "bytes=" + s + "-" } : {}, redirect: "follow", signal: o.signal });
  const sleep2 = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
  const fetchWithRetry = async (s) => {
    const attempts = 4;
    let lastErr = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let resp2;
      try {
        resp2 = await doFetch(s);
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        lastErr = err;
        if (attempt === attempts - 1) break;
        await sleep2(400 * (attempt + 1));
        continue;
      }
      assertUrlAllowed(resp2.url || url, o);
      if (resp2.status === 429 || resp2.status >= 500) {
        if (attempt === attempts - 1) return resp2;
        const ra = Number(resp2.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1e3, 8e3) : 400 * Math.pow(2, attempt);
        try {
          if (resp2.body && typeof resp2.body.cancel === "function") await resp2.body.cancel();
        } catch (ignore) {
        }
        await sleep2(wait);
        continue;
      }
      return resp2;
    }
    throw new UnavailableError("\u4E0B\u8F7D\u5931\u8D25: " + url + " (" + String(lastErr && lastErr.message ? lastErr.message : lastErr) + ")", { where: "provision", retryable: true, cause: lastErr });
  };
  let resp = await fetchWithRetry(start);
  if (start > 0 && resp.status === 206) {
    const cr = resp.headers.get("content-range") || "";
    const m = /bytes\s+(\d+)-/.exec(cr);
    if (m && Number(m[1]) !== start) {
      removeFile(part);
      start = 0;
      resp = await fetchWithRetry(0);
    }
  } else if (start > 0 && resp.status !== 206) {
    removeFile(part);
    start = 0;
  }
  if (!resp.ok) throw new UnavailableError("\u4E0B\u8F7D HTTP " + resp.status + ": " + url, { where: "provision", retryable: resp.status >= 500 || resp.status === 429 });
  const offset = start;
  let received = offset;
  const ws = createWriteStream(part, offset > 0 ? "a" : "w");
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > bytes) return cb(new InvalidDataError("\u4E0B\u8F7D\u5185\u5BB9\u8D85\u8FC7\u58F0\u660E\u5927\u5C0F: " + file, { where: "provision" }));
      if (typeof onProgress === "function") onProgress({ id, file, received, total: bytes });
      cb(null, chunk);
    }
  });
  try {
    await pipeline(Readable2.fromWeb(resp.body), counter, ws);
  } catch (err) {
    removeFile(part);
    if (err && err.name === "AbortError") throw err;
    if (err instanceof InvalidDataError) throw err;
    throw new UnavailableError("\u4E0B\u8F7D\u4E2D\u65AD: " + url + " (" + String(err && err.message ? err.message : err) + ")", { where: "provision", retryable: true, cause: err });
  }
  const meta = fileMeta(part);
  if (meta.bytes !== bytes) {
    removeFile(part);
    throw new InvalidDataError("\u4E0B\u8F7D\u5927\u5C0F\u4E0D\u7B26: " + file + " \u671F\u671B " + bytes + " \u5B9E\u9645 " + meta.bytes, { where: "provision" });
  }
  const actual = hashFile(part);
  if (actual !== sha2562) {
    removeFile(part);
    throw new InvalidDataError("sha256 \u4E0D\u7B26\uFF08\u62D2\u7EDD\u5B89\u88C5\uFF09: " + file + " \u671F\u671B " + sha2562 + " \u5B9E\u9645 " + actual, { where: "provision" });
  }
  renameFile(part, dest);
  return { downloaded: received - offset, resumed: offset > 0 };
}
async function ensureArtifacts(params) {
  const p = params || {};
  const registry = p.registry;
  if (!registry || !Array.isArray(registry.artifacts)) throw new InvalidDataError("\u7F3A\u5C11 registry", { where: "provision" });
  const opts = {
    rootDir: p.rootDir,
    endpoint: p.endpoint,
    fetchImpl: p.fetchImpl,
    allowInsecure: p.allowInsecure,
    maxBytes: p.maxBytes,
    onProgress: p.onProgress,
    signal: p.signal,
    resume: p.resume
  };
  const ids = p.ids && p.ids.length ? p.ids.slice() : registry.artifacts.map((a) => a.id);
  const result = { manifests: {}, downloaded: [], copied: [], skipped: [], needsBuild: [] };
  for (const id of ids) {
    const a = artifactById(registry, id);
    if (a.kind === "derived") {
      result.needsBuild.push(id);
      continue;
    }
    const dir = artifactDir(registry, p.registryFile, id, p.rootDir);
    if (a.origin === "repo") {
      const shippedDir = artifactDir(registry, defaultRegistryPath(), id, void 0);
      const missingShipped = [];
      let copiedAny = false;
      for (const f of a.files) {
        const dest = path16.join(dir, f.path);
        const meta = fileMeta(dest);
        if (meta.exists && meta.bytes === f.bytes && hashFile(dest) === f.sha256) continue;
        const src = path16.join(shippedDir, f.path);
        const sm = fileMeta(src);
        if (!sm.exists) {
          missingShipped.push({ dest, src, sha256: f.sha256, bytes: f.bytes });
          continue;
        }
        ensureDir(path16.dirname(dest));
        writeFileBytes(dest, readBinary(src));
        const after = fileMeta(dest);
        if (after.bytes !== f.bytes || hashFile(dest) !== f.sha256) throw new InvalidDataError("\u968F\u5305\u5DE5\u4EF6\u590D\u5236\u540E\u6821\u9A8C\u5931\u8D25: " + id + " " + f.path, { where: "provision" });
        copiedAny = true;
      }
      if (missingShipped.length) {
        const lines = missingShipped.map((m) => "  - " + m.dest + " (sha256=" + m.sha256 + ", bytes=" + m.bytes + "\uFF0C\u968F\u5305\u6587\u4EF6\u7F3A\u5931: " + m.src + ")").join("\n");
        throw new ModelMissingError("\u968F\u5305\u5DE5\u4EF6\u7F3A\u5931\uFF08\u5B89\u88C5\u5305\u4E0D\u5B8C\u6574\u6216 models root \u88AB\u6539\u5199\uFF09:\n" + lines + "\n\u8BF7\u91CD\u88C5\u5305\u6216\u8FD0\u884C skill-merge models ensure\u3002", { where: "provision:" + id });
      }
      const checkRepo = verifyArtifact(registry, p.registryFile, id, { rootDir: p.rootDir, hash: true });
      if (!checkRepo.ok) throw new InvalidDataError("\u968F\u5305\u5DE5\u4EF6\u6821\u9A8C\u5931\u8D25: " + id + " " + JSON.stringify({ missing: checkRepo.missing, mismatched: checkRepo.mismatched }), { where: "provision" });
      result.manifests[id] = a.manifest || null;
      if (copiedAny) result.copied.push(id);
      else result.skipped.push(id);
      continue;
    }
    const missing = [];
    let touched = false;
    for (const f of a.files) {
      const dest = path16.join(dir, f.path);
      const meta = fileMeta(dest);
      if (meta.exists && meta.bytes === f.bytes && hashFile(dest) === f.sha256) continue;
      touched = true;
      if (p.offline) {
        missing.push({ path: dest, sha256: f.sha256, bytes: f.bytes });
        continue;
      }
      const url = resolveUrl(endpointOf(opts), a.repo, f.path);
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await downloadFile({ url, dest, sha256: f.sha256, bytes: f.bytes, opts, id, file: f.path, onProgress: p.onProgress });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (!(err && err.retryable)) throw err;
          await delay(1e3 * (attempt + 1));
        }
      }
      if (lastErr) throw lastErr;
    }
    if (missing.length) {
      const lines = missing.map((m) => "  - " + m.path + " (sha256=" + m.sha256 + ", bytes=" + m.bytes + ")").join("\n");
      throw new ModelMissingError("offline \u6A21\u5F0F\u7F3A\u5C11\u6A21\u578B\u6587\u4EF6\uFF08\u4E0D\u4F1A\u8054\u7F51\uFF09:\n" + lines + "\n\u8BF7\u8054\u7F51\u91CD\u8BD5\u3001\u8BBE\u7F6E HF_ENDPOINT \u955C\u50CF\uFF0C\u6216\u6309\u4E0A\u8FF0\u8DEF\u5F84\u624B\u52A8\u653E\u7F6E\u540E\u91CD\u8DD1\u3002", { where: "provision:" + id });
    }
    const check = verifyArtifact(registry, p.registryFile, id, { rootDir: p.rootDir, hash: true });
    if (!check.ok) throw new InvalidDataError("\u5B89\u88C5\u540E\u6821\u9A8C\u5931\u8D25: " + id + " " + JSON.stringify({ missing: check.missing, mismatched: check.mismatched }), { where: "provision" });
    result.manifests[id] = a.manifest || null;
    (touched ? result.downloaded : result.skipped).push(id);
  }
  return result;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/build.js
var CHUNK_ROWS = 4e4;
function fileMap(artifact) {
  const m = {};
  for (const f of artifact.files) m[path17.basename(f.path)] = f.path;
  return m;
}
function requiredPath(dir, files, name, ctx) {
  const rel = files[name];
  if (!rel) throw new InvalidDataError("artifact \u7F3A\u5C11\u6587\u4EF6 " + name + "\uFF08" + ctx + "\uFF09", { where: "build" });
  return path17.join(dir, rel);
}
function patchConfig(baseCfg, patch) {
  const out = Object.assign({}, baseCfg);
  if (patch) for (const k of Object.keys(patch)) out[k] = patch[k];
  return out;
}
function writeConfig(outDir, files, baseDir, baseFiles, patch) {
  const baseCfg = JSON.parse(readBinary(requiredPath(baseDir, baseFiles, "config.json", "base")).toString("utf8"));
  const cfg = patchConfig(baseCfg, patch);
  writeText(requiredPath(outDir, files, "config.json", "output"), JSON.stringify(cfg, null, 2), { eol: "crlf" });
}
function copyTokenizer(outDir, files, baseDir, baseFiles) {
  atomicWrite(requiredPath(outDir, files, "tokenizer.json", "output"), readBinary(requiredPath(baseDir, baseFiles, "tokenizer.json", "base")));
}
async function buildFp16Cast(ctx) {
  const t = openTensor(ctx.baseModelPath);
  try {
    const { rows, cols } = t;
    if (ctx.manifest.rows !== rows || ctx.manifest.dim !== cols) throw new InvalidDataError("base \u5F62\u72B6\u4E0E manifest \u4E0D\u7B26", { where: "build:" + ctx.id });
    const bytesPerRow = cols * 4;
    await writeTensor(ctx.outModelPath, {
      dtype: "F16",
      rows,
      cols,
      writeChunk: async (write) => {
        for (let i = 0; i < rows; i += CHUNK_ROWS) {
          const n = Math.min(CHUNK_ROWS, rows - i);
          const raw = Buffer.alloc(n * bytesPerRow);
          readAt(t.fd, raw, 0, raw.length, t.dataOffset + i * bytesPerRow);
          const out = Buffer.alloc(n * cols * 2);
          for (let j = 0; j < n * cols; j += 1) out.writeUInt16LE(f32ToF16(raw.readFloatLE(j * 4)), j * 2);
          await write(out);
          if (ctx.onProgress) ctx.onProgress({ id: ctx.id, phase: "rows", done: i + n, total: rows });
        }
      }
    });
  } finally {
    t.close();
  }
  writeConfig(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles, ctx.params.configPatch);
  copyTokenizer(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles);
}
async function buildInt8(ctx) {
  const t = openTensor(ctx.baseModelPath);
  try {
    const { rows, cols } = t;
    if (ctx.manifest.rows !== rows || ctx.manifest.dim !== cols) throw new InvalidDataError("base \u5F62\u72B6\u4E0E manifest \u4E0D\u7B26", { where: "build:" + ctx.id });
    const scales = new Float32Array(rows);
    const bytesPerRow = cols * 2;
    await writeTensor(ctx.outModelPath, {
      dtype: "I8",
      rows,
      cols,
      writeChunk: async (write) => {
        for (let i = 0; i < rows; i += CHUNK_ROWS) {
          const n = Math.min(CHUNK_ROWS, rows - i);
          const raw = Buffer.alloc(n * bytesPerRow);
          readAt(t.fd, raw, 0, raw.length, t.dataOffset + i * bytesPerRow);
          const q = Buffer.alloc(n * cols);
          for (let r = 0; r < n; r += 1) {
            let mx = 0;
            for (let c = 0; c < cols; c += 1) {
              const v = f16ToF32(raw.readUInt16LE((r * cols + c) * 2));
              const a = Math.abs(v);
              if (a > mx) mx = a;
            }
            let sc = Math.fround(mx / 127);
            if (sc === 0) sc = Math.fround(1e-8);
            scales[i + r] = sc;
            for (let c = 0; c < cols; c += 1) {
              const v = f16ToF32(raw.readUInt16LE((r * cols + c) * 2));
              const qf = Math.fround(v / sc);
              let qi = roundHalfEven(qf);
              if (qi > 127) qi = 127;
              else if (qi < -127) qi = -127;
              q[r * cols + c] = qi & 255;
            }
          }
          await write(q);
          if (ctx.onProgress) ctx.onProgress({ id: ctx.id, phase: "rows", done: i + n, total: rows });
        }
      }
    });
    writeFileBytes(requiredPath(ctx.outDir, ctx.outFiles, ctx.params.scalesFile || "scales.f32", "output"), Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength));
  } finally {
    t.close();
  }
  writeConfig(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles, ctx.params.configPatch);
  copyTokenizer(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles);
}
async function buildPca64(ctx) {
  const t = openTensor(ctx.baseModelPath);
  const dims = Number(ctx.manifest.dim);
  const projBytes = readBinary(ctx.projPath);
  if (projBytes.length !== t.cols * dims * 4) throw new InvalidDataError("proj \u5C3A\u5BF8\u4E0D\u7B26: " + projBytes.length + " != " + t.cols * dims * 4, { where: "build:" + ctx.id });
  const proj = new Float32Array(t.cols * dims);
  Buffer.from(proj.buffer).set(projBytes);
  try {
    const { rows, cols } = t;
    if (ctx.manifest.rows !== rows) throw new InvalidDataError("base \u884C\u6570\u4E0E manifest \u4E0D\u7B26", { where: "build:" + ctx.id });
    const scales = new Float32Array(rows);
    const bytesPerRow = cols * 2;
    await writeTensor(ctx.outModelPath, {
      dtype: "I8",
      rows,
      cols: dims,
      writeChunk: async (write) => {
        for (let i = 0; i < rows; i += CHUNK_ROWS) {
          const n = Math.min(CHUNK_ROWS, rows - i);
          const raw = Buffer.alloc(n * bytesPerRow);
          readAt(t.fd, raw, 0, raw.length, t.dataOffset + i * bytesPerRow);
          const q = Buffer.alloc(n * dims);
          for (let r = 0; r < n; r += 1) {
            const projRow = new Float64Array(dims);
            let mx = 0;
            for (let c = 0; c < cols; c += 1) {
              const v = f16ToF32(raw.readUInt16LE((r * cols + c) * 2));
              const base = c * dims;
              for (let d = 0; d < dims; d += 1) projRow[d] += v * proj[base + d];
            }
            for (let d = 0; d < dims; d += 1) {
              projRow[d] = Math.fround(projRow[d]);
              const a = Math.abs(projRow[d]);
              if (a > mx) mx = a;
            }
            let sc = Math.fround(mx / 127);
            if (sc === 0) sc = Math.fround(1e-8);
            scales[i + r] = sc;
            for (let d = 0; d < dims; d += 1) {
              const qf = Math.fround(projRow[d] / sc);
              let qi = roundHalfEven(qf);
              if (qi > 127) qi = 127;
              else if (qi < -127) qi = -127;
              q[r * dims + d] = qi & 255;
            }
          }
          await write(q);
          if (ctx.onProgress) ctx.onProgress({ id: ctx.id, phase: "rows", done: i + n, total: rows });
        }
      }
    });
    writeFileBytes(requiredPath(ctx.outDir, ctx.outFiles, ctx.params.scalesFile || "scales.f32", "output"), Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength));
  } finally {
    t.close();
  }
  writeConfig(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles, ctx.params.configPatch);
  copyTokenizer(ctx.outDir, ctx.outFiles, ctx.baseDir, ctx.baseFiles);
}
var RECIPES = { "fp16-cast": buildFp16Cast, "int8-per-row": buildInt8, "pca-project-int8": buildPca64 };
async function buildArtifact(params) {
  const { registry, registryFile, id, rootDir, force, onProgress } = params;
  const a = artifactById(registry, id);
  if (a.kind !== "derived") throw new InvalidDataError("\u53EA\u80FD\u6784\u5EFA derived artifact: " + id, { where: "build" });
  if (!force) {
    const v2 = verifyArtifact(registry, registryFile, id, { rootDir, hash: true });
    if (v2.ok) return { id, built: false, manifest: a.manifest };
  }
  const base = artifactById(registry, a.base);
  const baseDir = artifactDir(registry, registryFile, a.base, rootDir);
  const baseCheck = verifyArtifact(registry, registryFile, a.base, { rootDir, hash: true });
  if (!baseCheck.ok) {
    throw new ModelMissingError("\u6784\u5EFA " + id + " \u7F3A\u5C11 base " + a.base + "\uFF08" + baseDir + "\uFF09: " + JSON.stringify({ missing: baseCheck.missing, mismatched: baseCheck.mismatched }) + "\uFF1B\u5148 ensureArtifacts \u4E0B\u8F7D\u6216\u79BB\u7EBF\u624B\u52A8\u653E\u7F6E", { where: "build:" + id });
  }
  const recipe = registry.recipes[a.recipe];
  if (!recipe) throw new InvalidDataError("recipe \u672A\u5B9A\u4E49: " + a.recipe, { where: "build" });
  const builder = RECIPES[a.recipe];
  if (!builder) throw new InvalidDataError("Node \u4E0D\u652F\u6301\u7684 recipe: " + a.recipe, { where: "build" });
  const outDir = artifactDir(registry, registryFile, id, rootDir);
  ensureDir(outDir);
  const baseFiles = fileMap(base);
  const outFiles = fileMap(a);
  const ctx = {
    id,
    params: recipe.params || {},
    manifest: a.manifest,
    onProgress,
    baseDir,
    baseFiles,
    outDir,
    outFiles,
    baseModelPath: requiredPath(baseDir, baseFiles, "model.safetensors", "base"),
    outModelPath: requiredPath(outDir, outFiles, "model.safetensors", "output")
  };
  if (a.proj) {
    const projArtifact = artifactById(registry, a.proj);
    const projDir = artifactDir(registry, registryFile, a.proj, rootDir);
    const projCheck = verifyArtifact(registry, registryFile, a.proj, { rootDir, hash: true });
    if (!projCheck.ok) throw new ModelMissingError("\u6784\u5EFA " + id + " \u7F3A\u5C11 proj " + a.proj + "\uFF08" + projDir + "\uFF09", { where: "build:" + id });
    ctx.projPath = path17.join(projDir, projArtifact.files[0].path);
  }
  await builder(ctx);
  const v = verifyArtifact(registry, registryFile, id, { rootDir, hash: true });
  if (!v.ok) throw new InvalidDataError("\u6784\u5EFA\u540E\u6821\u9A8C\u5931\u8D25: " + id + " " + JSON.stringify({ missing: v.missing, mismatched: v.mismatched }), { where: "build:" + id });
  return { id, built: true, manifest: a.manifest };
}
async function ensureModels(params) {
  const p = params || {};
  const registry = p.registry;
  const ids = p.ids && p.ids.length ? p.ids.slice() : registry.artifacts.map((a) => a.id);
  const prov = await ensureArtifacts(Object.assign({}, p, { ids }));
  const built = [];
  const skipped = prov.skipped.slice();
  for (const id of prov.needsBuild) {
    const r = await buildArtifact(Object.assign({}, p, { id }));
    if (r.built) built.push(id);
    else skipped.push(id);
  }
  const manifests = {};
  for (const id of ids) manifests[id] = artifactById(registry, id).manifest || null;
  return { manifests, downloaded: prov.downloaded, built, skipped };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/config/schema.js
var CONFIG_FIELDS = [
  { "key": "min_name_entropy", "type": "float", "default": 1.5, "doc": "\u540D\u5B57\u71B5\u4E0B\u9650" },
  { "key": "min_name_tokens", "type": "int", "default": 2, "doc": "\u540D\u5B57\u6700\u5C11 token \u6570" },
  { "key": "min_name_len", "type": "int", "default": 6, "doc": "\u540D\u5B57\u6700\u77ED\u957F\u5EA6" },
  { "key": "num_perm", "type": "int", "default": 128, "doc": "MinHash \u6392\u5217\u6570" },
  { "key": "shingle_size", "type": "int", "default": 3, "doc": "shingle \u5927\u5C0F" },
  { "key": "lsh_floor", "type": "float", "default": 0.1, "doc": "LSH floor\uFF08CLI --lsh-threshold\uFF09", "min": 0, "max": 1, "cli": "lsh-threshold" },
  { "key": "net_vocabulary", "type": "enum", "default": "token", "doc": "\u7F51\u7684\u8BCD\u6C47\u53E3\u5F84", "choices": ["token", "shingle"] },
  { "key": "minhash_seed", "type": "int", "default": 1, "doc": "\u56FA\u5B9A\u79CD\u5B50" },
  { "key": "seed_mode", "type": "enum", "default": "run", "doc": "\u79CD\u5B50\u6A21\u5F0F", "choices": ["run", "fixed"], "cli": "seed-mode" },
  { "key": "ledger_path", "type": "string", "default": "", "doc": "\u8DE8\u8FD0\u884C\u53F0\u8D26\u8DEF\u5F84\uFF08CLI --ledger\uFF09", "cli": "ledger" },
  { "key": "emit_only_new", "type": "bool", "default": false, "doc": "\u53EA\u8F93\u51FA\u53F0\u8D26\u65B0\u589E\uFF08CLI --only-new\uFF09", "cli": "only-new", "cliType": "flag", "cliValue": true },
  { "key": "round_count", "type": "int", "default": 1, "doc": "\u8F6E\u6570\uFF08CLI --rounds\uFF09", "min": 1, "cli": "rounds" },
  { "key": "randomize_seed", "type": "bool", "default": false, "doc": "\u968F\u673A\u79CD\u5B50\uFF08CLI --randomize\uFF09", "cli": "randomize", "cliType": "flag", "cliValue": true },
  { "key": "floor_jitter", "type": "float", "default": 0.02, "doc": "floor \u6296\u52A8\uFF08CLI --floor-jitter\uFF09", "min": 0, "max": 1, "cli": "floor-jitter" },
  { "key": "select_jaccard_min", "type": "float", "default": 0.3, "doc": "\u5F3A\u76F8\u4F3C Jaccard \u7EBF" },
  { "key": "top_k", "type": "int", "default": 5, "doc": "\u6BCF\u6280\u80FD top-k" },
  { "key": "topk_mode", "type": "enum", "default": "per_projection", "doc": "top-k \u6A21\u5F0F", "choices": ["per_projection", "merged"] },
  { "key": "global_frac", "type": "float", "default": 0.05, "doc": "\u5168\u5C40\u5019\u9009\u6BD4\u4F8B" },
  { "key": "global_cap", "type": "int", "default": 100, "doc": "\u5168\u5C40\u5019\u9009\u4E0A\u9650" },
  { "key": "use_summary_index", "type": "bool", "default": true, "doc": "\u4F7F\u7528 summary \u7D22\u5F15" },
  { "key": "use_body_index", "type": "bool", "default": true, "doc": "\u4F7F\u7528 body \u7D22\u5F15" },
  { "key": "body_gate", "type": "float", "default": 0.9, "doc": "body \u8BCD\u9762\u95E8\u9650\uFF08CLI --lexical-body-min\uFF09", "min": 0, "max": 1, "cli": "lexical-body-min" },
  { "key": "summary_gate", "type": "float", "default": 0.5, "doc": "summary \u8BCD\u9762\u95E8\u9650\uFF08CLI --lexical-summary-min\uFF09", "min": 0, "max": 1, "cli": "lexical-summary-min" },
  { "key": "gate_per_skill_topk", "type": "int", "default": 2, "doc": "\u2462 \u6BCF\u6280\u80FD top-k" },
  { "key": "gate_global_frac", "type": "float", "default": 0.1, "doc": "\u2462 \u5168\u5C40\u6BD4\u4F8B" },
  { "key": "gate_global_cap", "type": "int", "default": 20, "doc": "\u2462 \u5168\u5C40 cap" },
  { "key": "skip_stage4", "type": "bool", "default": false, "doc": "\u8DF3\u8FC7 \u2463\uFF08CLI --skip-stage4\uFF09", "cli": "skip-stage4", "cliType": "flag", "cliValue": true },
  { "key": "semantic_top_n", "type": "int", "default": 10, "doc": "\u2463 \u6BCF\u6295\u5F71 top-N" },
  { "key": "semantic_body_floor", "type": "float", "default": 0.95, "doc": "\u2463 body \u4E0B\u9650" },
  { "key": "semantic_summary_floor", "type": "float", "default": 0.6, "doc": "\u2463 summary \u4E0B\u9650" },
  { "key": "embedder", "type": "enum", "default": "model2vec-stream", "doc": "\u7F16\u7801\u5668\u540E\u7AEF", "choices": ["tfidf", "tfidf-svd", "model2vec", "sentence-transformers", "model2vec-stream"], "cli": "embedder" },
  { "key": "embedder_model", "type": "string", "default": "", "doc": "\u672C\u673A\u6863 3 \u6A21\u578B\u76EE\u5F55\uFF08\u7A7A=registry artifactRef \u89E3\u6790\uFF09", "cli": "embed-local" },
  { "key": "onnx_model_dir", "type": "string", "default": "", "doc": "ONNX \u6A21\u578B\u76EE\u5F55\uFF08\u9ED8\u8BA4\u53D6 registry onnx:e5-small artifact\uFF09", "cli": "onnx-model-dir" },
  { "key": "onnx_max_tokens", "type": "int", "default": 512, "min": 8, "doc": "ONNX \u8F93\u5165\u622A\u65AD token \u6570" },
  { "key": "onnx_batch", "type": "int", "default": 8, "min": 1, "doc": "ONNX \u63A8\u7406\u6279\u5927\u5C0F" },
  { "key": "embedder_model_last", "type": "string", "default": "", "doc": "\u672C\u673A\u6863 4 \u6A21\u578B\u76EE\u5F55\uFF08\u7A7A=registry artifactRef \u89E3\u6790\uFF09", "cli": "embed-local-last" },
  { "key": "embed_backend", "type": "enum", "default": "chain", "doc": "\u2463 \u540E\u7AEF\uFF08onnx \u4E3A\u53EF\u9009\u540E\u7AEF\uFF0C\u9700 onnxruntime-node + \u6A21\u578B\uFF09", "choices": ["chain", "local", "remote", "onnx"], "cli": "embed-backend" },
  { "key": "embed_primary", "type": "string", "default": "Qwen/Qwen3-Embedding-8B", "doc": "\u8FDC\u7A0B\u4E3B\u6863", "cli": "embed-primary" },
  { "key": "embed_fallback", "type": "string", "default": "BAAI/bge-m3", "doc": "\u8FDC\u7A0B\u964D\u7EA7\u6863", "cli": "embed-fallback" },
  { "key": "embed_remote_url", "type": "string", "default": "https://api.siliconflow.cn/v1/embeddings", "doc": "\u8FDC\u7A0B embedding URL" },
  { "key": "embed_api_key_env", "type": "string", "default": "SILICONFLOW_API_KEY", "doc": "key \u73AF\u5883\u53D8\u91CF\u540D" },
  { "key": "embed_cred_path", "type": "string", "default": "", "doc": "\u51ED\u636E\u6587\u4EF6\u8DEF\u5F84" },
  { "key": "embed_max_chars", "type": "int", "default": 8e3, "doc": "\u8FDC\u7A0B\u622A\u65AD\u5B57\u7B26" },
  { "key": "embed_batch", "type": "int", "default": 16, "doc": "\u8FDC\u7A0B batch" },
  { "key": "embed_timeout", "type": "float", "default": 90, "doc": "\u8FDC\u7A0B\u8D85\u65F6\u79D2" },
  { "key": "embed_dimensions", "type": "int", "default": 0, "doc": "\u8FDC\u7A0B\u7EF4\u5EA6\uFF080=\u9ED8\u8BA4\uFF09" },
  { "key": "embed_price_cny_per_ktok", "type": "json", "default": { "qwen3-embedding-8b": 28e-5, "bge-m3": 0 }, "doc": "\u8BA1\u8D39\u4EF7\u76EE" },
  { "key": "embed_concurrency", "type": "int", "default": 4, "min": 1, "max": 32, "doc": "\u8FDC\u7A0B \u2463 \u6279\u5E76\u53D1\uFF08mapLimit\uFF09", "cli": "embed-concurrency" },
  { "key": "embed_retries", "type": "int", "default": 2, "min": 0, "max": 5, "doc": "\u8FDC\u7A0B \u2463 429/5xx \u91CD\u8BD5\u6B21\u6570", "cli": "embed-retries" },
  { "key": "embed_floor_presets", "type": "json", "default": { "qwen3-embedding-8b": { "body": 0.75, "summary": 0.85 }, "bge-m3": { "body": 0.8, "summary": 0.6 }, "local": { "body": 0.95, "summary": 0.6 }, "local:int8-256": { "body": 0.95, "summary": 0.6 }, "local:pca64-int8": { "body": 0.95, "summary": 0.6 } }, "doc": "\u6309\u6863\u4F4D\u9608\u503C\u9884\u8BBE" },
  { "key": "svd_dim", "type": "int", "default": 256, "doc": "SVD \u7EF4\u5EA6" },
  { "key": "boilerplate_min_docs", "type": "int", "default": 2, "doc": "\u524D\u8A00\u5265\u79BB\u6700\u5C11\u6587\u6863\u6570" },
  { "key": "boilerplate_min_ratio", "type": "float", "default": 0.2, "doc": "\u524D\u8A00\u5265\u79BB\u6BD4\u4F8B" },
  { "key": "judge", "type": "enum", "default": "stub", "doc": "\u2464 \u5224\u51B3\u6A21\u5F0F\uFF08stub2 = \u5730\u677F\u9A71\u52A8 opt-in\uFF09", "choices": ["stub", "stub2", "deepseek", "auto"], "cli": "judge" },
  { "key": "judge_model", "type": "string", "default": "deepseek-flash", "doc": "\u2464 \u6A21\u578B", "cli": "judge-model" },
  { "key": "judge_cache", "type": "bool", "default": false, "doc": "\u2464 verdict \u7F13\u5B58\uFF08\u9ED8\u8BA4\u5173\uFF1B\u952E=promptSha+model+params\uFF09", "cli": "judge-cache" },
  { "key": "judge_cache_path", "type": "string", "default": "", "doc": "\u2464 \u7F13\u5B58\u6587\u4EF6\u8DEF\u5F84\uFF08\u9ED8\u8BA4 <out>/judge_cache.json\uFF09" },
  { "key": "judge_price_cny_per_ktok", "type": "json", "default": { "deepseek-flash": { "input": 5e-4, "output": 2e-3 } }, "doc": "\u2464 \u8BA1\u8D39\uFF1A\u6BCF 1k token \u4EBA\u6C11\u5E01\uFF08input/output\uFF09" },
  { "key": "judge_effort", "type": "enum", "default": "off", "doc": "\u2464 \u63A8\u7406\u6863", "choices": ["off", "high", "max"], "cli": "judge-effort" },
  { "key": "strict", "type": "bool", "default": false, "doc": "\u4E25\u683C\u6A21\u5F0F\uFF1A\u4F7F\u7528 stub/vec/\u964D\u7EA7\u8DEF\u5F84\u65F6 exit 1", "cli": "strict" },
  { "key": "verbose", "type": "bool", "default": false, "doc": "\u6210\u529F\u8F93\u51FA\u9644\u5E26 stage \u660E\u7EC6", "cli": "verbose" },
  { "key": "write_prompts", "type": "bool", "default": false, "doc": "\u5199\u51FA \u2464 prompt \u6587\u4EF6\uFF08\u9ED8\u8BA4\u4E0D\u5199\uFF09", "cli": "write-prompts" },
  { "key": "l0_caution", "type": "bool", "default": false, "doc": "L0 \u8C28\u614E\u63D0\u793A\uFF08CLI --no-caution \u7F6E false\uFF09", "cli": "no-caution", "cliType": "flag-invert", "cliValue": false },
  { "key": "audit_seed", "type": "int", "default": 1, "doc": "\u62BD\u68C0\u79CD\u5B50" },
  { "key": "rank_mode", "type": "enum", "default": "auto", "doc": "\u2463.5 \u6A21\u5F0F\uFF08auto=\u6709 key \u65F6 API\u2192Q8\u2192Q4\u2192\u5411\u91CF\uFF09", "choices": ["auto", "api", "local", "vec"], "cli": "rank" },
  { "key": "rank_n", "type": "int", "default": 20, "doc": "\u7CBE\u6392\u5019\u9009\u6570", "min": 1, "cli": "rank-n" },
  { "key": "rank_cap", "type": "int", "default": 5e3, "doc": "\u7CBE\u6392\u6B63\u6587\u622A\u65AD", "min": 1, "cli": "rank-cap" },
  { "key": "rank_server", "type": "string", "default": "http://127.0.0.1:8093", "doc": "\u7CBE\u6392\u670D\u52A1\u5730\u5740", "cli": "rank-server" },
  { "key": "rank_local_chain", "type": "string", "default": "q8,q4", "doc": "\u672C\u5730\u7CBE\u6392\u964D\u7EA7\u94FE\uFF08\u9017\u53F7\u5206\u9694\uFF1Aq8,q4\uFF1B\u7A7A=\u53EA\u7528 rank_server\uFF09", "cli": "rank-local-chain" },
  { "key": "rank_server_q8", "type": "string", "default": "", "doc": "Q8 \u672C\u5730\u7CBE\u6392\u670D\u52A1\u5730\u5740\uFF08\u7A7A=\u590D\u7528 rank_server\uFF09", "cli": "rank-server-q8" },
  { "key": "rank_server_q4", "type": "string", "default": "http://127.0.0.1:8094", "doc": "Q4 \u672C\u5730\u7CBE\u6392\u670D\u52A1\u5730\u5740", "cli": "rank-server-q4" },
  { "key": "rank_probe_timeout", "type": "float", "default": 2, "doc": "\u63A2\u6D3B\u8D85\u65F6" },
  { "key": "rank_request_timeout", "type": "float", "default": 300, "doc": "\u672C\u5730\u7CBE\u6392\u5355\u8BF7\u6C42\u8D85\u65F6\u79D2\uFF08CPU \u957F prompt \u9700\u66F4\u5927\uFF09", "cli": "rank-request-timeout" },
  { "key": "rank_vec_topk", "type": "int", "default": 10, "doc": "vec \u964D\u7EA7 top-k" },
  { "key": "semantic_top_n_wide", "type": "int", "default": 20, "doc": "\u2463 \u5BBD\u53E3\u5F84 top-N" },
  { "key": "judge_max_chars_per_skill", "type": "int", "default": 4e3, "doc": "L2 \u6B63\u6587\u622A\u65AD" },
  { "key": "rank_checkpoint", "type": "string", "default": "", "doc": "\u65AD\u70B9\u6587\u4EF6\uFF08\u8FD0\u884C\u65F6\u6CE8\u5165\uFF09" },
  { "key": "rank_concurrency", "type": "int", "default": 1, "min": 1, "max": 8, "doc": "\u2463.5 \u672C\u5730\u6253\u5206\u5E76\u53D1\uFF08\u9ED8\u8BA4 1\uFF1B>1 \u65F6\u63A2\u6D4B llama-server slots\uFF09", "cli": "rank-concurrency" },
  { "key": "rank_retries", "type": "int", "default": 2, "min": 0, "max": 5, "doc": "\u2463.5 \u5355\u884C 429/5xx/\u8D85\u65F6\u91CD\u8BD5\u6B21\u6570", "cli": "rank-retries" },
  { "key": "rank_retry_backoff_ms", "type": "int", "default": 200, "min": 0, "doc": "\u2463.5 \u91CD\u8BD5\u6307\u6570\u9000\u907F\u57FA\u6570\u6BEB\u79D2", "cli": "rank-retry-backoff-ms" },
  { "key": "rank_ckpt_batch", "type": "int", "default": 25, "min": 1, "doc": "\u2463.5 checkpoint \u6279\u91CF\u843D\u76D8\u95F4\u9694\uFF08\u6761\uFF09" },
  { "key": "rank_api_url", "type": "string", "default": "https://api.bamboonode.dev/v1/decisions", "doc": "\u2463.5 API \u5730\u5740\uFF08Bamboo /v1/decisions\uFF09", "cli": "rank-api-url" },
  { "key": "rank_api_key_env", "type": "string", "default": "BAMBOO_API_KEY", "doc": "\u2463.5 API Key \u6240\u5728\u73AF\u5883\u53D8\u91CF", "cli": "rank-api-key-env" },
  { "key": "rank_api_model", "type": "string", "default": "startlux-decision-27b-autothink", "doc": "\u2463.5 API \u6A21\u578B", "cli": "rank-api-model" },
  { "key": "rank_api_think_mode", "type": "enum", "default": "never", "choices": ["never", "auto", "always"], "doc": "\u2463.5 API \u601D\u8003\u6A21\u5F0F", "cli": "rank-api-think-mode" },
  { "key": "rank_api_timeout", "type": "float", "default": 120, "min": 1, "doc": "\u2463.5 API \u5355\u8BF7\u6C42\u8D85\u65F6\u79D2", "cli": "rank-api-timeout" },
  { "key": "tokenizer_cache", "type": "bool", "default": true, "doc": "tokenizer \u6D3E\u751F\u7269\u7F13\u5B58\uFF08CLI --no-tokenizer-cache\uFF09", "cli": "no-tokenizer-cache", "cliType": "flag-invert", "cliValue": false },
  { "key": "tokenizer_cache_dir", "type": "string", "default": "", "doc": "tokenizer \u6D3E\u751F\u7269\u7F13\u5B58\u76EE\u5F55\uFF08\u7A7A=\u7CFB\u7EDF\u4E34\u65F6\u76EE\u5F55\uFF09", "cli": "tokenizer-cache-dir" },
  { "key": "offline", "type": "bool", "default": false, "doc": "\u79BB\u7EBF\u6A21\u5F0F\uFF1A\u7981\u6B62\u8054\u7F51\uFF08\u7F3A\u6A21\u578B\u65F6\u7ED9\u624B\u52A8\u5B89\u88C5\u63D0\u793A\uFF09", "cli": "offline", "cliType": "flag", "cliValue": true },
  { "key": "auto_provision", "type": "bool", "default": false, "doc": "\u6A21\u578B\u7F3A\u5931\u65F6\u81EA\u52A8\u4E0B\u8F7D+\u6784\u5EFA\uFF08\u9ED8\u8BA4\u79BB\u7EBF\u4F18\u5148\uFF1BCLI --auto-provision \u5F00\u542F\uFF09", "cli": "auto-provision", "cliType": "flag", "cliValue": true },
  { "key": "io_dialect", "type": "enum", "default": "native", "choices": ["native", "python"], "doc": "\u5199\u6587\u4EF6\u5B57\u8282\u65B9\u8A00\uFF08G6.3 \u5168\u4EA7\u7269\u751F\u6548\uFF1Bprompt \u5DF2\u7528\uFF09", "cli": "io-dialect" },
  { "key": "parity_bytes", "type": "bool", "default": false, "doc": "\u5B57\u8282\u7EA7 parity \u56DE\u5F52\u6A21\u5F0F\uFF08\u7B49\u4EF7 python \u65B9\u8A00\uFF09", "cli": "parity-bytes" },
  { "key": "models_dir", "type": "string", "default": "", "doc": "\u6A21\u578B\u6839\u76EE\u5F55\u8986\u76D6\uFF08\u7A7A=registry.modelsRoot\uFF09", "cli": "models-dir" },
  { "key": "hf_endpoint", "type": "string", "default": "", "doc": "HF \u955C\u50CF\u7AEF\u70B9\uFF08\u7A7A=HF_ENDPOINT \u6216 huggingface.co\uFF09", "cli": "hf-endpoint" },
  { "key": "rebuild_models", "type": "bool", "default": false, "doc": "\u5F3A\u5236\u91CD\u5EFA\u6D3E\u751F\u6A21\u578B\uFF08\u5FFD\u7565\u7F13\u5B58\u6821\u9A8C\uFF09", "cli": "rebuild-models", "cliType": "flag", "cliValue": true },
  { "key": "worker_pool", "type": "enum", "default": "off", "choices": ["off", "auto"], "doc": "\u2463 \u7F16\u7801\u6761\u4EF6 worker \u6C60\uFF08auto\uFF1AN\u2265500 \u4E14\u5355\u7EBF\u7A0B\u4F30\u7B97>1.5s \u624D\u542F\u7528\uFF09", "cli": "worker-pool" },
  { "key": "worker_pool_size", "type": "int", "default": 0, "min": 0, "max": 8, "doc": "worker \u6570\uFF080=\u81EA\u52A8 min(4,cpu-1)\uFF09", "cli": "worker-pool-size" },
  { "key": "worker_pool_min_items", "type": "int", "default": 500, "min": 1, "doc": "\u542F\u7528\u6C60\u7684\u6700\u5C0F\u6837\u672C\u6570" },
  { "key": "worker_pool_min_ms", "type": "int", "default": 1500, "min": 1, "doc": "\u542F\u7528\u6C60\u7684\u5355\u7EBF\u7A0B\u4F30\u7B97\u9608\u503C ms" },
  { "key": "stream_mode", "type": "enum", "default": "bulk", "choices": ["bulk", "stream"], "doc": "\u2463 \u9759\u6001\u8868\u52A0\u8F7D\u6A21\u5F0F\uFF08bulk \u9ED8\u8BA4 / stream \u56DE\u9000\uFF09", "cli": "stream-mode" },
  { "key": "max_table_mb", "type": "int", "default": 0, "min": 0, "doc": "bulk \u8868\u5185\u5B58\u9884\u7B97 MB\uFF080=\u4E0D\u9650\u5236\uFF1B\u8D85\u51FA\u81EA\u52A8\u56DE\u9000 stream\uFF09", "cli": "max-table-mb" }
];
var CLI_OPTIONS = [
  { "flag": "corpus", "kind": "multi", "required": true, "doc": "\u8BED\u6599\u76EE\u5F55\uFF08\u53EF\u591A\u6B21\u4F20\uFF09" },
  { "flag": "out", "kind": "string", "required": true, "doc": "\u8F93\u51FA\u76EE\u5F55" },
  { "flag": "lsh-threshold", "cfgKey": "lsh_floor", "doc": "LSH floor\uFF08CLI --lsh-threshold\uFF09", "kind": "float", "min": 0, "max": 1 },
  { "flag": "seed-mode", "cfgKey": "seed_mode", "doc": "\u79CD\u5B50\u6A21\u5F0F", "kind": "enum", "choices": ["run", "fixed"] },
  { "flag": "ledger", "cfgKey": "ledger_path", "doc": "\u8DE8\u8FD0\u884C\u53F0\u8D26\u8DEF\u5F84\uFF08CLI --ledger\uFF09", "kind": "string" },
  { "flag": "only-new", "cfgKey": "emit_only_new", "doc": "\u53EA\u8F93\u51FA\u53F0\u8D26\u65B0\u589E\uFF08CLI --only-new\uFF09", "kind": "bool", "value": true },
  { "flag": "rounds", "cfgKey": "round_count", "doc": "\u8F6E\u6570\uFF08CLI --rounds\uFF09", "kind": "int", "min": 1 },
  { "flag": "randomize", "cfgKey": "randomize_seed", "doc": "\u968F\u673A\u79CD\u5B50\uFF08CLI --randomize\uFF09", "kind": "bool", "value": true },
  { "flag": "floor-jitter", "cfgKey": "floor_jitter", "doc": "floor \u6296\u52A8\uFF08CLI --floor-jitter\uFF09", "kind": "float", "min": 0, "max": 1 },
  { "flag": "lexical-body-min", "cfgKey": "body_gate", "doc": "body \u8BCD\u9762\u95E8\u9650\uFF08CLI --lexical-body-min\uFF09", "kind": "float", "min": 0, "max": 1 },
  { "flag": "lexical-summary-min", "cfgKey": "summary_gate", "doc": "summary \u8BCD\u9762\u95E8\u9650\uFF08CLI --lexical-summary-min\uFF09", "kind": "float", "min": 0, "max": 1 },
  { "flag": "skip-stage4", "cfgKey": "skip_stage4", "doc": "\u8DF3\u8FC7 \u2463\uFF08CLI --skip-stage4\uFF09", "kind": "bool", "value": true },
  { "flag": "embedder", "cfgKey": "embedder", "doc": "\u7F16\u7801\u5668\u540E\u7AEF", "kind": "enum", "choices": ["tfidf", "tfidf-svd", "model2vec", "sentence-transformers", "model2vec-stream"] },
  { "flag": "embed-local", "cfgKey": "embedder_model", "doc": "\u672C\u673A\u6863 3 \u6A21\u578B\u76EE\u5F55", "kind": "string" },
  { "flag": "onnx-model-dir", "cfgKey": "onnx_model_dir", "kind": "string", "doc": "ONNX \u6A21\u578B\u76EE\u5F55" },
  { "flag": "embed-local-last", "cfgKey": "embedder_model_last", "doc": "\u672C\u673A\u6863 4 \u6A21\u578B\u76EE\u5F55", "kind": "string" },
  { "flag": "embed-backend", "cfgKey": "embed_backend", "doc": "\u2463 \u540E\u7AEF", "kind": "enum", "choices": ["chain", "local", "remote", "onnx"] },
  { "flag": "embed-primary", "cfgKey": "embed_primary", "doc": "\u8FDC\u7A0B\u4E3B\u6863", "kind": "string" },
  { "flag": "embed-fallback", "cfgKey": "embed_fallback", "doc": "\u8FDC\u7A0B\u964D\u7EA7\u6863", "kind": "string" },
  { "flag": "embed-concurrency", "cfgKey": "embed_concurrency", "kind": "int", "min": 1, "max": 32, "doc": "\u8FDC\u7A0B\u6279\u5E76\u53D1" },
  { "flag": "embed-retries", "cfgKey": "embed_retries", "kind": "int", "min": 0, "max": 5, "doc": "\u8FDC\u7A0B\u91CD\u8BD5\u6B21\u6570" },
  { "flag": "judge", "cfgKey": "judge", "doc": "\u2464 \u5224\u51B3\u6A21\u5F0F", "kind": "enum", "choices": ["stub", "stub2", "deepseek", "auto"] },
  { "flag": "judge-cache", "cfgKey": "judge_cache", "kind": "bool", "value": true, "doc": "\u5F00\u542F verdict \u7F13\u5B58" },
  { "flag": "judge-model", "cfgKey": "judge_model", "doc": "\u2464 \u6A21\u578B", "kind": "string" },
  { "flag": "judge-effort", "cfgKey": "judge_effort", "doc": "\u2464 \u63A8\u7406\u6863", "kind": "enum", "choices": ["off", "high", "max"] },
  { "flag": "strict", "cfgKey": "strict", "doc": "\u4E25\u683C\u6A21\u5F0F\uFF1A\u4F7F\u7528 stub/vec/\u964D\u7EA7\u8DEF\u5F84\u65F6 exit 1", "kind": "bool", "value": true },
  { "flag": "verbose", "cfgKey": "verbose", "doc": "\u6210\u529F\u8F93\u51FA\u9644\u5E26 stage \u660E\u7EC6", "kind": "bool", "value": true },
  { "flag": "write-prompts", "cfgKey": "write_prompts", "doc": "\u5199\u51FA \u2464 prompt \u6587\u4EF6\uFF08\u9ED8\u8BA4\u4E0D\u5199\uFF09", "kind": "bool", "value": true },
  { "flag": "no-caution", "cfgKey": "l0_caution", "doc": "L0 \u8C28\u614E\u63D0\u793A\uFF08CLI --no-caution \u7F6E false\uFF09", "kind": "bool", "value": false },
  { "flag": "rank", "cfgKey": "rank_mode", "doc": "\u2463.5 \u6A21\u5F0F\uFF08auto=\u6709 key \u65F6 API\u2192Q8\u2192Q4\u2192\u5411\u91CF\uFF09", "kind": "enum", "choices": ["auto", "api", "local", "vec"] },
  { "flag": "rank-concurrency", "cfgKey": "rank_concurrency", "kind": "int", "min": 1, "max": 8, "doc": "\u2463.5 \u672C\u5730\u6253\u5206\u5E76\u53D1\uFF08\u9ED8\u8BA4 1\uFF1B>1 \u65F6\u63A2\u6D4B slots\uFF09" },
  { "flag": "rank-n", "cfgKey": "rank_n", "doc": "\u7CBE\u6392\u5019\u9009\u6570", "kind": "int", "min": 1 },
  { "flag": "rank-cap", "cfgKey": "rank_cap", "doc": "\u7CBE\u6392\u6B63\u6587\u622A\u65AD", "kind": "int", "min": 1 },
  { "flag": "rank-server", "cfgKey": "rank_server", "doc": "\u7CBE\u6392\u670D\u52A1\u5730\u5740", "kind": "string" },
  { "flag": "rank-local-chain", "cfgKey": "rank_local_chain", "doc": "\u672C\u5730\u7CBE\u6392\u964D\u7EA7\u94FE\uFF08q8,q4\uFF1B\u7A7A=\u53EA\u7528 rank-server\uFF09", "kind": "string" },
  { "flag": "rank-server-q8", "cfgKey": "rank_server_q8", "doc": "Q8 \u672C\u5730\u7CBE\u6392\u670D\u52A1\u5730\u5740\uFF08\u7A7A=\u590D\u7528 rank-server\uFF09", "kind": "string" },
  { "flag": "rank-server-q4", "cfgKey": "rank_server_q4", "doc": "Q4 \u672C\u5730\u7CBE\u6392\u670D\u52A1\u5730\u5740", "kind": "string" },
  { "flag": "rank-api-url", "cfgKey": "rank_api_url", "doc": "\u2463.5 API \u5730\u5740", "kind": "string" },
  { "flag": "rank-api-key-env", "cfgKey": "rank_api_key_env", "doc": "\u2463.5 API Key \u73AF\u5883\u53D8\u91CF", "kind": "string" },
  { "flag": "rank-api-model", "cfgKey": "rank_api_model", "doc": "\u2463.5 API \u6A21\u578B", "kind": "string" },
  { "flag": "rank-api-think-mode", "cfgKey": "rank_api_think_mode", "doc": "\u2463.5 API \u601D\u8003\u6A21\u5F0F", "kind": "enum", "choices": ["never", "auto", "always"] },
  { "flag": "rank-api-timeout", "cfgKey": "rank_api_timeout", "doc": "\u2463.5 API \u8D85\u65F6\u79D2", "kind": "float", "min": 1 },
  { "flag": "rank-request-timeout", "cfgKey": "rank_request_timeout", "doc": "\u672C\u5730\u7CBE\u6392\u5355\u8BF7\u6C42\u8D85\u65F6\u79D2", "kind": "float", "min": 1 },
  { "flag": "rank-retries", "cfgKey": "rank_retries", "doc": "\u2463.5 \u5355\u884C 429/5xx/\u8D85\u65F6\u91CD\u8BD5\u6B21\u6570", "kind": "int", "min": 0, "max": 5 },
  { "flag": "rank-retry-backoff-ms", "cfgKey": "rank_retry_backoff_ms", "doc": "\u2463.5 \u91CD\u8BD5\u6307\u6570\u9000\u907F\u57FA\u6570\u6BEB\u79D2", "kind": "int", "min": 0 },
  { "flag": "semantic-projection", "kind": "enum", "choices": ["body_core", "summary"], "internal": "semanticProjection", "deprecated": true, "doc": "\uFF08\u5DF2\u5E9F\u5F03\uFF0CG6 \u5220\u9664\uFF09" },
  { "flag": "no-tokenizer-cache", "cfgKey": "tokenizer_cache", "kind": "bool", "value": false, "doc": "\u5173\u95ED tokenizer \u6D3E\u751F\u7269\u7F13\u5B58\uFF08\u6BCF\u6B21\u91CD\u5EFA trie\uFF09" },
  { "flag": "tokenizer-cache-dir", "cfgKey": "tokenizer_cache_dir", "kind": "string", "doc": "tokenizer \u6D3E\u751F\u7269\u7F13\u5B58\u76EE\u5F55\uFF08\u9ED8\u8BA4\u7CFB\u7EDF\u4E34\u65F6\u76EE\u5F55\uFF09" },
  { "flag": "offline", "cfgKey": "offline", "kind": "bool", "value": true, "doc": "\u79BB\u7EBF\u6A21\u5F0F\uFF1A\u7981\u6B62\u8054\u7F51" },
  { "flag": "auto-provision", "cfgKey": "auto_provision", "kind": "bool", "value": true, "doc": "\u5141\u8BB8 scan \u65F6\u81EA\u52A8\u4E0B\u8F7D/\u6784\u5EFA\uFF08\u9ED8\u8BA4\u79BB\u7EBF\u4F18\u5148\uFF1B\u63A8\u8350\u5148 models ensure\uFF09" },
  { "flag": "no-auto-provision", "cfgKey": "auto_provision", "kind": "bool", "value": false, "doc": "\u5173\u95ED\u81EA\u52A8\u4E0B\u8F7D/\u6784\u5EFA\uFF08\u9ED8\u8BA4\u5DF2\u5173\u95ED\uFF0C\u4FDD\u7559\u517C\u5BB9\uFF09" },
  { "flag": "io-dialect", "cfgKey": "io_dialect", "kind": "enum", "choices": ["native", "python"], "doc": "\u5199\u6587\u4EF6\u5B57\u8282\u65B9\u8A00" },
  { "flag": "parity-bytes", "cfgKey": "parity_bytes", "kind": "bool", "value": true, "doc": "\u5B57\u8282\u7EA7 parity \u56DE\u5F52\u6A21\u5F0F" },
  { "flag": "models-dir", "cfgKey": "models_dir", "kind": "string", "doc": "\u6A21\u578B\u6839\u76EE\u5F55\u8986\u76D6" },
  { "flag": "hf-endpoint", "cfgKey": "hf_endpoint", "kind": "string", "doc": "HF \u955C\u50CF\u7AEF\u70B9\uFF08\u5982 https://hf-mirror.com\uFF09" },
  { "flag": "rebuild-models", "cfgKey": "rebuild_models", "kind": "bool", "value": true, "doc": "\u5F3A\u5236\u91CD\u5EFA\u6D3E\u751F\u6A21\u578B\uFF08\u5FFD\u7565\u7F13\u5B58\uFF09" },
  { "flag": "stream-mode", "cfgKey": "stream_mode", "kind": "enum", "choices": ["bulk", "stream"], "doc": "\u9759\u6001\u8868\u52A0\u8F7D\u6A21\u5F0F" },
  { "flag": "worker-pool", "cfgKey": "worker_pool", "kind": "enum", "choices": ["off", "auto"], "doc": "\u2463 \u6761\u4EF6 worker \u6C60\uFF08auto \u624D\u6309 N/\u9608\u503C\u542F\u7528\uFF09" },
  { "flag": "worker-pool-size", "cfgKey": "worker_pool_size", "kind": "int", "min": 0, "max": 8, "doc": "worker \u6570\uFF080=\u81EA\u52A8\uFF09" },
  { "flag": "max-table-mb", "cfgKey": "max_table_mb", "kind": "int", "min": 0, "doc": "bulk \u8868\u5185\u5B58\u9884\u7B97 MB\uFF080=\u4E0D\u9650\u5236\uFF09" },
  { "flag": "help", "kind": "help", "doc": "\u663E\u793A\u5E2E\u52A9" }
];
var DEFAULTS = Object.fromEntries(CONFIG_FIELDS.map((x) => [x.key, JSON.parse(JSON.stringify(x.default))]));
var FIELD_BY_KEY = new Map(CONFIG_FIELDS.map((x) => [x.key, x]));
var CLI_BY_FLAG = new Map(CLI_OPTIONS.filter((x) => x.kind !== "help").map((x) => ["--" + x.flag, Object.assign({}, x, { flag: "--" + x.flag })]));

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/config.js
function makeConfig(overrides) {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (!FIELD_BY_KEY.has(key)) throw new ConfigError("\u672A\u77E5\u914D\u7F6E\u5B57\u6BB5: " + key + "\uFF08\u53EA\u5141\u8BB8 CONFIG_FIELDS \u4E2D\u58F0\u660E\u7684\u5B57\u6BB5\uFF09", { where: "config" });
    }
    Object.assign(cfg, overrides);
  }
  return cfg;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/firstrun.js
function manualHint(registry, registryFile, missingIds, rootDir) {
  const lines = [];
  for (const id of missingIds) {
    const a = artifactById(registry, id);
    const dir = artifactDir(registry, registryFile, id, rootDir);
    for (const f of a.files) lines.push("  - " + path18.join(dir, f.path) + " (sha256=" + f.sha256 + ", bytes=" + f.bytes + ")");
  }
  return lines.join("\n");
}
async function resolveModels(opts) {
  const o = opts || {};
  const cfg = o.cfg || makeConfig();
  const loaded = o.registry ? { registry: o.registry, file: o.registryFile || defaultRegistryPath() } : loadRegistry(o.registryFile);
  const registry = loaded.registry;
  const registryFile = loaded.file;
  const rootDir = o.rootDir || cfg.models_dir || void 0;
  const offline = o.offline !== void 0 ? !!o.offline : !!cfg.offline;
  const auto = o.autoProvision !== void 0 ? !!o.autoProvision : cfg.auto_provision === true;
  const result = { manifests: {}, dirs: {}, verified: [], downloaded: [], built: [], skipped: [], optionalMissing: [] };
  const missing = [];
  for (const a of registry.artifacts) {
    if (verifyArtifact(registry, registryFile, a.id, { rootDir }).ok) result.verified.push(a.id);
    else if (a.optional) result.optionalMissing.push(a.id);
    else missing.push(a.id);
  }
  if (missing.length) {
    if (!auto) {
      throw new ModelMissingError("\u6A21\u578B\u7F3A\u5931\uFF08\u79BB\u7EBF\u4F18\u5148\uFF0C\u9ED8\u8BA4\u4E0D\u81EA\u52A8\u4E0B\u8F7D\uFF09: " + missing.join(", ") + "\n\u8FD0\u884C skill-merge models ensure \u4E0B\u8F7D/\u6784\u5EFA\uFF0C\u6216\u8BBE\u7F6E --models-dir \u6307\u5411\u5DF2\u6709\u6A21\u578B\u6839\u76EE\u5F55\u3002", { where: "firstrun" });
    }
    if (offline) {
      throw new ModelMissingError("offline \u6A21\u5F0F\u7F3A\u5C11\u6A21\u578B\uFF08\u4E0D\u4F1A\u8054\u7F51\uFF09:\n" + manualHint(registry, registryFile, missing, rootDir) + "\n\u8BF7\u8054\u7F51\u91CD\u8BD5\uFF08\u53EF\u8BBE HF_ENDPOINT \u955C\u50CF\uFF09\u6216\u6309\u4E0A\u8FF0\u8DEF\u5F84\u624B\u52A8\u653E\u7F6E\u540E\u91CD\u8DD1\u3002", { where: "firstrun" });
    }
    const ens = await ensureModels({
      registry,
      registryFile,
      ids: registry.artifacts.filter((a) => !a.optional).map((a) => a.id),
      rootDir,
      offline: false,
      endpoint: o.endpoint,
      fetchImpl: o.fetchImpl,
      allowInsecure: o.allowInsecure,
      onProgress: o.onProgress,
      signal: o.signal,
      force: false
    });
    result.downloaded = ens.downloaded;
    result.built = ens.built;
    result.skipped = ens.skipped;
  }
  for (const a of registry.artifacts) {
    const v = verifyArtifact(registry, registryFile, a.id, { rootDir, hash: true });
    if (!v.ok) {
      if (a.optional) {
        if (!result.optionalMissing.includes(a.id)) result.optionalMissing.push(a.id);
        continue;
      }
      throw new InvalidDataError("\u6A21\u578B\u6821\u9A8C\u5931\u8D25: " + a.id + " " + JSON.stringify({ missing: v.missing, mismatched: v.mismatched }), { where: "firstrun" });
    }
    result.manifests[a.id] = a.manifest || null;
    result.dirs[a.id] = artifactDir(registry, registryFile, a.id, rootDir);
  }
  return result;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/models/supply.js
function configuredDirs(cfg) {
  return { int8: cfg.embedder_model, pca: cfg.embedder_model_last || cfg.embedder_model };
}
function dirsReady(dirs) {
  try {
    if (!dirs || !dirs.int8 || !exists(path19.join(dirs.int8, "config.json"))) return false;
    if (!dirs.pca || !exists(path19.join(dirs.pca, "config.json"))) return false;
    return true;
  } catch (e) {
    return false;
  }
}
function localTierDirs(registry, registryFile, rootDir) {
  const out = {};
  for (const t of registry.tiers || []) {
    const m = (registry.models || []).find((x) => x.id === t.modelRef);
    if (!m || m.compute !== "local-static" || !m.artifactRef) continue;
    out[m.artifactRef] = artifactDir(registry, registryFile, m.artifactRef, rootDir);
  }
  return out;
}
async function supplyLocalModels(opts) {
  const o = opts || {};
  const cfg = o.cfg || {};
  const runtime = o.runtime || null;
  const managed = o.managed !== void 0 ? !!o.managed : Boolean(cfg.models_dir);
  const rootDir = o.rootDir !== void 0 ? o.rootDir : cfg.models_dir || void 0;
  const offline = o.offline !== void 0 ? !!o.offline : !!cfg.offline;
  const autoProvision = o.autoProvision !== void 0 ? !!o.autoProvision : cfg.auto_provision === true;
  const configured = configuredDirs(cfg);
  if (!managed && dirsReady(configured)) {
    return { managed: false, skipped: true, reason: "\u914D\u7F6E\u6A21\u578B\u76EE\u5F55\u5DF2\u5C31\u7EEA", dirs: configured, downloaded: [], built: [], verified: [], optionalMissing: [], offline };
  }
  const loaded = o.registry ? { registry: o.registry, file: o.registryFile || defaultRegistryPath() } : loadRegistry(o.registryFile);
  const res = await resolveModels({
    cfg,
    registry: loaded.registry,
    registryFile: loaded.file,
    rootDir,
    offline,
    autoProvision,
    fetchImpl: o.fetchImpl,
    allowInsecure: o.allowInsecure,
    endpoint: o.endpoint,
    onProgress: o.onProgress
  });
  const rdirs = localTierDirs(loaded.registry, loaded.file, rootDir);
  const dirs = Object.assign({}, configured);
  if (rdirs["local:int8-256"]) dirs.int8 = rdirs["local:int8-256"];
  if (rdirs["local:pca64-int8"]) dirs.pca = rdirs["local:pca64-int8"];
  if (runtime) runtime.modelDirs = dirs;
  else {
    if (rdirs["local:int8-256"]) cfg.embedder_model = dirs.int8;
    if (rdirs["local:pca64-int8"]) cfg.embedder_model_last = dirs.pca;
  }
  return {
    managed,
    skipped: false,
    dirs,
    downloaded: res.downloaded || [],
    built: res.built || [],
    verified: res.verified || [],
    optionalMissing: res.optionalMissing || [],
    offline
  };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/provision.js
var provisionStage = defineStage({
  id: "provision",
  requires: ["lexical"],
  async run(ctx, env) {
    const supply = await supplyLocalModels({ cfg: ctx.cfg, runtime: ctx.state });
    ctx.state.modelDirs = supply.dirs;
    return {
      data: { supply },
      stats: {
        managed: supply.managed,
        skipped: supply.skipped,
        downloaded: supply.downloaded.length,
        built: supply.built.length,
        verified: supply.verified.length
      },
      counters: { downloaded: supply.downloaded.length, built: supply.built.length }
    };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/stages/rank_plan.js
var rankPlanStage = defineStage({
  id: "rank_plan",
  requires: ["lexical"],
  async run(ctx, env) {
    const plan2 = await plan(ctx.cfg, { signal: ctx.signal });
    let semanticTopN = Number(ctx.cfg.semantic_top_n);
    if (plan2.use_local) semanticTopN = Number(ctx.cfg.semantic_top_n_wide || semanticTopN);
    ctx.state.semanticTopN = semanticTopN;
    plan2.semantic_top_n = semanticTopN;
    return { data: { plan: plan2 }, stats: { use_local: !!plan2.use_local, semantic_top_n: semanticTopN }, counters: { use_local: plan2.use_local ? 1 : 0 } };
  }
});

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/pipeline/compose.js
function byId(stages) {
  const map = /* @__PURE__ */ new Map();
  for (const s of stages) map.set(s.id, s);
  return map;
}
function buildScanStages() {
  const base = byId(defaultStages());
  const need = (id) => {
    const s = base.get(id);
    if (!s) throw new Error("scan stage \u7F3A\u5931: " + id);
    return s;
  };
  return [
    need("prefilter"),
    need("candidates"),
    need("lexical"),
    provisionStage,
    rankPlanStage,
    need("semantic"),
    need("rerank"),
    need("judge")
  ];
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/scan.js
import path21 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/report.js
import path20 from "node:path";

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/contracts/report.js
var REPORT_SCHEMA_VERSION = 1;
var REPORT_REQUIRED_TOP_KEYS = Object.freeze([
  "schemaVersion",
  "generatedAt",
  "command",
  "config",
  "stages",
  "timings",
  "diagnostics",
  "used_mode",
  "degraded",
  "pairs_final"
]);
var PAIR_REQUIRED_FIELDS = Object.freeze(["a", "b", "action", "verdict_id"]);
function bad3(message) {
  return new InvalidDataError(message, { where: "report" });
}
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function assertReportModel(report) {
  if (!isObject(report)) throw bad3("report \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) throw bad3("report.schemaVersion \u5FC5\u987B\u4E3A " + REPORT_SCHEMA_VERSION);
  for (const key of REPORT_REQUIRED_TOP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(report, key)) throw bad3("report \u7F3A\u5C11\u5FC5\u9700\u5B57\u6BB5: " + key);
  }
  if (report.generatedAt !== null && typeof report.generatedAt !== "string") throw bad3("report.generatedAt \u5FC5\u987B\u662F ISO \u5B57\u7B26\u4E32\u6216 null");
  if (report.command !== null && typeof report.command !== "string") throw bad3("report.command \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6216 null");
  if (!isObject(report.config)) throw bad3("report.config \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (!Array.isArray(report.stages)) throw bad3("report.stages \u5FC5\u987B\u662F\u6570\u7EC4");
  if (!isObject(report.timings)) throw bad3("report.timings \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (!Array.isArray(report.diagnostics)) throw bad3("report.diagnostics \u5FC5\u987B\u662F\u6570\u7EC4");
  if (!isObject(report.used_mode)) throw bad3("report.used_mode \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (typeof report.degraded !== "boolean") throw bad3("report.degraded \u5FC5\u987B\u662F boolean");
  if (!Array.isArray(report.pairs_final)) throw bad3("report.pairs_final \u5FC5\u987B\u662F\u6570\u7EC4");
  for (let i = 0; i < report.pairs_final.length; i += 1) {
    const row = report.pairs_final[i];
    if (!isObject(row)) throw bad3("report.pairs_final[" + i + "] \u5FC5\u987B\u662F\u5BF9\u8C61");
    for (const key of PAIR_REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) throw bad3("report.pairs_final[" + i + "] \u7F3A\u5C11\u5B57\u6BB5: " + key);
    }
    if (typeof row.a !== "string" || typeof row.b !== "string") throw bad3("report.pairs_final[" + i + "].a/b \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    if (typeof row.action !== "string") throw bad3("report.pairs_final[" + i + "].action \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    if (!Number.isFinite(row.verdict_id)) throw bad3("report.pairs_final[" + i + "].verdict_id \u5FC5\u987B\u662F\u6570\u503C");
  }
  return report;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/report.js
var RUNTIME_ONLY_CONFIG_KEYS = Object.freeze(["rank_checkpoint", "judge_cache_path", "stub2_floors"]);
var RESERVED_TOP_KEYS = Object.freeze(["schemaVersion", "generatedAt", "command", "meta", "config", "stages", "timings", "diagnostics", "used_mode", "degraded", "pairs_final"]);
var CONFIG_KEYS = CONFIG_FIELDS.map((f) => f.key);
var CANDIDATES_HEADER = Object.freeze(["a", "b", "verdict", "action", "level", "rank_score", "rank_rank", "reason"]);
var PAIRS_HEADER = Object.freeze(["a", "b", "via_summary", "via_body", "jaccard_summary", "jaccard_body", "cosine", "pass_semantic", "action", "target"]);
function cloneJson(v) {
  return JSON.parse(JSON.stringify(v));
}
function why(r) {
  const rn = r && r.reason;
  return typeof rn === "string" ? rn.replace(/\n/g, " ").slice(0, 160) : "";
}
function snapshotConfig(cfg) {
  const src = cfg || {};
  const out = {};
  for (const key of CONFIG_KEYS) {
    if (RUNTIME_ONLY_CONFIG_KEYS.includes(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    out[key] = cloneJson(src[key]);
  }
  return out;
}
function pruneUndefined(value) {
  if (Array.isArray(value)) return value.map((v) => v === void 0 ? null : pruneUndefined(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (value[k] === void 0) continue;
      out[k] = pruneUndefined(value[k]);
    }
    return out;
  }
  return value;
}
function assertJsonSafe(value, at) {
  const p = at || "$";
  if (value === void 0) throw new InvalidDataError("\u62A5\u544A\u542B undefined: " + p, { where: "report" });
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new InvalidDataError("\u62A5\u544A\u542B\u4E0D\u53EF\u5E8F\u5217\u5316\u503C (" + typeof value + "): " + p, { where: "report" });
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new InvalidDataError("\u62A5\u544A\u542B\u975E\u6709\u9650\u6570\u503C: " + p, { where: "report" });
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, p + "[" + i + "]"));
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) assertJsonSafe(value[k], p + "." + k);
  }
}
function timingRows(stages) {
  return (stages || []).map((x) => ({ id: x.id, ms: x.ms, counters: x.counters || {}, degraded: !!x.degraded }));
}
function timingsSummary(rows) {
  const by = {};
  let total = 0;
  for (const r of rows) {
    by[r.id] = r.ms;
    total += Number(r.ms) || 0;
  }
  return { total_ms: Math.round(total * 10) / 10, by_stage: by };
}
function buildReport(spec) {
  const s = spec || {};
  const ctx = s.ctx || null;
  const cfg = s.cfg !== void 0 ? s.cfg : ctx && ctx.cfg;
  const stageInput = s.stages !== void 0 ? s.stages : ctx && ctx.timings;
  const diagInput = s.diagnostics !== void 0 ? s.diagnostics : ctx && ctx.diagnostics && ctx.diagnostics.items;
  const stages = timingRows(stageInput);
  const sections2 = Object.assign({}, s.sections || {});
  const pairsFinal = Object.prototype.hasOwnProperty.call(sections2, "pairs_final") ? sections2.pairs_final : s.pairsFinal || [];
  delete sections2.pairs_final;
  for (const k of Object.keys(sections2)) {
    if (RESERVED_TOP_KEYS.includes(k)) throw new InvalidDataError("report.sections \u4E0D\u5F97\u8986\u76D6\u4FDD\u7559\u5B57\u6BB5: " + k, { where: "report" });
  }
  const degraded = s.degraded !== void 0 ? !!s.degraded : stages.some((x) => x.degraded === true) || !!(s.usedMode && s.usedMode.degraded === true);
  const report = Object.assign({
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: s.generatedAt === void 0 ? null : s.generatedAt,
    command: s.command === void 0 ? null : s.command,
    meta: Object.assign({ contractVersion: CONTRACT_VERSION, generator: "skill-merge-node" }, pruneUndefined(s.meta || {})),
    config: snapshotConfig(cfg),
    stages,
    timings: timingsSummary(stages),
    diagnostics: pruneUndefined((diagInput || []).slice()),
    used_mode: pruneUndefined(s.usedMode || {}),
    degraded,
    pairs_final: pairsFinal
  }, sections2);
  assertJsonSafe(report);
  assertReportModel(report);
  return report;
}
function stageData(res, id) {
  const s = (res.stages || []).find((x) => x.id === id);
  return s ? s.data : {};
}
function stageStats(res, id) {
  const s = (res.stages || []).find((x) => x.id === id);
  return s ? s.stats : {};
}
function buildScanReport(opts) {
  const o = opts || {};
  const res = o.res || {};
  const cfg = o.cfg || {};
  const preStats = stageStats(res, "prefilter");
  const candStats = stageStats(res, "candidates");
  const lexStats = stageStats(res, "lexical");
  const rankPlan = stageData(res, "rank_plan").plan;
  const semStats = stageStats(res, "semantic");
  const semScored = stageData(res, "semantic").scored || [];
  const rerankStats = stageStats(res, "rerank");
  const verdicts = (stageData(res, "judge").verdicts || []).slice();
  const judgeFallback = stageData(res, "judge").fallback || "";
  const judgeStats = stageStats(res, "judge");
  const dropped = stageData(res, "prefilter").dropped;
  const scored = stageData(res, "lexical").scored || [];
  if (judgeFallback) for (const r of verdicts) {
    r.unjudged = true;
    r.action = "UNJUDGED";
  }
  const semByPair = new Map(semScored.map((r) => [r.a_path + "\0" + r.b_path, r]));
  for (const r of verdicts) {
    const s = semByPair.get(r.a_path + "\0" + r.b_path);
    if (s) {
      r.cosine = s.cosine;
      r.body_cosine = s.body_core_cosine;
      r.summary_cosine = s.summary_cosine;
    }
  }
  const sections2 = {
    corpus: { roots: o.roots || [], skills: Array.isArray(o.skills) ? o.skills.length : 0 },
    boilerplate: o.bp || {},
    stage1_prefilter: preStats,
    stage2_candidates: candStats,
    stage3_lexical: lexStats,
    stage4_semantic: semStats,
    stage4_5_rerank: Object.assign({ plan: rankPlan }, rerankStats),
    stage5_judge: { pairs: verdicts.length, mode: judgeStats.judge_mode || cfg.judge, fallback: judgeFallback, cascade: judgeStats },
    dropped_names: dropped,
    pairs_final: verdicts,
    pairs_all_scored: scored,
    degradation: o.degradation || { degraded: false, reason_code: null, reasons: [], attempts: [] }
  };
  if (o.ledgerAfter !== void 0) sections2.stage2_candidates.ledger_after = o.ledgerAfter;
  const reportDoc = buildReport({
    cfg,
    stages: res.timings || [],
    diagnostics: res.diagnostics || [],
    command: o.command === void 0 ? null : o.command,
    generatedAt: o.generatedAt === void 0 ? null : o.generatedAt,
    usedMode: {
      embedder: semStats.embedder_used || (semStats.skipped ? "skipped" : "local"),
      rank: rerankStats.mode_used,
      judge: judgeStats.judge_mode || cfg.judge,
      degraded: !!(o.degradation && o.degradation.degraded),
      reasons: (o.degradation ? o.degradation.reasons : []) || []
    },
    sections: pruneUndefined(sections2)
  });
  return { reportDoc, sections: sections2, verdicts, rankPlan, rerankStats, judgeFallback, judgeStats, semStats, preStats, candStats, lexStats };
}
function resolveArtifactDialect(cfg) {
  const c = cfg || {};
  return c.parity_bytes === true || c.io_dialect === "python" ? "python" : "native";
}
function candidatesMarkdown(o) {
  const spec = o || {};
  const rows = spec.rows || [];
  const rs = spec.rerankStats || {};
  const judgeFallback = spec.judgeFallback || "";
  const merges = rows.filter((r) => r.verdict_id === 1);
  const unjudged = rows.filter((r) => r.unjudged);
  const keeps = rows.filter((r) => r.verdict_id === -1 && !r.unjudged);
  const lines = [
    "# \u5F85\u5408\u5E76\u5019\u9009\u6E05\u5355",
    "",
    "- \u7CBE\u6392: mode=" + rs.mode_requested + " used=" + rs.mode_used + " degraded=" + rs.degraded + " n=" + rs.n + " \u2192 \u8F93\u51FA " + rs.n_out + " \u5BF9",
    "- \u2464: " + (judgeFallback || "\u5DF2\u5224\u51B3"),
    ""
  ];
  if (merges.length) {
    lines.push("## \u5EFA\u8BAE\u5408\u5E76\uFF08" + merges.length + " \u5BF9\uFF09", "", "| # | A | B | \u7CBE\u6392\u5206 | \u5C42\u7EA7 | \u7406\u7531 |", "| --- | --- | --- | --- | --- | --- |");
    merges.sort((a, b) => (a.rank_rank || 999) - (b.rank_rank || 999));
    merges.forEach((r, i) => lines.push("| " + (i + 1) + " | " + r.a + " | " + r.b + " | " + r.rank_score + " | " + r.level + " | " + why(r) + " |"));
    lines.push("");
  }
  if (unjudged.length) {
    lines.push("## \u5F85\u4EBA\u5DE5\u5224\u65AD\uFF08\u672A\u5224\u51B3 " + unjudged.length + " \u5BF9\uFF09", "", "| # | A | B | \u7CBE\u6392\u5206 |", "| --- | --- | --- | --- |");
    unjudged.sort((a, b) => (Number(b.rank_score) || 0) - (Number(a.rank_score) || 0));
    unjudged.forEach((r, i) => lines.push("| " + (i + 1) + " | " + r.a + " | " + r.b + " | " + r.rank_score + " |"));
    lines.push("");
  }
  if (keeps.length) {
    lines.push("## \u5404\u81EA\u4FDD\u7559\uFF08" + keeps.length + " \u5BF9\uFF09", "");
    for (const r of keeps) lines.push("- " + r.a + " \u2194 " + r.b + "\uFF08\u7CBE\u6392\u5206 " + r.rank_score + "\uFF0C" + r.level + "\uFF09");
    lines.push("");
  }
  if (rs.degraded) lines.push("> \u964D\u7EA7\u8BF4\u660E: " + rs.reason, "");
  return lines.join("\n");
}
function candidatesCsvRows(rows) {
  return (rows || []).map((r) => [r.a, r.b, r.verdict_id, r.action, r.level, r.rank_score, r.rank_rank, why(r)]);
}
function pairsCsvRows(verdicts) {
  return (verdicts || []).map((r) => [r.a, r.b, r.via_summary, r.via_body, r.jaccard_summary, r.jaccard_body, r.cosine, r.pass_semantic, r.action, r.target]);
}
function artifactBanner(reportDoc) {
  const um = reportDoc && reportDoc.used_mode || {};
  const reasons = Array.isArray(um.reasons) ? um.reasons.map((x) => x && x.code || String(x)).filter(Boolean) : [];
  if (!um.degraded && !reasons.length) return "";
  return "> \u964D\u7EA7/\u542F\u53D1\u5F0F: " + (reasons.join(", ") || "degraded") + "\n\n";
}
function writeArtifacts(outDir, spec) {
  const s = spec || {};
  const cfg = s.cfg || {};
  const reportDoc = s.report || {};
  const dialect = resolveArtifactDialect(cfg);
  const d = resolveDialect(dialect);
  const views = {
    "candidates.md": { derived: true, source: "report.json" },
    "candidates.csv": { derived: true, source: "report.json" },
    "pairs.csv": { derived: true, source: "report.json" }
  };
  const runMeta = {
    schemaVersion: 1,
    command: reportDoc.command === void 0 ? null : reportDoc.command,
    generatedAt: reportDoc.generatedAt === void 0 ? null : reportDoc.generatedAt,
    config: reportDoc.config || s.config || {},
    degraded: reportDoc.degraded === true,
    authoritative: "report.json",
    views
  };
  writeJson(path20.join(outDir, "run.meta.json"), runMeta, { eol: d.eol, sortKeys: d.sortKeys });
  writeJson(path20.join(outDir, "report.json"), reportDoc, { eol: d.eol, sortKeys: d.sortKeys });
  writeText(path20.join(outDir, "candidates.md"), artifactBanner(reportDoc) + (s.markdown || ""), { eol: d.eol });
  writeCsv(path20.join(outDir, "candidates.csv"), { header: CANDIDATES_HEADER, rows: s.candidatesRows || [], dialect: d.csvDialect, eol: d.eol });
  writeCsv(path20.join(outDir, "pairs.csv"), { header: PAIRS_HEADER, rows: s.pairsRows || [], dialect: d.csvDialect, eol: d.eol });
  return { dialect, eol: d.eol, sortKeys: d.sortKeys, files: ["run.meta.json", "report.json", "candidates.md", "candidates.csv", "pairs.csv"], views };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/degrade.js
function stageStats2(res, id) {
  const s = (res && res.stages || []).find((x) => x.id === id);
  return s ? s.stats || {} : {};
}
function assessDegradation(opts) {
  const o = opts || {};
  const res = o.res || {};
  const reasons = [];
  const seen = /* @__PURE__ */ new Set();
  function add(code, stage, detail) {
    const c = String(code || "degraded");
    if (seen.has(c + "|" + stage)) return;
    seen.add(c + "|" + stage);
    reasons.push({ code: c, stage: stage || "unknown", detail: String(detail || "") });
  }
  const sem = stageStats2(res, "semantic");
  if (sem.embedder_degraded) add(sem.embedder_reason || "embedder-degraded", "semantic", "embedder \u94FE\u964D\u7EA7");
  const rank = stageStats2(res, "rerank");
  if (rank.degraded) add(rank.reason_code || "rank-degraded", "rerank", rank.reason || "\u7CBE\u6392\u964D\u7EA7");
  if (rank.mode_used === "vec") add("rank-vec", "rerank", "\u2463.5 \u4F7F\u7528\u5411\u91CF\u53E3\u5F84\uFF08\u975E\u771F\u5B9E\u7CBE\u6392\uFF09");
  if (rank.mode_used === "local_partial") add("rank-partial", "rerank", "\u2463.5 \u90E8\u5206\u884C\u5411\u91CF\u8865\u4F4D");
  if (rank.mode_used === "api_partial") add("rank-api-partial", "rerank", "\u2463.5 API \u90E8\u5206\u5931\u8D25\u56DE\u9000");
  const judge = stageStats2(res, "judge");
  if (judge.judge_auto_fallback) add("judge-auto-fallback", "judge", "auto \u65E0 key \u9000\u5316\u4E3A stub");
  if (judge.judge_mode === "stub" || judge.judge_mode === "stub2") add("judge-" + judge.judge_mode, "judge", "\u2464 \u4F7F\u7528\u542F\u53D1\u5F0F\u5224\u51B3");
  if (Number(judge.errors || 0) > 0) add("judge-errors", "judge", judge.errors + " \u884C\u5224\u51B3\u5931\u8D25");
  for (const t of res.timings || []) if (t.degraded) add("stage-degraded", t.id, "stage \u964D\u7EA7");
  const attempts = Array.isArray(rank.attempts) ? rank.attempts.slice(0, 50) : [];
  return {
    degraded: reasons.length > 0,
    reason_code: reasons.length ? reasons[0].code : null,
    reasons,
    attempts
  };
}

// dsh-evolution-mirror/packages/evolution-merge-engine/vendor/skill-merge-pipeline/src/scan.js
function stageData2(res, id) {
  const s = res.stages.find((x) => x.id === id);
  return s ? s.data : {};
}
function stageStats3(res, id) {
  const s = res.stages.find((x) => x.id === id);
  return s ? s.stats : {};
}
async function runScan(opts) {
  const o = opts || {};
  const cfg = o.cfg;
  const roots = o.corpus || [];
  const out = o.out || "";
  if (!cfg) throw new Error("runScan \u7F3A\u5C11 cfg");
  ensureDir(out);
  const [skills] = loadCorpus(roots);
  const bp = stripBoilerplate(skills, cfg);
  cfg.rank_checkpoint = path21.join(out, "rank_scores.json");
  if (cfg.judge_cache && !cfg.judge_cache_path) cfg.judge_cache_path = path21.join(out, "judge_cache.json");
  const res = await runPipeline({
    cfg,
    out,
    stages: buildScanStages(),
    input: { skills },
    signal: o.signal,
    onProgress: typeof o.onProgress === "function" ? o.onProgress : void 0
  });
  if (!res.ok) return { ok: false, res, cfg, skills, bp, error: res.error, exitCode: res.exitCode };
  const degradation = assessDegradation({ res, cfg });
  const pairs = stageData2(res, "candidates").pairs;
  let ledgerAfter;
  if (cfg.ledger_path) {
    const allPairs = [...pairs.keys()].map((k) => k.split("\0"));
    mark(cfg.ledger_path, allPairs, { run_out: out });
    ledgerAfter = Object.keys(load2(cfg.ledger_path)).length;
  }
  const built = buildScanReport({
    cfg,
    res,
    roots,
    skills,
    bp,
    ledgerAfter,
    degradation,
    command: o.command === void 0 ? null : o.command,
    generatedAt: o.generatedAt === void 0 ? null : o.generatedAt
  });
  writeArtifacts(out, {
    cfg,
    config: cfg,
    report: built.reportDoc,
    markdown: candidatesMarkdown({ rows: built.verdicts, rerankStats: built.rerankStats, rankPlan: built.rankPlan, judgeFallback: built.judgeFallback }),
    candidatesRows: candidatesCsvRows(built.verdicts),
    pairsRows: pairsCsvRows(built.verdicts)
  });
  return { ok: true, res, cfg, skills, bp, sections: built.sections, reportDoc: built.reportDoc, out, degradation, strictFail: cfg.strict === true && degradation.degraded };
}
function formatScanSummary(scan, opts) {
  if (!scan || !scan.ok) return [];
  const verbose = !!(opts && opts.verbose) || scan.cfg && scan.cfg.verbose === true;
  if (!verbose) {
    const verdicts2 = stageData2(scan.res, "judge").verdicts || [];
    const mergeRows = verdicts2.filter((r) => r.verdict_id === 1).sort((a, b) => (Number(b.rank_score) || 0) - (Number(a.rank_score) || 0) || String(a.a).localeCompare(String(b.a)));
    const keep = verdicts2.filter((r) => r.verdict_id === -1).length;
    const undecided = verdicts2.filter((r) => r.verdict_id === 0).length;
    const reasons = scan.degradation && scan.degradation.reasons ? scan.degradation.reasons.map((x) => x.code) : [];
    const conclusion = "\u7ED3\u8BBA: " + scan.skills.length + " \u4E2A\u6280\u80FD\uFF1B\u5019\u9009 " + verdicts2.length + " \u5BF9\uFF1BMERGE " + mergeRows.length + " / UNDECIDED " + undecided + " / KEEP " + keep + (reasons.length ? "\uFF1B\u964D\u7EA7/\u542F\u53D1\u5F0F: " + reasons.join(",") : "");
    const top = mergeRows.slice(0, 3).map((r) => r.a + " \u2194 " + r.b + "\uFF08" + (r.rank_score === void 0 ? "score n/a" : "score " + r.rank_score) + "\uFF09").join("\uFF1B") || "\u6682\u65E0\u5EFA\u8BAE\u5408\u5E76\u5BF9";
    const roots = scan.sections && scan.sections.corpus && scan.sections.corpus.roots || [];
    const planCmd = "skill-merge plan --report " + path21.join(scan.out || ".", "report.json") + " --corpus " + (roots.join(" ") || "<dir>");
    return [conclusion, "Top: " + top, "\u4E0B\u4E00\u6B65: " + planCmd + (scan.strictFail ? "\uFF1B\u4E25\u683C\u6A21\u5F0F: \u5B58\u5728\u964D\u7EA7/\u542F\u53D1\u5F0F\u8DEF\u5F84\uFF08exit 1\uFF09" : "")];
  }
  const res = scan.res;
  const pre = stageStats3(res, "prefilter");
  const cand = stageStats3(res, "candidates");
  const lex = stageStats3(res, "lexical");
  const sem = stageStats3(res, "semantic");
  const rerank2 = stageStats3(res, "rerank");
  const judge = stageStats3(res, "judge");
  const verdicts = stageData2(res, "judge").verdicts || [];
  const lines = [
    "\u8BED\u6599: " + scan.skills.length + " \u4E2A\u6280\u80FD\uFF08" + (scan.sections.corpus.roots || []).length + " \u4E2A\u76EE\u5F55\uFF09",
    "\u516C\u5171\u524D\u8A00\u5265\u79BB: " + JSON.stringify(scan.bp),
    "\u2460 \u9884\u8FC7\u6EE4: " + JSON.stringify(pre),
    "\u2461 \u5019\u9009\u751F\u6210: " + JSON.stringify(cand),
    "\u2462 \u8BCD\u9762\u95E8\u9650: " + JSON.stringify(lex),
    "\u2463 \u5411\u91CF\u76F8\u4F3C\u5EA6: " + JSON.stringify(sem),
    "\u2463.5 \u7CBE\u6392: " + JSON.stringify(rerank2),
    "\u2464 \u5224\u51B3: " + verdicts.length + " \u5BF9\uFF08" + (judge.judge_mode || scan.cfg.judge) + "\uFF09"
  ];
  if (judge) lines.push("   \u7EA7\u8054: " + JSON.stringify(judge));
  const degradation = scan.degradation;
  if (degradation && degradation.reasons.length) lines.push("\u964D\u7EA7/\u542F\u53D1\u5F0F: " + degradation.reasons.map((x) => x.code).join(", "));
  if (scan.strictFail) lines.push("\u4E25\u683C\u6A21\u5F0F: \u5B58\u5728\u964D\u7EA7/\u542F\u53D1\u5F0F\u8DEF\u5F84 \u21D2 exit 1");
  const supply = stageData2(res, "provision").supply;
  if (supply && !supply.skipped) lines.push("\u6A21\u578B\u4F9B\u7ED9: \u4E0B\u8F7D " + (supply.downloaded || []).length + " \u4EF6 / \u6784\u5EFA " + (supply.built || []).length + " \u4EF6 / \u6821\u9A8C " + (supply.verified || []).length + " \u4EF6\uFF08" + (supply.managed ? "managed" : "auto") + "\uFF09");
  lines.push("\u8FD0\u884C\u7EA7: seed=" + cand.run_seed + " mode=" + scan.cfg.seed_mode + " | \u53F0\u8D26 " + cand.ledger_total_before + " -> " + scan.sections.stage2_candidates.ledger_after + " | \u2463.5 " + rerank2.mode_used + " | \u2463 " + sem.selected + " \u5BF9");
  lines.push("\u4EA7\u51FA: " + scan.out);
  return lines;
}

// dsh-evolution-mirror/packages/evolution-merge-engine/src/engine.js
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
import path22 from "node:path";
var ROOT = join(dirname(fileURLToPath4(import.meta.url)), "..");
var VERSION = "0.29.0";
function registrySha() {
  const p = join(ROOT, "vendor", "skill-merge-pipeline", "models", "registry.json");
  return existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "";
}
function envelope(corpusDir, outDir) {
  return { corpusDir, outDir, modelSha: registrySha(), engineVersion: VERSION };
}
function wrapJudgeStage(stage, runner) {
  return defineStage({
    id: stage.id,
    requires: stage.requires,
    async run(ctx, env) {
      const cfg = Object.assign({}, ctx.cfg);
      const resolution = resolveJudge(cfg, ctx.env);
      if (cfg.judge === "auto") cfg.judge = resolution.mode;
      if (cfg.judge === "stub2" && env.semantic && env.semantic.floors_used) {
        cfg.stub2_floors = { body: env.semantic.floors_used.body, summary: env.semantic.floors_used.summary };
        ctx.state.stub2Floors = cfg.stub2_floors;
      }
      ctx.state.judgeMode = cfg.judge;
      const [verdicts, stats] = await judgeCascade(env.rerank.ranked, env.semantic.byPath, cfg, path22.join(ctx.out, "prompts"), runner);
      return { data: { verdicts, fallback: resolution.fallback }, stats, counters: { pairs: verdicts.length } };
    }
  });
}
async function runWithRunner({ corpusDir, outDir, cfg, signal, onProgress, runner }) {
  const o = { cfg, corpus: [corpusDir], out: outDir, signal, onProgress };
  ensureDir(outDir);
  const [skills] = loadCorpus(o.corpus);
  const bp = stripBoilerplate(skills, cfg);
  cfg.rank_checkpoint = path22.join(outDir, "rank_scores.json");
  if (cfg.judge_cache && !cfg.judge_cache_path) cfg.judge_cache_path = path22.join(outDir, "judge_cache.json");
  const stages = buildScanStages().map((s) => s.id === "judge" ? wrapJudgeStage(s, runner) : s);
  const res = await runPipeline({ cfg, out: outDir, stages, input: { skills }, signal, onProgress });
  if (!res.ok) return { ok: false, error: res.error, exitCode: res.exitCode };
  const degradation = assessDegradation({ res, cfg });
  const pairs = res.stages.find((s) => s.id === "candidates")?.data?.pairs;
  let ledgerAfter;
  if (cfg.ledger_path) {
    const allPairs = [...pairs.keys()].map((k) => k.split("\0"));
    mark(cfg.ledger_path, allPairs, { run_out: outDir });
    ledgerAfter = Object.keys(load2(cfg.ledger_path)).length;
  }
  const built = buildScanReport({ cfg, res, roots: o.corpus, skills, bp, ledgerAfter, degradation, command: null, generatedAt: null });
  writeArtifacts(outDir, { cfg, config: cfg, report: built.reportDoc, markdown: candidatesMarkdown({ rows: built.verdicts, rerankStats: built.rerankStats, rankPlan: built.rankPlan, judgeFallback: built.judgeFallback }), candidatesRows: candidatesCsvRows(built.verdicts), pairsRows: pairsCsvRows(built.verdicts) });
  return { ok: true, reportDoc: built.reportDoc, sections: built.sections, degradation, strictFail: cfg.strict === true && degradation.degraded };
}
async function screen(input) {
  const { corpusDir, outDir, signal, onProgress, runner } = input;
  if (!corpusDir || !outDir) return { ok: false, error: { code: "BAD_INPUT", detail: "corpusDir/outDir required" } };
  const cfg = makeConfig(input.cfg ?? {});
  try {
    const resolvedJudge = resolveJudge(cfg, process.env);
    if (resolvedJudge.mode === "deepseek") {
      if (!runner) return { ok: false, error: { code: "RUNNER_REQUIRED", stage: "judge", retryable: false } };
      const scan2 = await runWithRunner({ corpusDir, outDir, cfg, signal, onProgress, runner });
      if (!scan2.ok) return { ok: false, error: { code: "SCAN_FAILED", stage: "pipeline", detail: String(scan2.error ?? ""), exitCode: scan2.exitCode } };
      return { ok: true, report: { ...scan2, envelope: envelope(corpusDir, outDir) } };
    }
    const scan = await runScan({ corpus: [corpusDir], out: outDir, cfg, signal, onProgress });
    if (!scan.ok) return { ok: false, error: { code: "SCAN_FAILED", stage: "pipeline", detail: String(scan.error ?? ""), exitCode: scan.exitCode } };
    return { ok: true, report: { reportDoc: scan.reportDoc, sections: scan.sections, degradation: scan.degradation, strictFail: scan.strictFail, envelope: envelope(corpusDir, outDir) } };
  } catch (err) {
    return { ok: false, error: { code: "ENGINE_ERROR", detail: String(err && err.stack || err) } };
  }
}
function probe(cfgInput) {
  const cfg = makeConfig(cfgInput ?? {});
  const int8 = cfg.embedder_model ? join(cfg.embedder_model, "config.json") : "";
  const pca = cfg.embedder_model_last ? join(cfg.embedder_model_last, "config.json") : "";
  const models = int8 && pca && existsSync(int8) && existsSync(pca) ? "ok" : "missing";
  return { models, judge: cfg.judge === "deepseek" ? "platform" : "stub", ranker: cfg.rank_mode === "vec" ? "vec" : "auto", onnx: false };
}
async function ensureModels2() {
  throw new Error("ensureModels is implemented in G3");
}

// dsh-evolution-mirror/packages/evolution-merge-engine/src/report-map.js
import { createHash as createHash2 } from "node:crypto";
function pairKeyOf(a, b) {
  return [a, b].sort().join("\0");
}
function toCandidateFact(p) {
  return {
    score: p.rank_score ?? p.score,
    arms: Array.isArray(p.arm) ? p.arm : Array.isArray(p.arms) ? p.arms : [],
    reason: p.reason,
    source: "lexical"
  };
}
function toReportPair(p, runId = "engine") {
  const pairKey2 = pairKeyOf(p.a, p.b);
  return {
    id: runId + ":" + createHash2("sha256").update(pairKey2).digest("hex").slice(0, 16),
    pairKey: pairKey2,
    a: p.a,
    b: p.b,
    queue: p.verdict_id === 1 ? "pending" : "skipped",
    candidate: toCandidateFact(p),
    gate: { level: p.level, verdict: p.verdict_id, heuristic: p.heuristic === true },
    decision: void 0,
    outcome: p.verdict_id === 1 ? "pending" : "kept",
    target: void 0,
    archived: [],
    unitId: void 0,
    failure: p.error ? { stage: "judge", code: "JUDGE_ERROR", message: p.reason, retryable: true, retryFrom: "agent2" } : void 0,
    usage: p.usage,
    timing: void 0,
    engineStage: "judge",
    rankSource: p.rank_source,
    promptVersion: p.prompt_sha
  };
}
function mapReport(report, runId = "engine") {
  const doc = report.reportDoc ?? report;
  const pairs = (doc.pairs_final ?? []).map((p) => toReportPair(p, runId));
  return {
    schemaVersion: 1,
    runId,
    kind: "merge",
    pairs,
    notes: [],
    scope: { candidatePairs: doc.stage2_candidates ? doc.stage2_candidates.candidate_pairs : pairs.length, queueBefore: { pending: 0, retry: 0, skipped: 0 } }
  };
}
function toEngineCandidate(p, fallback = "") {
  const level = p.level === "L2(audit)" ? "L2" : p.level;
  return {
    a: p.a,
    b: p.b,
    score: p.rank_score ?? p.score,
    arms: Array.isArray(p.arms) ? p.arms : Array.isArray(p.arm) ? p.arm : [],
    reason: fallback || p.reason,
    source: "engine",
    gate: {
      level,
      verdict: p.verdict_id,
      reason: p.reason,
      heuristic: p.heuristic === true,
      auditOverride: p.level === "L2(audit)"
    }
  };
}
function selectCandidates(report) {
  const doc = report.reportDoc ?? report;
  const rows = Array.isArray(doc.pairs_final) ? doc.pairs_final : [];
  const fallback = doc.stage5_judge && doc.stage5_judge.fallback ? String(doc.stage5_judge.fallback) : "";
  const candidates = [];
  const skipped = [];
  const reportOnly = [];
  for (const row of rows) {
    if (fallback || row.action === "UNJUDGED") {
      candidates.push(toEngineCandidate(row, fallback || row.reason));
      continue;
    }
    if (row.verdict_id === 1 || row.verdict_id === 0) {
      candidates.push(toEngineCandidate(row));
      continue;
    }
    if (row.verdict_id === -1 && row.level === "L2") {
      skipped.push({ pairKey: pairKeyOf(row.a, row.b), a: row.a, b: row.b, reason: row.reason });
      continue;
    }
    reportOnly.push(row);
  }
  const candidatePairs = doc.stage2_candidates && typeof doc.stage2_candidates.candidate_pairs === "number" ? doc.stage2_candidates.candidate_pairs : rows.length;
  return { candidates, skipped, reportOnly, reportFallback: fallback, candidatePairs };
}
export {
  buildScanStages,
  ensureModels2 as ensureModels,
  formatScanSummary,
  makeConfig,
  mapReport,
  pairKeyOf,
  probe,
  runPipeline,
  runScan,
  screen,
  selectCandidates,
  toCandidateFact,
  toEngineCandidate,
  toReportPair
};
