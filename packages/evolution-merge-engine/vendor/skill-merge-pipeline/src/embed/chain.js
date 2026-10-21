"use strict";
// G4.4：档位降级链（C6 attemptSequence；复用实例，失败集跨调用保留）。
import { RemoteEmbedError } from "./remote.js";
import { attemptSequence, classifyReason } from "../attempt.js";
import { throwIfAborted } from "../net/signal.js";

class ChainEmbedder {
  constructor(builders, opts) {
    this.builders = builders; this.signal = (opts && opts.signal) || null; this.chosen = null; this.instance = null; this.label = null; this.name = "chain";
    this.failed = new Set(); this.attempts = [];
    this._degraded = false; this._reasonCode = null; this._cost = null;
  }
  _record(res) {
    for (const a of res.attempts) this.attempts.push(a);
    for (const a of res.attempts) if (!a.ok) this.failed.add(a.tier);
    this.chosen = res.tier; this.label = res.tier; this.instance = res.instance; this.name = "chain:" + res.tier;
    this._degraded = res.degraded; this._reasonCode = res.reasonCode; this._cost = res.cost;
    return res.value;
  }
  async _run(texts) {
    throwIfAborted(this.signal);
    const steps = this.builders.filter(([label]) => !this.failed.has(label)).map(([label, build]) => ({
      tier: label, build, infer: inst => { throwIfAborted(this.signal); return inst.fitTransform(texts); }
    }));
    try {
      return this._record(await attemptSequence(steps));
    } catch (err) {
      if (err && Array.isArray(err.attempts)) {
        for (const a of err.attempts) { this.attempts.push(a); if (!a.ok) this.failed.add(a.tier); }
      }
      this._degraded = true; this._reasonCode = err && err.reasonCode ? err.reasonCode : classifyReason(err);
      throw err;
    }
  }
  async fitTransform(texts) {
    throwIfAborted(this.signal);
    if (this.instance) {
      const inst = this.instance; const label = this.label; const i0 = Date.now();
      try { return await inst.fitTransform(texts); } catch (err) {
        this.failed.add(label);
        this.attempts.push({ tier: label, phase: "infer", ok: false, reasonCode: classifyReason(err), error: String(err && err.message ? err.message : err).slice(0, 160), ms: Date.now() - i0 });
        this.chosen = null; this.instance = null; this.label = null;
        this._degraded = true; this._reasonCode = classifyReason(err);
      }
    }
    return this._run(texts);
  }
  async encode(texts) { return (await this.fitTransform(texts)).map(v => Array.from(v)); }
  async transform(texts) { return this.fitTransform(texts); }
  degrade() { return { tier: this.chosen, attempts: this.attempts, degraded: !!this._degraded, reasonCode: this._reasonCode || null, cost: this._cost || { ms: 0 } }; }
  close() { if (this.instance && typeof this.instance.close === "function") this.instance.close(); }
}

export { ChainEmbedder };