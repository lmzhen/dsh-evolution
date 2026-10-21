"use strict";
// G2.1：scan 组合根；stage 列表/顺序/依赖只在这里组装，CLI 不碰 stage。
import { defaultStages } from "./index.js";
import { provisionStage } from "../stages/provision.js";
import { rankPlanStage } from "../stages/rank_plan.js";

function byId(stages) {
  const map = new Map();
  for (const s of stages) map.set(s.id, s);
  return map;
}

export function buildScanStages() {
  const base = byId(defaultStages());
  const need = (id) => {
    const s = base.get(id);
    if (!s) throw new Error("scan stage 缺失: " + id);
    return s;
  };
  return [
    need("prefilter"),
    need("candidates"),
    need("lexical"),
    provisionStage,
    rankPlanStage,
    need("semantic"),
    need("rerank"),
    need("judge"),
  ];
}

export { byId };