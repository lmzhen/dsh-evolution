"use strict";
// C8：models/registry.json 严格校验、路径解析与产物校验（G2 属主 artifacts；models/tiers/calibration 归 G4）。
import path from "node:path";
import { readJson, hashFile, fileMeta } from "../io/read.js";
import { InvalidDataError } from "../errors.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REGISTRY_SCHEMA_VERSION = 1;
const KIND = new Set(["source", "derived"]);
const ORIGIN = new Set(["hf", "repo"]);
const DTYPES = new Set(["F32", "F16", "I8"]);
const TOP_KEYS = new Set(["schemaVersion", "modelsRoot", "recipes", "artifacts", "models", "tiers", "calibration"]);
const ART_KEYS = new Set(["id", "kind", "origin", "repo", "target", "files", "recipe", "base", "proj", "manifest", "description", "optional"]);
const FILE_KEYS = new Set(["path", "sha256", "bytes", "lfs"]);
const MANIFEST_KEYS = new Set(["dtype", "dim", "rows", "tokenizerSha", "builderVer", "scalesDtype", "projSha", "reproducibility"]);
const REPRODUCIBILITY = new Set(["bytes", "numeric"]);
const RECIPE_KEYS = new Set(["builderVer", "description", "params"]);
const CALIBRATION_KEYS = new Set(["version", "samplesSha", "n", "quantile", "margin", "floors", "generatedAt"]);
const MODEL_KEYS = new Set(["id", "provider", "compute", "overrideField", "artifactRef", "tokenizerRef", "limits", "floors", "transport", "price"]);
const TIER_KEYS = new Set(["id", "modelRef", "floorPreset"]);
const COMPUTE = new Set(["api", "local-static"]);
const SHA_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

function bad(msg) { return new InvalidDataError("registry: " + msg, { where: "models/registry.json" }); }
function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function unknownKeys(obj, allowed, ctx) { for (const k of Object.keys(obj)) if (!allowed.has(k)) throw bad("未知字段 " + ctx + "." + k); }
function relSafe(p) { return typeof p === "string" && p.length > 0 && !path.isAbsolute(p) && !p.split(/[\\/]/).includes(".."); }
function assertSha(v, ctx) { if (typeof v !== "string" || !SHA_RE.test(v)) throw bad("sha256 非法: " + ctx); }
function assertPosInt(v, ctx) { if (!Number.isInteger(v) || v <= 0) throw bad("必须为正整数: " + ctx); }

function validateFiles(files, ctx) {
  if (!Array.isArray(files) || !files.length) throw bad(ctx + ".files 必须是非空数组");
  const seen = new Set();
  for (const f of files) {
    if (!isObj(f)) throw bad(ctx + ".files 元素必须是对象");
    unknownKeys(f, FILE_KEYS, ctx + ".files[]");
    if (!relSafe(f.path)) throw bad(ctx + ".files[].path 必须是相对路径且不含 ..");
    if (seen.has(f.path)) throw bad(ctx + ".files 路径重复: " + f.path);
    seen.add(f.path);
    assertSha(f.sha256, ctx + ".files[" + f.path + "].sha256");
    assertPosInt(f.bytes, ctx + ".files[" + f.path + "].bytes");
    if (f.lfs !== undefined && typeof f.lfs !== "boolean") throw bad(ctx + ".files[].lfs 必须是布尔");
  }
}

function validateManifest(m, ctx) {
  if (!isObj(m)) throw bad(ctx + ".manifest 必须是对象");
  unknownKeys(m, MANIFEST_KEYS, ctx + ".manifest");
  if (!DTYPES.has(m.dtype)) throw bad(ctx + ".manifest.dtype 非法: " + m.dtype);
  assertPosInt(m.dim, ctx + ".manifest.dim");
  assertPosInt(m.rows, ctx + ".manifest.rows");
  assertSha(m.tokenizerSha, ctx + ".manifest.tokenizerSha");
  assertPosInt(m.builderVer, ctx + ".manifest.builderVer");
  if (m.scalesDtype !== undefined && !DTYPES.has(m.scalesDtype)) throw bad(ctx + ".manifest.scalesDtype 非法");
  if (m.projSha !== undefined) assertSha(m.projSha, ctx + ".manifest.projSha");
  if (m.reproducibility !== undefined && !REPRODUCIBILITY.has(m.reproducibility)) throw bad(ctx + ".manifest.reproducibility 非法");
}

