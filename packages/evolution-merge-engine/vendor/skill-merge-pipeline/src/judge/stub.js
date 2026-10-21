"use strict";
// G5.3：stub 判决。stub-v1 冻结为 parity oracle（魔数是验收基线，禁止随手调）；stub-v2 地板驱动仅 opt-in。
const STUB_VERSION = "stub-v1";
const STUB2_VERSION = "stub-v2";
// >>> ORACLE 冻结常量（改这里会摧毁 ⑤ 判决分布 3/0/14 的 parity 基线，必须配新 golden）
const V1 = Object.freeze({
  l0: Object.freeze({ merge: 0.6, forward: 0.45 }),
  l1: Object.freeze({ merge: 0.95, forward: 0.9 }),
  l2: Object.freeze({ merge: 0.94 })
});
// <<< ORACLE 冻结常量
const DEFAULT_STUB2_FLOORS = Object.freeze({ body: 0.95, summary: 0.6 });

function scoreFor(level, evidence) {
  const body = evidence.body_cosine;
  const summ = evidence.summary_cosine;
  if (level === "L0") return summ !== undefined && summ !== null ? summ : (evidence.jaccard_summary || 0);
  return body !== undefined && body !== null ? body : 0;
}

function stubVerdict(level, evidence) {
  const s = scoreFor(level, evidence);
  let v;
  if (level === "L0") v = s >= V1.l0.merge ? 1 : (s >= V1.l0.forward ? 0 : -1);
  else if (level === "L1") v = s >= V1.l1.merge ? 1 : (s >= V1.l1.forward ? 0 : -1);
  else v = s >= V1.l2.merge ? 1 : -1;
  return { verdict: v, reason: "stub(启发式): score=" + Number(s).toFixed(3), evidence: [] };
}

function stubVerdictV2(level, evidence, floors) {
  const f = Object.assign({}, DEFAULT_STUB2_FLOORS, floors || {});
  const s = scoreFor(level, evidence);
  const th = level === "L0" ? f.summary : f.body;
  let v;
  if (level === "L2") v = s >= th ? 1 : -1;
  else v = s >= th ? 1 : 0;
  return { verdict: v, reason: "stub2(地板驱动): score=" + Number(s).toFixed(3) + " floor=" + Number(th).toFixed(3), evidence: [] };
}

export { STUB_VERSION, STUB2_VERSION, V1, DEFAULT_STUB2_FLOORS, stubVerdict, stubVerdictV2, scoreFor };