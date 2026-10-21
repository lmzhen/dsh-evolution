// C7：MergeDecision / MergePlan v1 契约（形状校验；G9 卡级校验在 merge/schema.js）。
const MERGE_SCHEMA_VERSION = 1;
const RELATIONS = Object.freeze(["duplicate", "complement", "conflict", "subsumption", "specialization"]);
const MODES = Object.freeze(["merge-into-existing", "create-umbrella", "demote-to-reference", "reference-only", "keep"]);
const EXECUTORS = Object.freeze(["consolidate-append", "consolidate-reference", "agent-distill", "keep"]);
const NOMINATION_MODES = Object.freeze(["append", "reference"]);
const DISPOSITIONS = Object.freeze(["merge", "move", "drop", "keep"]);
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const ABS_PATH_RE = /^(?:[A-Za-z]:[\\/]|[\\/])/;
const TEMP_PATH_RE = /^(?:\.?\.?[\\/])?(?:tmp|temp)(?:[\\/]|$)/i;
const DOTDOT_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function badPath(p) { return String(p || "").trim(); }
function unsafePath(p) {
  const s = badPath(p);
  if (!s) return false;
  return ABS_PATH_RE.test(s) || DOTDOT_RE.test(s) || TEMP_PATH_RE.test(s);
}

function emptyPlan(pair) {
  return { schemaVersion: MERGE_SCHEMA_VERSION, pair: { a: pair && pair.a, b: pair && pair.b }, relation: null, executor: null, nomination: null, content: null, rationale: "", changelog: [] };
}

function validateMergeDecision(decision) {
  const problems = [];
  if (!isObject(decision)) return ["decision 不是对象"];
  if (!RELATIONS.includes(decision.relation)) problems.push("relation 非法: " + decision.relation);
  if (!MODES.includes(decision.mode)) problems.push("mode 非法: " + decision.mode);
  if (!EXECUTORS.includes(decision.executor)) problems.push("executor 非法: " + decision.executor);
  if (!NAME_RE.test(String(decision.target || ""))) problems.push("target 非法: " + decision.target);
  if (!Array.isArray(decision.sources) || !decision.sources.length) problems.push("sources 为空");
  if (!String(decision.rationale || "").trim()) problems.push("rationale 为空");
  if (!Number.isFinite(Number(decision.confidence)) || Number(decision.confidence) < 0 || Number(decision.confidence) > 1) problems.push("confidence 必须在 [0,1]");
  return problems;
}

function validateMergePlanShape(plan) {
  const problems = [];
  if (!isObject(plan)) return ["plan 不是对象"];
  if (plan.schemaVersion !== MERGE_SCHEMA_VERSION) problems.push("schemaVersion 非 " + MERGE_SCHEMA_VERSION);
  if (!isObject(plan.pair) || typeof plan.pair.a !== "string" || typeof plan.pair.b !== "string" || !plan.pair.a || !plan.pair.b) problems.push("pair 必须包含非空 a/b");
  if (!RELATIONS.includes(plan.relation)) problems.push("relation 非法: " + plan.relation);
  if (!MODES.includes(plan.mode)) problems.push("mode 非法: " + plan.mode);
  if (!EXECUTORS.includes(plan.executor)) problems.push("executor 非法: " + plan.executor);
  if (!Array.isArray(plan.changelog)) problems.push("changelog 必须是数组");
  const nom = plan.nomination || {};
  if (plan.executor !== "keep") {
    if (!nom.target || !NAME_RE.test(String(nom.target))) problems.push("nomination.target 非法: " + nom.target);
    if (!Array.isArray(nom.sources) || !nom.sources.length) problems.push("nomination.sources 为空");
    if (!String(nom.reason || "").trim()) problems.push("nomination.reason 为空");
    if (!NOMINATION_MODES.includes(nom.mode)) problems.push("nomination.mode 非法: " + nom.mode);
    if (Array.isArray(nom.sources) && nom.sources.includes(nom.target)) problems.push("nomination.target 不能同时是 source");
  }
  const content = plan.content || {};
  const pairs = Array.isArray(content.atomic_pairs) ? content.atomic_pairs : [];
  for (const p of pairs) {
    if (!p || typeof p.file !== "string") { problems.push("atomic_pairs.file 必须是字符串"); continue; }
    if (unsafePath(p.file)) problems.push("atomic_pairs.file 必须是安全相对路径: " + p.file);
  }
  return problems;
}

export { MERGE_SCHEMA_VERSION, RELATIONS, MODES, EXECUTORS, NOMINATION_MODES, DISPOSITIONS, NAME_RE, emptyPlan, validateMergeDecision, validateMergePlanShape, unsafePath };