function validateRecipes(recipes) {
  if (!isObj(recipes) || !Object.keys(recipes).length) throw bad("recipes 必须是非空对象");
  for (const [id, r] of Object.entries(recipes)) {
    if (!isObj(r)) throw bad("recipes." + id + " 必须是对象");
    unknownKeys(r, RECIPE_KEYS, "recipes." + id);
    assertPosInt(r.builderVer, "recipes." + id + ".builderVer");
    if (r.description !== undefined && typeof r.description !== "string") throw bad("recipes." + id + ".description 必须是字符串");
    if (r.params !== undefined && !isObj(r.params)) throw bad("recipes." + id + ".params 必须是对象");
  }
}

function validateFloors(floors, ctx) {
  if (!isObj(floors)) throw bad(ctx + ".floors 必须是对象");
  for (const k of ["body", "summary"]) if (typeof floors[k] !== "number" || !Number.isFinite(floors[k])) throw bad(ctx + ".floors." + k + " 必须是有限数");
}

function validateCalibration(cal, tierIds) {
  if (cal === null || cal === undefined) return;
  if (!isObj(cal)) throw bad("calibration 必须是对象或 null");
  unknownKeys(cal, CALIBRATION_KEYS, "calibration");
  if (!Number.isInteger(cal.version) || cal.version < 1) throw bad("calibration.version 必须是正整数");
  assertSha(cal.samplesSha, "calibration.samplesSha");
  if (!Number.isInteger(cal.n) || cal.n <= 0) throw bad("calibration.n 必须是正整数");
  if (cal.quantile !== undefined && typeof cal.quantile !== "number") throw bad("calibration.quantile 必须是数值");
  if (cal.margin !== undefined && typeof cal.margin !== "number") throw bad("calibration.margin 必须是数值");
  if (!isObj(cal.floors) || !Object.keys(cal.floors).length) throw bad("calibration.floors 必须是非空对象");
  for (const [k, v] of Object.entries(cal.floors)) {
    if (!tierIds.has(k)) throw bad("calibration.floors 未知 tier: " + k);
    validateFloors(v, "calibration.floors." + k);
  }
}

function validateModelsTiers(reg) {
  if (!Array.isArray(reg.models)) throw bad("models 必须是数组（G4 分区）");
  if (!Array.isArray(reg.tiers)) throw bad("tiers 必须是数组（G4 分区）");
  const ids = new Set();
  for (const m of reg.models) {
    if (!isObj(m)) throw bad("models 元素必须是对象");
    unknownKeys(m, MODEL_KEYS, "models[]");
    if (typeof m.id !== "string" || !m.id) throw bad("models[].id 非法");
    if (ids.has(m.id)) throw bad("models[].id 重复: " + m.id);
    ids.add(m.id);
    if (typeof m.provider !== "string" || !m.provider) throw bad(m.id + ".provider 缺失");
    if (!COMPUTE.has(m.compute)) throw bad(m.id + ".compute 非法: " + m.compute);
    if (typeof m.overrideField !== "string" || !m.overrideField) throw bad(m.id + ".overrideField 缺失");
    validateFloors(m.floors, m.id);
    if (m.compute === "api") {
      if (!isObj(m.transport) || m.transport.kind !== "openai-embeddings" || typeof m.transport.model !== "string" || !m.transport.model) throw bad(m.id + ".transport 非法（api 需 kind=openai-embeddings + model）");
    } else if (m.artifactRef !== undefined) {
      if (typeof m.artifactRef !== "string" || !reg.artifacts.some(a => a.id === m.artifactRef)) throw bad(m.id + ".artifactRef 不存在: " + m.artifactRef);
    }
  }
  const tierIds = new Set();
  for (const t of reg.tiers) {
    if (!isObj(t)) throw bad("tiers 元素必须是对象");
    unknownKeys(t, TIER_KEYS, "tiers[]");
    if (typeof t.id !== "string" || !t.id) throw bad("tiers[].id 非法");
    if (tierIds.has(t.id)) throw bad("tiers[].id 重复: " + t.id);
    tierIds.add(t.id);
    if (typeof t.modelRef !== "string" || !ids.has(t.modelRef)) throw bad(t.id + ".modelRef 不存在: " + t.modelRef);
    if (typeof t.floorPreset !== "string" || !t.floorPreset) throw bad(t.id + ".floorPreset 缺失");
  }
  validateCalibration(reg.calibration, tierIds);
}

