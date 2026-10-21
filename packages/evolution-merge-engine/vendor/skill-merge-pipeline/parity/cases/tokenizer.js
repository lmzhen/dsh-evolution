"use strict";
import { Tokenizer } from "../../src/text/tokenizer.js";
export default {
  id: "tokenizer", layer: "strict", description: "tokenizer 20/20 与 Python 一致",
  run(ctx) {
    const ref = ctx.golden("ref_tokenizer.json");
    const tk = new Tokenizer(ctx.modelDir + "/tokenizer.json");
    let bad = 0;
    for (const r of ref) {
      const got = tk.encode(r.text);
      if (JSON.stringify(got) !== JSON.stringify(r.ids)) bad += 1;
    }
    ctx.assert(bad === 0, bad + "/" + ref.length + " 条分词不一致");
    return { checked: ref.length };
  }
};