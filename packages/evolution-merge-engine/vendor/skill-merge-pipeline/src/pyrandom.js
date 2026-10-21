"use strict";
// CPython random.Random（MT19937）的等价实现：用于 L0 抽检复现 Python 的 sample 结果
const N = 624; const M = 397; const MATRIX_A = 0x9908b0df; const UPPER_MASK = 0x80000000; const LOWER_MASK = 0x7fffffff;
class PyRandom {
  constructor(seed) { this.mt = new Uint32Array(N); this.mti = N + 1; if (seed !== undefined) this.seed(seed); }
  seed(a) {
    const key = [];
    let s = a < 0 ? -a : a;
    key.push(s >>> 0);
    s = Math.floor(s / 4294967296); while (s > 0) { key.push(s >>> 0); s = Math.floor(s / 4294967296); }
    this._initByArray(key);
  }
  _initGenrand(s) { this.mt[0] = s >>> 0; for (let i = 1; i < N; i += 1) { const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30); this.mt[i] = (Math.imul(1812433253, prev) + i) >>> 0; } this.mti = N; }
  _initByArray(key) {
    this._initGenrand(19650218);
    let i = 1, j = 0;
    let k = Math.max(N, key.length);
    for (; k > 0; k -= 1) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i += 1; j += 1;
      if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k > 0; k -= 1) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i += 1;
      if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1; }
    }
    this.mt[0] = 0x80000000;
    this.mti = N;
  }
  _genrand() {
    let y;
    if (this.mti >= N) {
      let kk;
      for (kk = 0; kk < N - M; kk += 1) { y = (this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK); this.mt[kk] = this.mt[kk + M] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0); }
      for (; kk < N - 1; kk += 1) { y = (this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK); this.mt[kk] = this.mt[kk + (M - N)] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0); }
      y = (this.mt[N - 1] & UPPER_MASK) | (this.mt[0] & LOWER_MASK); this.mt[N - 1] = this.mt[M - 1] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0);
      this.mti = 0;
    }
    y = this.mt[this.mti]; this.mti += 1;
    y ^= (y >>> 11); y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= (y >>> 18);
    return y >>> 0;
  }
  getrandbits(k) {
    if (k <= 32) return this._genrand() >>> (32 - k);
    const words = Math.ceil(k / 32);
    const top = k % 32;
    let v = this._genrand() >>> (32 - top);
    for (let i = 1; i < words; i += 1) v = v * 4294967296 + this._genrand();
    return v;
  }
  _randbelow(n) {
    const k = n.toString(2).length;
    let r;
    do { r = this.getrandbits(k); } while (r >= n);
    return r;
  }
  random() {
    const a = this._genrand() >>> 5, b = this._genrand() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }
  randint(a, b) { return a + this._randbelow(b - a + 1); }
  uniform(a, b) { return a + (b - a) * this.random(); }
  sample(population, k) {
    const n = population.length;
    if (k > n) throw new Error("sample larger than population");
    const result = [];
    let setsize = 21;
    if (k > 5) {
      // CPython: setsize += 4 ** ceil(log4(k * 3))
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
      const selected = new Set();
      for (let i = 0; i < k; i += 1) {
        let j = this._randbelow(n);
        while (selected.has(j)) j = this._randbelow(n);
        selected.add(j);
        result.push(population[j]);
      }
    }
    return result;
  }
}
export { PyRandom };