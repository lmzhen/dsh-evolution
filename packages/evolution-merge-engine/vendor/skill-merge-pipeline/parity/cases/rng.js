"use strict";
import { PyRandom } from "../../src/pyrandom.js";
export default {
  id: "rng", layer: "strict", description: "MT19937 与 CPython random 完全一致",
  run(ctx) {
    const ref = ctx.golden("ref_rng.json");
    for (const c of ref) {
      let r = new PyRandom(c.seed);
      const bits = []; for (let i = 0; i < 6; i += 1) bits.push(r.getrandbits(32));
      ctx.assert(JSON.stringify(bits) === JSON.stringify(c.bits), "seed " + c.seed + " getrandbits 不一致");
      r = new PyRandom(c.seed);
      const below = []; for (let i = 0; i < 6; i += 1) below.push(r._randbelow(7)); for (let i = 0; i < 4; i += 1) below.push(r._randbelow(296));
      ctx.assert(JSON.stringify(below) === JSON.stringify(c.below), "seed " + c.seed + " randbelow 不一致");
      r = new PyRandom(c.seed);
      const samp = [r.sample([...Array(7).keys()], 1), r.sample([...Array(7).keys()], 3), r.sample([...Array(296).keys()], 30)];
      ctx.assert(JSON.stringify(samp) === JSON.stringify(c.samples), "seed " + c.seed + " sample 不一致");
      r = new PyRandom(c.seed);
      const uni = []; for (let i = 0; i < 4; i += 1) uni.push(Number(r.uniform(-0.02, 0.02).toFixed(6)));
      ctx.assert(JSON.stringify(uni) === JSON.stringify(c.uniform), "seed " + c.seed + " uniform 不一致");
      r = new PyRandom(c.seed);
      const rint = []; for (let i = 0; i < 4; i += 1) rint.push(r.randint(1, 1000000));
      ctx.assert(JSON.stringify(rint) === JSON.stringify(c.randint), "seed " + c.seed + " randint 不一致");
    }
    return { checked: ref.length };
  }
};