// G9-S2：冻结合并计划（MergePlan）；确定性 fallback + 一次定向修复。
import { cardDigest } from "./card.js";
import { validatePlan, MERGE_SCHEMA_VERSION } from "./schema.js";

const SYSTEM = "你是 skill 合并规划器（第 2 步：冻结合并计划）。只输出一个 JSON 对象，不要 markdown、不要解释。";

function sectionList(card) {
  const seen = new Map();
  const out = [{ id: "sec-overview", title: "Overview", level: 1, purpose: "合并后的技能概述（description/触发条件）" }];
  for (const s of [card.skills.a, card.skills.b]) {
    for (const u of s.units) {
      if (u.kind !== "section") continue;
      const key = u.heading.replace(/^#+\s*/, "").toLowerCase();
      if (!seen.has(key)) {
        const id = "sec-" + (seen.size + 1);
        seen.set(key, id);
        out.push({ id, title: u.heading.replace(/^#+\s*/, ""), level: u.level, purpose: "合并 " + s.name + " 的对应章节" });
      }
    }
  }
  return out;
}

function norm(t) { return String(t || "").replace(/\s+/g, " ").toLowerCase().trim(); }

export function deterministicPlan(card, s1) {
  const sections = sectionList(card);
  const byHeading = new Map();
  for (const sec of sections) byHeading.set(norm(sec.title), sec.id);
  const aText = new Map();
  for (const u of card.skills.a.units) if (u.kind === "section") aText.set(norm(u.text), u.uid);
  const dispositions = [];
  const conflicts = [];
  for (const u of card.skills.a.units) {
    const section = u.kind === "section" ? (byHeading.get(norm(u.heading.replace(/^#+\s*/, ""))) || sections[1].id) : sections[0].id;
    dispositions.push({ uid: "A:" + u.uid, action: "merge", section, reason: "目标侧内容" });
  }
  for (const u of card.skills.b.units) {
    const dup = u.kind === "section" ? aText.get(norm(u.text)) : null;
    if (dup) { dispositions.push({ uid: "B:" + u.uid, action: "drop", reason: "与 A:" + dup + " 内容重复" }); continue; }
    const secId = u.kind === "section" ? (byHeading.get(norm(u.heading.replace(/^#+\s*/, ""))) || sections[1].id) : sections[0].id;
    dispositions.push({ uid: "B:" + u.uid, action: "merge", section: secId, reason: "并入目标同名/相近章节并标注来源" });
    if (u.kind === "section") {
      const aSame = card.skills.a.units.find(x => x.kind === "section" && norm(x.heading) === norm(u.heading));
      if (aSame) conflicts.push({ uids: ["A:" + aSame.uid, "B:" + u.uid], resolution: "以目标技能版本为主，B 的独特内容并入同 section 并标注来源", reason: "同章节内容不同" });
    }
  }
  const support = [];
  for (const [tag, s] of [["a", card.skills.a], ["b", card.skills.b]]) {
    for (const f of s.support_files) support.push({ file: f, link_section: sections[0].id, action: "move-and-link", reason: "支撑文件随来源迁移并保留链接（原子对）" });
  }
  const sum = card.skills.a.chars + card.skills.b.chars;
  const budget = Math.max(1, Math.min(sum, Math.floor(sum * 0.8)));
  const nominationMode = s1.executor === "consolidate-reference" ? "reference" : "append";
  return {
    schemaVersion: MERGE_SCHEMA_VERSION,
    pair: { a: card.pair.a, b: card.pair.b },
    relation: s1.relation, mode: s1.mode || "merge-into-existing", executor: s1.executor,
    nomination: { target: s1.target || card.pair.a, sources: s1.sources && s1.sources.length ? s1.sources : [card.pair.a === s1.target ? card.pair.b : card.pair.a], mode: nominationMode, reason: s1.rationale || "确定性计划" },
    content: {
      target_sections: sections,
      unit_dispositions: dispositions,
      conflicts,
      field_ownership: [
        { field: "description", action: "merge", source: "a+b", reason: "两条描述的触发条件与能力合并，消除重复措辞" },
        { field: "workflow", action: "merge", source: "a+b", reason: "按 section 合并流程，保留独特步骤" },
        { field: "constraints", action: "merge", source: "a+b", reason: "约束取并集，冲突处标注来源" }
      ],
      atomic_pairs: support,
      budget: { max_chars: budget }
    },
    changelog: ["合并 " + card.pair.a + " + " + card.pair.b, "逐 U-ID 处置已在 unit_dispositions 中列明"],
    rationale: "确定性 fallback 计划（LLM 不可用或输出不合法时）"
  };
}

function planPrompt(card, s1) {
  const digest = cardDigest(card, 320);
  const ids = [];
  for (const u of card.skills.a.units) ids.push("A:" + u.uid);
  for (const u of card.skills.b.units) ids.push("B:" + u.uid);
  const sum = card.skills.a.chars + card.skills.b.chars;
  return [
    "输入：两条被判 MERGE 的 skill 摘要（JSON）+ 第 1 步分类结果。",
    "第 1 步结果：" + JSON.stringify(s1),
    "约束：",
    "1) 必须为以下每个 U-ID 恰好给一个 disposition（action: merge|move|drop|keep；merge/move 需 section；drop 必须 reason）：" + ids.join(","),
    "2) target_sections 必须先定义，id 形如 sec-x；disposition.section 必须引用其中 id。",
    "3) 冲突（同章节内容不同/语义相反）必须写入 conflicts 并给出 resolution，不允许留待定。",
    "4) 支撑文件（references/templates/scripts/assets）与 SKILL.md 中的链接是原子对，写入 atomic_pairs。",
    "5) content.budget.max_chars 必须 >0 且 ≤ 两技能总字符数 " + sum + "（建议 60%~80%：" + Math.floor(sum * 0.8) + "）。",
    "6) executor 沿用第 1 步；nomination.mode 只能是 append 或 reference。",
    "输出务必精简：每个 disposition 的 reason ≤40 字；changelog ≤6 条；不要输出解释或 markdown。",
    "输出 JSON schema：{\"schemaVersion\":1,\"pair\":{...},\"relation\":...,\"mode\":...,\"executor\":...,\"nomination\":{\"target\":...,\"sources\":[...],\"mode\":\"append\"|\"reference\",\"reason\":...},\"content\":{\"target_sections\":[...],\"unit_dispositions\":[...],\"conflicts\":[...],\"field_ownership\":[...],\"atomic_pairs\":[...],\"budget\":{\"max_chars\":N}},\"changelog\":[...],\"rationale\":...}",
    "输入 JSON：" + JSON.stringify(digest)
  ].join("\n");
}

function repairPrompt(card, s1, plan, problems) {
  return [
    "你上一步输出的合并计划未通过机械校验。请只修复问题，输出完整 JSON（不要解释）。",
    "校验问题：" + JSON.stringify(problems.slice(0, 10)),
    "当前计划：" + JSON.stringify(plan).slice(0, 12000),
    "第 1 步结果：" + JSON.stringify(s1),
    "必须保持每个 U-ID 恰好处置一次；section 必须先定义；drop 需理由；budget≤两技能总字符。",
  ].join("\n");
}

export async function planMerge(card, s1, llm) {
  if (!llm || !llm.available) {
    const plan = deterministicPlan(card, s1);
    const problems = validatePlan(plan, card);
    return { plan, source: "fallback", problems };
  }
  try {
    const raw = await llm.callJson(SYSTEM, planPrompt(card, s1), { maxTokens: 8000 });
    const plan = Object.assign({}, raw, { schemaVersion: MERGE_SCHEMA_VERSION, pair: { a: card.pair.a, b: card.pair.b } });
    let problems = validatePlan(plan, card);
    if (!problems.length) return { plan, source: "llm", problems };
    const fixed = await llm.callJson(SYSTEM, repairPrompt(card, s1, plan, problems), { maxTokens: 8000 });
    const plan2 = Object.assign({}, fixed, { schemaVersion: MERGE_SCHEMA_VERSION, pair: { a: card.pair.a, b: card.pair.b } });
    problems = validatePlan(plan2, card);
    if (!problems.length) return { plan: plan2, source: "llm-repair", problems: [] };
    return { plan: deterministicPlan(card, s1), source: "fallback-validation", problems, llmProblems: problems };
  } catch (err) {
    return { plan: deterministicPlan(card, s1), source: "fallback-error", problems: [], error: String(err && err.message ? err.message : err) };
  }
}