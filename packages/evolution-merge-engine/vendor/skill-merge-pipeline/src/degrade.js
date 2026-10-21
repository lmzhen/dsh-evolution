"use strict";
// G5.4：统一降级/启发式路径状态机；report、stdout、strict 共用。

function stageStats(res, id) {
  const s = (res && res.stages || []).find(x => x.id === id);
  return s ? (s.stats || {}) : {};
}

function assessDegradation(opts) {
  const o = opts || {};
  const res = o.res || {};
  const reasons = [];
  const seen = new Set();
  function add(code, stage, detail) {
    const c = String(code || "degraded");
    if (seen.has(c + "|" + stage)) return;
    seen.add(c + "|" + stage);
    reasons.push({ code: c, stage: stage || "unknown", detail: String(detail || "") });
  }
  const sem = stageStats(res, "semantic");
  if (sem.embedder_degraded) add(sem.embedder_reason || "embedder-degraded", "semantic", "embedder 链降级");
  const rank = stageStats(res, "rerank");
  if (rank.degraded) add(rank.reason_code || "rank-degraded", "rerank", rank.reason || "精排降级");
  if (rank.mode_used === "vec") add("rank-vec", "rerank", "④.5 使用向量口径（非真实精排）");
  if (rank.mode_used === "local_partial") add("rank-partial", "rerank", "④.5 部分行向量补位");
  if (rank.mode_used === "api_partial") add("rank-api-partial", "rerank", "④.5 API 部分失败回退");
  const judge = stageStats(res, "judge");
  if (judge.judge_auto_fallback) add("judge-auto-fallback", "judge", "auto 无 key 退化为 stub");
  if (judge.judge_mode === "stub" || judge.judge_mode === "stub2") add("judge-" + judge.judge_mode, "judge", "⑤ 使用启发式判决");
  if (Number(judge.errors || 0) > 0) add("judge-errors", "judge", judge.errors + " 行判决失败");
  for (const t of res.timings || []) if (t.degraded) add("stage-degraded", t.id, "stage 降级");
  const attempts = Array.isArray(rank.attempts) ? rank.attempts.slice(0, 50) : [];
  return {
    degraded: reasons.length > 0,
    reason_code: reasons.length ? reasons[0].code : null,
    reasons,
    attempts
  };
}

export { assessDegradation };