// G9-S1：关系分类 + 执行器/模式选择（LLM 小调用；确定性 fallback）。
import { cardDigest } from "./card.js";
import { EXECUTORS, MODES, RELATIONS } from "./schema.js";
import { validateMergeDecision } from "../contracts/merge.js";

const SYSTEM = "你是 skill 合并规划器（第 1 步：关系分类与执行器选择）。只输出一个 JSON 对象，不要 markdown、不要解释。";

export function deterministicClassify(card) {
  if (!card.compat.both_found) return { relation: "complement", mode: "keep", executor: "keep", target: card.pair.a, sources: [card.pair.b || card.pair.a], rationale: "语料缺技能，保留待人工", confidence: 0 };
  const s = card.pair.scores || {};
  const aSupport = card.skills.a.support_files || [];
  const bSupport = card.skills.b.support_files || [];
  const hasSupport = aSupport.length > 0 || bSupport.length > 0;
  let relation = "complement";
  const js = Number(s.jaccard_summary || 0);
  const cos = Number(s.summary_cosine || 0);
  if (js >= 0.5) relation = "duplicate";
  else if (cos >= 0.9) relation = "duplicate";
  else if (Number(s.jaccard_body || 0) >= 0.35) relation = "complement";
  const a = card.skills.a, b = card.skills.b;
  const target = (a.chars || 0) >= (b.chars || 0) ? a.name : b.name;
  const source = target === a.name ? b.name : a.name;
  let executor = "agent-distill";
  if (hasSupport) executor = "consolidate-reference";
  else if (relation === "duplicate") executor = "consolidate-append";
  const mode = executor === "consolidate-reference" ? "merge-into-existing" : (executor === "consolidate-append" ? "merge-into-existing" : "merge-into-existing");
  return { relation, mode, executor, target, sources: [source], rationale: "确定性 fallback：按词面/余弦与支撑文件判定", confidence: 0.2 };
}

export async function classifyMerge(card, llm) {
  if (!llm || !llm.available) return { result: deterministicClassify(card), source: "fallback" };
  const digest = cardDigest(card, 120);
  const user = [
    "输入是两条已被判为 MERGE 的 skill 摘要与证据（JSON）。",
    "可选 relation: " + RELATIONS.join(" | "),
    "可选 mode: " + MODES.join(" | "),
    "可选 executor: " + EXECUTORS.join(" | "),
    "规则：duplicate/subsumption 且双方无支撑文件→consolidate-append；有支撑文件→consolidate-reference；complement/conflict/需要蒸馏去叙事→agent-distill；无法安全合并→keep。",
    "输出 JSON: {\"relation\":..., \"mode\":..., \"executor\":..., \"target\":\"kebab-case 目标技能名\", \"sources\":[源技能名], \"rationale\":\"≤120字\", \"confidence\":0..1}",
    JSON.stringify(digest)
  ].join("\n");
  try {
    const raw = await llm.callJson(SYSTEM, user, { maxTokens: 600 });
    const r = {
      relation: raw.relation, mode: raw.mode, executor: raw.executor,
      target: String(raw.target || "").trim(), sources: Array.isArray(raw.sources) ? raw.sources : [],
      rationale: String(raw.rationale || "").slice(0, 300), confidence: Number(raw.confidence || 0)
    };
    if (validateMergeDecision(r).length) {
      return { result: deterministicClassify(card), source: "fallback-invalid", raw: r };
    }
    return { result: r, source: "llm", raw };
  } catch (err) {
    return { result: deterministicClassify(card), source: "fallback-error", error: String(err && err.message ? err.message : err) };
  }
}