function validateRegistry(reg) {
  if (!isObj(reg)) throw bad("顶层必须是对象");
  unknownKeys(reg, TOP_KEYS, "$");
  if (reg.schemaVersion !== REGISTRY_SCHEMA_VERSION) throw bad("schemaVersion 必须为 " + REGISTRY_SCHEMA_VERSION);
  if (typeof reg.modelsRoot !== "string" || !relSafe(reg.modelsRoot)) throw bad("modelsRoot 必须是相对路径且不含 ..");
  validateRecipes(reg.recipes);
  if (!Array.isArray(reg.artifacts) || !reg.artifacts.length) throw bad("artifacts 必须是非空数组");
  const ids = new Set();
  for (const a of reg.artifacts) {
    if (!isObj(a)) throw bad("artifacts 元素必须是对象");
    unknownKeys(a, ART_KEYS, "artifacts[]");
    if (typeof a.id !== "string" || !ID_RE.test(a.id)) throw bad("artifact.id 非法: " + a.id);
    if (ids.has(a.id)) throw bad("artifact.id 重复: " + a.id);
    ids.add(a.id);
    if (!KIND.has(a.kind)) throw bad(a.id + ".kind 非法: " + a.kind);
    if (!relSafe(a.target)) throw bad(a.id + ".target 必须是相对路径且不含 ..");
    validateFiles(a.files, a.id);
    if (a.optional !== undefined && typeof a.optional !== "boolean") throw bad(a.id + ".optional 必须是布尔");
    if (a.kind === "source") {
      if (!ORIGIN.has(a.origin)) throw bad(a.id + ".origin 必须为 hf|repo");
      if (a.origin === "hf" && (typeof a.repo !== "string" || !a.repo)) throw bad(a.id + ".repo 缺失（origin=hf）");
      if (a.origin === "repo" && a.repo !== undefined) throw bad(a.id + ".repo 不应出现在 origin=repo");
      if (a.recipe !== undefined || a.base !== undefined || a.proj !== undefined || a.manifest !== undefined) throw bad(a.id + ": source 不应带 recipe/base/proj/manifest");
    } else {
      if (typeof a.recipe !== "string" || !Object.prototype.hasOwnProperty.call(reg.recipes, a.recipe)) throw bad(a.id + ".recipe 未定义: " + a.recipe);
      if (typeof a.base !== "string" || !a.base) throw bad(a.id + ".base 缺失");
      if (a.origin !== undefined || a.repo !== undefined) throw bad(a.id + ": derived 不应带 origin/repo");
      validateManifest(a.manifest, a.id);
      if (a.proj !== undefined && (typeof a.proj !== "string" || !a.proj)) throw bad(a.id + ".proj 非法");
    }
  }
  for (const a of reg.artifacts) {
    if (a.kind !== "derived") continue;
    if (!ids.has(a.base)) throw bad(a.id + ".base 不存在: " + a.base);
    if (a.proj !== undefined && !ids.has(a.proj)) throw bad(a.id + ".proj 不存在: " + a.proj);
  }
  validateModelsTiers(reg);

  if (reg.calibration !== undefined && reg.calibration !== null && !isObj(reg.calibration)) throw bad("calibration 必须是对象或 null（G4 分区）");
  return reg;
}

function defaultRegistryPath() { return path.join(__dirname, "..", "..", "models", "registry.json"); }

function loadRegistry(file) {
  const f = file || defaultRegistryPath();
  const reg = readJson(f);
  return { file: f, registry: validateRegistry(reg) };
}

function modelsRootOf(registry, registryFile, override) {
  const base = override || process.env.SKILL_MERGE_MODELS_ROOT;
  if (base) return path.resolve(base);
  return path.resolve(path.dirname(registryFile || defaultRegistryPath()), "..", registry.modelsRoot);
}

function artifactById(registry, id) {
  const a = registry.artifacts.find(x => x.id === id);
  if (!a) throw bad("未知 artifact: " + id);
  return a;
}

function artifactDir(registry, registryFile, id, override) {
  const a = artifactById(registry, id);
  const rootDir = modelsRootOf(registry, registryFile, override);
  const dir = path.resolve(rootDir, a.target);
  const prefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (dir !== rootDir && !dir.startsWith(prefix)) throw bad("artifact 路径越界: " + id);
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
    const abs = path.join(dir, f.path);
    const meta = fileMeta(abs);
    if (!meta.exists) { missing.push(f.path); continue; }
    if (meta.bytes !== f.bytes) { mismatched.push({ path: f.path, reason: "size", expected: f.bytes, actual: meta.bytes }); continue; }
    if (o.hash !== false && !numeric) {
      const h = hashFile(abs);
      if (h !== f.sha256) mismatched.push({ path: f.path, reason: "sha256" });
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, id, dir, missing, mismatched };
}

export { REGISTRY_SCHEMA_VERSION, validateRegistry, loadRegistry, defaultRegistryPath, modelsRootOf, artifactById, artifactDir, verifyArtifact, validateCalibration };