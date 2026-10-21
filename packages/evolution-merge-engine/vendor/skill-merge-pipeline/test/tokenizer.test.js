"use strict";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Tokenizer } from "../src/text/tokenizer.js";
import { toDiagnostic } from "../src/errors.js";
import { DiagnosticCode } from "../src/contracts.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL_DIR = "D:/dsh/skill-merge/models/potion-multilingual-128M-int8";
const GOLDEN = path.join(__dirname, "..", "parity", "golden", "ref_tokenizer.json");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tok-"));
after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
function writeTok(name, obj) { const p = path.join(TMP, name); fs.writeFileSync(p, JSON.stringify(obj), "utf8"); return p; }
function baseModel(vocab, extra) { return Object.assign({ model: { type: "Unigram", unk_id: 0, vocab } }, extra || {}); }

test("C12 契约：fromFile/info/encode/encodeBatch", () => {
  const tk = Tokenizer.fromFile(path.join(MODEL_DIR, "tokenizer.json"), { cacheDir: TMP });
  const info = tk.info();
  assert.equal(info.modelType, "Unigram");
  assert.equal(info.vocabSize, 500353);
  assert.equal(info.builderVer, 1);
  assert.equal(info.preTokenizer, "metaspace");
  assert.ok(info.trieNodes > 500353);
  assert.ok(Array.isArray(tk.encode("hello world")));
  assert.deepEqual(tk.encodeBatch(["a", "b"]), [tk.encode("a"), tk.encode("b")]);
});

test("golden：20/20 token 与 Python 一致", () => {
  const tk = new Tokenizer(path.join(MODEL_DIR, "tokenizer.json"), { cacheDir: TMP });
  const ref = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  let bad = 0;
  for (const r of ref) if (JSON.stringify(tk.encode(r.text)) !== JSON.stringify(r.ids)) bad += 1;
  assert.equal(bad, 0, bad + "/" + ref.length + " 不一致");
});

test("严格解析：未知 normalizer/pre_tokenizer/model 类型点名报错", () => {
  const norm = writeTok("bad_norm.json", baseModel([["a", -1]], { normalizer: { type: "FancyNormalizer" } }));
  const pt = writeTok("bad_pt.json", baseModel([["a", -1]], { pre_tokenizer: { type: "BertPreTokenizer" } }));
  const mdl = writeTok("bad_model.json", { model: { type: "BPE", vocab: [["a", -1]] } });
  for (const [p, kw] of [[norm, "FancyNormalizer"], [pt, "BertPreTokenizer"], [mdl, "BPE"]]) {
    try { new Tokenizer(p, { cacheDir: TMP }); assert.fail("应抛错: " + p); } catch (e) {
      assert.equal(toDiagnostic(e).code, DiagnosticCode.INVALID);
      assert.match(String(e.message), new RegExp(kw));
    }
  }
});

test("F15：>64 长度 piece 整体匹配（不再被硬帽切错）", () => {
  const long = "x".repeat(80);
  const p = writeTok("long.json", baseModel([["\u2581", -1], [long, -2]]));
  const tk = new Tokenizer(p, { cacheDir: TMP });
  const ids = tk.encode(long);
  assert.deepEqual(ids, [1]);
});

test("Viterbi 最优路径：合成词表选最低代价切分", () => {
  const p = writeTok("vit.json", baseModel([["\u2581", -1], ["a", -2], ["b", -3], ["ab", -1.5]]));
  const tk = new Tokenizer(p, { cacheDir: TMP });
  assert.deepEqual(tk.encode("ab"), [3]);
  assert.deepEqual(tk.encode("a"), [1]);
});

test("未知字符走 unk_id", () => {
  const p = writeTok("unk.json", baseModel([["\u2581", -1], ["a", -2]]));
  const tk = new Tokenizer(p, { cacheDir: TMP });
  const ids = tk.encode("z");
  assert.deepEqual(ids, [0]);
});