// G9：S1/S2 的 DeepSeek JSON 调用（可注入；无 key/--no-llm 时由确定性 fallback 接管）。
import os from "node:os";
import path from "node:path";
import { proxiedFetch } from "../net/proxy.js";
import { exists, readText } from "../io/read.js";
import { priceOf } from "../judge/deepseek.js";

export const LLM_USAGE = { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 };

export function readDeepseekKey(credentialsPath) {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const candidates = credentialsPath ? [credentialsPath] : [path.join(os.homedir(), ".dsh", ".credentials.yaml")];
  for (const p of candidates) {
    if (!exists(p)) continue;
    try {
      const txt = readText(p);
      const m = /DEEPSEEK_API_KEY\s*:\s*([A-Za-z0-9_\-]+)/.exec(txt);
      if (m) return m[1];
    } catch (e) { /* 尝试下一个 */ }
  }
  return null;
}

export function parseJsonLoose(text) {
  let s = String(text || "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j <= i) throw new Error("LLM 输出无 JSON 对象: " + s.slice(0, 160));
  return JSON.parse(s.slice(i, j + 1));
}

export function createLlm(opts) {
  const o = opts || {};
  const cfg = o.cfg || {};
  const noLlm = !!o.noLlm;
  const key = noLlm ? null : (o.key || readDeepseekKey(o.credentialsPath));
  const model = o.model || cfg.judge_model || "deepseek-flash";
  const endpoint = o.endpoint || "https://api.deepseek.com/chat/completions";
  const usage = { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 };
  async function callJson(system, user, callOpts) {
    if (!key) throw new Error("无 DEEPSEEK_API_KEY（或用了 --no-llm）");
    const body = { model: model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, max_tokens: (callOpts && callOpts.maxTokens) || 2000 };
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const resp = await proxiedFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify(body) });
        if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 160));
        const data = await resp.json();
        const u = data.usage || {};
        const pt = Number(u.prompt_tokens || 0);
        const ct = Number(u.completion_tokens || 0);
        const price = priceOf(cfg, model);
        usage.calls += 1; usage.prompt_tokens += pt; usage.completion_tokens += ct;
        usage.cost_cny += (pt / 1000) * price.input + (ct / 1000) * price.output;
        LLM_USAGE.calls += 1; LLM_USAGE.prompt_tokens += pt; LLM_USAGE.completion_tokens += ct; LLM_USAGE.cost_cny = usage.cost_cny;
        return parseJsonLoose(data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "");
      } catch (err) { lastErr = err; }
    }
    throw lastErr || new Error("LLM 调用失败");
  }
  return { available: !!key, model, usage, callJson };
}