// G9：MergeCard / MergePlan 契约（S0–S2）。C7 形状契约在 src/contracts/merge.js，G9 卡级校验在本文件。
import {
  MERGE_SCHEMA_VERSION, RELATIONS, MODES, EXECUTORS, NOMINATION_MODES, DISPOSITIONS, NAME_RE,
  emptyPlan as contractEmptyPlan, validateMergePlanShape
} from "../contracts/merge.js";

export { MERGE_SCHEMA_VERSION, RELATIONS, MODES, EXECUTORS, NOMINATION_MODES, DISPOSITIONS, NAME_RE };

const PLACEHOLDER_RE = /(?:TODO|TBD|FIXME|XXX+|lorem ipsum|placeholder|待补|待定|占位)/i;

function planTexts(plan) {
  const c = plan.content || {};
  const out = [plan.rationale, ...(plan.changelog || []), (plan.nomination || {}).reason];
  for (const s of c.target_sections || []) { out.push(s.title, s.purpose); }
  for (const d of c.unit_dispositions || []) out.push(d.reason);
  for (const p of c.atomic_pairs || []) out.push(p.reason);
  for (const f of c.field_ownership || []) out.push(f.reason);
  return out.filter(x => typeof x === "string");
}

export function emptyPlan(pair) {
  return contractEmptyPlan(pair || {});
}

export function validatePlan(plan, card) {
  const problems = validateMergePlanShape(plan);
  if (!plan || typeof plan !== "object") return problems;
  if (plan.schemaVersion !== MERGE_SCHEMA_VERSION) problems.push("schemaVersion 非 " + MERGE_SCHEMA_VERSION);
  if (!plan.pair || plan.pair.a !== card.pair.a || plan.pair.b !== card.pair.b) problems.push("pair 与卡片不一致");
  if (!RELATIONS.includes(plan.relation)) problems.push("relation 非法: " + plan.relation);
  if (!EXECUTORS.includes(plan.executor)) problems.push("executor 非法: " + plan.executor);
  const nom = plan.nomination || {};
  if (!MODES.includes(plan.mode)) problems.push("mode 非法: " + plan.mode);
  if (plan.executor !== "keep") {
    if (!nom.target || !NAME_RE.test(String(nom.target))) problems.push("nomination.target 非法: " + nom.target);
    if (!Array.isArray(nom.sources) || !nom.sources.length) problems.push("nomination.sources 为空");
    if (!String(nom.reason || "").trim()) problems.push("nomination.reason 为空");
    if (!NOMINATION_MODES.includes(nom.mode)) problems.push("nomination.mode 非法: " + nom.mode);
    if (nom.sources && nom.sources.includes(nom.target)) problems.push("nomination.target 不能同时是 source");
  }
  const aSupport = card.skills.a.support_files || [];
  const bSupport = card.skills.b.support_files || [];
  if (plan.executor === "consolidate-append") {
    if (aSupport.length || bSupport.length) problems.push("append 执行器不接受带支撑文件的来源（应改 reference 或 agent-distill）");
    if (nom.mode !== "append") problems.push("executor=consolidate-append 时 nomination.mode 应为 append");
  }
  if (plan.executor === "consolidate-reference" && nom.mode !== "reference") problems.push("executor=consolidate-reference 时 nomination.mode 应为 reference");
  if (plan.executor === "agent-distill") {
    const c = plan.content || {};
    if (!Array.isArray(c.target_sections) || !c.target_sections.length) problems.push("agent-distill 缺少 target_sections");
    if (!Array.isArray(c.unit_dispositions)) problems.push("agent-distill 缺少 unit_dispositions");
  }
  const ids = [];
  for (const s of (card.skills.a.units || [])) ids.push("A:" + s.uid);
  for (const s of (card.skills.b.units || [])) ids.push("B:" + s.uid);
  const got = new Map();
  const targetSections = (plan.content || {}).target_sections || [];
  const sectionIds = targetSections.map(s => String(s.id || ""));
  if (new Set(sectionIds).size !== sectionIds.length) problems.push("target_sections.id 重复");
  const sections = new Set(sectionIds);
  const dispositions = (plan.content || {}).unit_dispositions || [];
  for (const d of dispositions) {
    const key = String(d.uid || "");
    if (got.has(key)) problems.push("U-ID 重复处置: " + key);
    got.set(key, d);
    if (!DISPOSITIONS.includes(d.action)) problems.push("disposition 非法: " + key + " " + d.action);
    if ((d.action === "merge" || d.action === "move") && (!d.section || !sections.has(d.section))) problems.push("处置指向不存在章节: " + key + " → " + d.section);
    if (d.action === "drop" && !String(d.reason || "").trim()) problems.push("drop 缺理由: " + key);
  }
  if (dispositions.length && dispositions.every(d => d.action === "drop")) problems.push("源内容存活失败：所有 U-ID 都被 drop");
  const missing = ids.filter(id => !got.has(id));
  const extra = [...got.keys()].filter(id => !ids.includes(id));
  if (missing.length) problems.push("覆盖缺口（未处置 U-ID）: " + missing.slice(0, 8).join(",") + (missing.length > 8 ? " …" : ""));
  if (extra.length) problems.push("处置了不存在的 U-ID: " + extra.slice(0, 8).join(","));
  const budget = ((plan.content || {}).budget || {}).max_chars;
  if (!Number.isInteger(Number(budget)) || Number(budget) <= 0) problems.push("content.budget.max_chars 必须是正整数");
  const sum = (card.skills.a.chars || 0) + (card.skills.b.chars || 0);
  if (Number(budget) > sum) problems.push("预算大于两技能总字符数（" + budget + " > " + sum + "）");
  const supportSet = new Set([...aSupport, ...bSupport]);
  for (const p of ((plan.content || {}).atomic_pairs || [])) {
    if (!p || typeof p.file !== "string") continue;
    if (p.link_section !== undefined) { if (!sections.has(p.link_section)) problems.push("引用目标章节不存在: " + p.file); }
    else if (supportSet.size) problems.push("引用缺 link_section（成对失效）: " + p.file);
    if (supportSet.size && !supportSet.has(p.file)) problems.push("引用文件不在来源 support_files: " + p.file);
  }
  for (const text of planTexts(plan)) if (PLACEHOLDER_RE.test(text)) problems.push("计划含占位符: " + text.slice(0, 60));
  return problems;
}
