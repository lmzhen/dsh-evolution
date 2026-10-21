"use strict";
// G5.3：DeepSeek 判决调用 + usage/计费。
import { SYSTEM } from "./prompt.js";
import { proxiedFetch } from "../net/proxy.js";
const USAGE = { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 };
const EFFORT_WIRE = {
  off: { thinking: { type: "disabled" } },
  high: { thinking: { type: "enabled" }, reasoning_effort: "high" },
  max: { thinking: { type: "enabled" }, reasoning_effort: "max" }
};

function priceOf(cfg, model) {
  const table = cfg.judge_price_cny_per_ktok || {};
  const p = table[model || cfg.judge_model] || {};
  return { input: Number(p.input || 0), output: Number(p.output || 0) };
}

async function callDeepseek(prompt, cfg) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("未设 DEEPSEEK_API_KEY（设了才走真实判决；否则用 --judge stub）");
  const body = { model: cfg.judge_model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], temperature: 0 };
  Object.assign(body, EFFORT_WIRE[cfg.judge_effort || "high"] || {});
  const resp = await proxiedFetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 160));
  const data = await resp.json();
  const u = data.usage || {};
  const pt = Number(u.prompt_tokens || 0);
  const ct = Number(u.completion_tokens || 0);
  const price = priceOf(cfg);
  USAGE.calls += 1;
  USAGE.prompt_tokens += pt;
  USAGE.completion_tokens += ct;
  USAGE.cost_cny += (pt / 1000) * price.input + (ct / 1000) * price.output;
  return data.choices[0].message.content;
}

export { USAGE, EFFORT_WIRE, callDeepseek, priceOf };