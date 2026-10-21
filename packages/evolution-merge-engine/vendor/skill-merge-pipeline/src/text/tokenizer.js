"use strict";
// C12：Unigram Tokenizer（严格解析 + CSR trie + 派生物缓存）。API：fromFile/encode/encodeBatch/info。
import { readWithHash } from "../io/read.js";
import { InvalidDataError } from "../errors.js";
import { buildTrie, tokenizeWithTrie } from "./trie.js";
import * as artifact from "./artifact.js";
import * as path from "node:path";

const BUILDER_VER = 1;
const SUPPORTED_NORMALIZERS = new Set(["Sequence", "Precompiled", "Replace", "Strip"]);
const SUPPORTED_PRE_TOKENIZERS = new Set(["Metaspace"]);
const PREPEND_SCHEMES = new Set(["always", "first", "never"]);

function invalid(msg) { return new InvalidDataError(msg, { where: "tokenizer" }); }

function compileNormalizer(node, ops, path) {
  if (node === null || node === undefined) return;
  if (typeof node !== "object" || typeof node.type !== "string") throw invalid("normalizer 节点非法 @" + path);
  const type = node.type;
  if (!SUPPORTED_NORMALIZERS.has(type)) throw invalid("不支持的 normalizer 类型: " + type + " @" + path);
  if (type === "Sequence") {
    if (!Array.isArray(node.normalizers)) throw invalid("Sequence.normalizers 必须是数组 @" + path);
    node.normalizers.forEach((n, i) => compileNormalizer(n, ops, path + ".normalizers[" + i + "]"));
    return;
  }
  if (type === "Precompiled") { ops.push({ kind: "nfkc" }); return; }
  if (type === "Replace") {
    const pat = node.pattern || {};
    if (pat.String !== undefined) { ops.push({ kind: "literal", from: String(pat.String), to: String(node.content === undefined ? "" : node.content) }); return; }
    if (pat.Regex !== undefined) {
      let re;
      try { re = new RegExp(String(pat.Regex), "g"); } catch (e) { throw invalid("Replace 正则非法: " + String(pat.Regex) + " @" + path); }
      ops.push({ kind: "regex", re, to: String(node.content === undefined ? "" : node.content) });
      return;
    }
    throw invalid("Replace.pattern 不支持 @" + path);
  }
  if (type === "Strip") {
    if (node.strip_left === true && node.strip_right === true) { ops.push({ kind: "trim" }); return; }
    throw invalid("Strip 变体不支持（仅支持左右同时）@" + path);
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

function compilePreTokenizer(node, path) {
  if (node === null || node === undefined) return null;
  if (!node || typeof node.type !== "string") throw invalid("pre_tokenizer 节点非法 @" + path);
  if (!SUPPORTED_PRE_TOKENIZERS.has(node.type)) throw invalid("不支持的 pre_tokenizer 类型: " + node.type + " @" + path);
  const replacement = node.replacement === undefined ? "▁" : String(node.replacement);
  const scheme = node.prepend_scheme === undefined ? "always" : String(node.prepend_scheme);
  if (!PREPEND_SCHEMES.has(scheme)) throw invalid("pre_tokenizer.prepend_scheme 不支持: " + scheme + " @" + path);
  if (node.split === true) throw invalid("pre_tokenizer.split=true 暂不支持 @" + path);
  return { kind: "metaspace", replacement, scheme };
}

class Tokenizer {
  constructor(jsonPath, opts) {
    const o = opts || {};
    this._cache = o.cache !== false;
    this._cacheDir = o.cacheDir || process.env.DSH_SKILL_MERGE_CACHE || artifact.defaultCacheDir();
    this._fromArtifact = false;
    this._artifactPath = null;
    const src = readWithHash(jsonPath);
    this.tokenizerSha = src.sha256;
    if (this._cache) {
      this._artifactPath = artifact.artifactPath(this._cacheDir, src.sha256, BUILDER_VER);
      const loaded = artifact.load(this._artifactPath, src.sha256, BUILDER_VER);
      if (loaded) { this._loadArtifact(loaded); return; }
    }
    let parsed;
    try { parsed = JSON.parse(src.buffer.toString("utf8")); } catch (err) {
      throw invalid("tokenizer.json 解析失败: " + String(err && err.message ? err.message : err));
    }
    this._loadJson(parsed);
    if (this._cache) {
      this._artifactPath = artifact.artifactPath(this._cacheDir, src.sha256, BUILDER_VER);
      artifact.save(this._artifactPath, src.sha256, BUILDER_VER, this._artifactMeta(), this.trie);
    }
  }
  static fromFile(jsonPath, opts) { return new Tokenizer(jsonPath, opts); }
  _loadJson(t) {
    this.modelType = t.model && t.model.type;
    if (this.modelType !== "Unigram") throw invalid("仅支持 Unigram 模型，收到: " + this.modelType);
    const vocab = t.model.vocab;
    if (!Array.isArray(vocab) || !vocab.length) throw invalid("model.vocab 必须是非空数组");
    this.model = t.model;
    this.normalizer = t.normalizer;
    this.preTokenizer = t.pre_tokenizer;
    this.unkId = t.model.unk_id != null ? Number(t.model.unk_id) : 0;
    this._ops = [];
    compileNormalizer(t.normalizer, this._ops, "normalizer");
    this._pt = compilePreTokenizer(t.pre_tokenizer, "pre_tokenizer");
    this.scores = new Map();
    this.ids = new Map();
    this.maxPieceLen = 0;
    for (let i = 0; i < vocab.length; i += 1) {
      const e = vocab[i];
      if (!Array.isArray(e) || e.length < 2 || typeof e[0] !== "string" || typeof e[1] !== "number") throw invalid("vocab[" + i + "] 非法（应为 [piece, score]）");
      const piece = e[0]; const score = e[1];
      this.scores.set(piece, score);
      if (!this.ids.has(piece)) this.ids.set(piece, i);
      if (piece.length > this.maxPieceLen) this.maxPieceLen = piece.length;
    }
    let minScore = Infinity;
    for (const sc of this.scores.values()) if (sc < minScore) minScore = sc;
    this.unkScore = minScore - 10.0;
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
      ops: artifact.serializeOps(this._ops),
      pt: this._pt
    };
  }
  _loadArtifact(loaded) {
    const h = loaded.header;
    const trie = loaded.trie;
    trie.rootMap = new Map();
    for (let c = trie.first[0]; c !== -1; c = trie.next[c]) trie.rootMap.set(trie.ch[c], c);
    this.modelType = h.modelType;
    this.unkId = h.unkId;
    this.unkScore = h.unkScore;
    this.vocabSize = h.vocabSize;
    this.maxPieceLen = h.maxPieceLen;
    this._ops = artifact.deserializeOps(h.ops);
    this._pt = h.pt;
    this.trie = trie;
    this.scores = null;
    this.ids = null;
    this._fromArtifact = true;
  }
  applyNormalizer(s) { return applyOps(this._ops, String(s)); }
  applyPreTokenizer(s) {
    if (!this._pt) return s;
    const rep = this._pt.replacement;
    let out = String(s).split(" ").join(rep);
    if (this._pt.scheme === "always" || (this._pt.scheme === "first" && !out.startsWith(rep))) out = rep + out;
    return out;
  }
  encode(text) { return tokenizeWithTrie(this.trie, this, text); }
  encodeBatch(texts) { return texts.map(t => this.encode(t)); }
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
}

const SHARED = new Map();

function sharedTokenizer(jsonPath, opts) {
  const o = opts || {};
  const key = path.resolve(jsonPath) + "|" + (o.cache === false ? "nocache" : "cache") + "|" + path.resolve(o.cacheDir || "");
  let inst = SHARED.get(key);
  if (!inst) { inst = new Tokenizer(jsonPath, o); SHARED.set(key, inst); }
  return inst;
}

export { Tokenizer, BUILDER_VER, sharedTokenizer };