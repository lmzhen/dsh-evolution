"use strict";
// G5.3：LLM verdict JSON 解析（从 cascade 抽出，供 provider/cascade 共用）。
function parseVerdict(raw) {
  let t = String(raw).trim();
  if (t.startsWith("```")) { t = t.replace(/`/g, ""); const idx = t.indexOf("\n"); if (idx >= 0) t = t.slice(idx + 1); }
  let obj;
  try { obj = JSON.parse(t); } catch (e) {
    const m = /\{[\s\S]*\}/.exec(t);
    if (!m) throw e;
    obj = JSON.parse(m[0]);
  }
  const v = obj.verdict;
  obj.verdict = (String(v).trim() === "1" || String(v).trim() === "0" || String(v).trim() === "-1") ? parseInt(v, 10) : 0;
  return obj;
}
export { parseVerdict };