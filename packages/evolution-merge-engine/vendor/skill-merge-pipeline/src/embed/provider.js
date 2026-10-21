"use strict";
// G4.2：embedder provider 契约（backend 白名单 + encode 方法契约）。
import { InvalidDataError } from "../errors.js";

const KNOWN_EMBED_BACKENDS = Object.freeze(["chain", "local", "remote", "onnx"]);

function assertKnownBackend(cfg) {
  const backend = String((cfg && cfg.embed_backend) || "local");
  if (!KNOWN_EMBED_BACKENDS.includes(backend)) {
    throw new InvalidDataError("未知 embed_backend: " + backend + "（可选: " + KNOWN_EMBED_BACKENDS.join("/") + "）", { where: "embed-provider" });
  }
  return backend;
}

function assertEmbedderContract(embedder) {
  if (!embedder || typeof embedder.encode !== "function") {
    throw new InvalidDataError("embedder 未实现 encode(texts)->number[][]", { where: "embed-provider" });
  }
  return embedder;
}

export { KNOWN_EMBED_BACKENDS, assertKnownBackend, assertEmbedderContract };