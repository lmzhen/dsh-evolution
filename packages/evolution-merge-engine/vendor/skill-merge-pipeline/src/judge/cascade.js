"use strict";
// C17 / G5.4：⑤ 级联路由（L0→L1→L2）、auto→stub 解析、audit 采样、错误行语义。
import path from "node:path";
import { PyRandom } from "../pyrandom.js";
import { writeText } from "../io/write.js";
import { PROMPT_VERSION, buildPrompt, promptDigest } from "./prompt.js";
import { STUB_VERSION, STUB2_VERSION, stubVerdict, stubVerdictV2 } from "./stub.js";
import { USAGE, callDeepseek } from "./deepseek.js";
import { cacheKey, openVerdictCache } from "./cache.js";
import { buildEvidence } from "../evidence.js";
import { resolveJudgeProvider } from "./provider.js";
import { parseVerdict } from "./verdict.js";
const ROUTE = { l0_forward: [1, 0], l1_forward: [0] };

function resolveJudge(cfg, env) {
  const p = resolveJudgeProvider(cfg, env);
  return { mode: p.mode, fallback: p.fallback || "" };
}

async function runLevel(level, a, b, evidence, cfg, runner, stubFn, cache) {
  const prompt = buildPrompt(level, a, b, evidence, cfg);
  const sha = promptDigest(level, prompt);
  if (runner === null || runner === undefined) return [stubFn(level, evidence, a, b), prompt, sha];
  const key = cache ? cacheKey(sha, cfg.judge_model, { effort: cfg.judge_effort || "", temperature: 0 }) : "";
  if (cache) {
    const hit = cache.get(key);
    if (hit) return [hit, prompt, sha];
  }
  try {
    const verdict = parseVerdict(await runner(prompt, cfg));
    if (cache) cache.put(key, verdict);
    return [verdict, prompt, sha];
  } catch (exc) { return [{ verdict: 0, reason: "ERROR " + String(exc).slice(0, 160), evidence: [], error: true }, prompt, sha]; }
}

async function judgeCascade(pairs, byPath, cfg, promptDir, runner) {
  const parity = cfg.parity_bytes === true || cfg.io_dialect === "python";
  const eol = parity ? "crlf" : "lf";
  const writePrompt = (pf, text) => writeText(pf, text, { eol: eol });
  const cache = openVerdictCache(cfg, promptDir);
  const provider = resolveJudgeProvider(cfg, process.env);
  const mode = provider.mode;
  const autoFallback = !!provider.fallback;
  if ((runner === null || runner === undefined) && mode === "deepseek") runner = callDeepseek;
  const stubFn = mode === "stub2"
    ? (level, ev, a, b) => stubVerdictV2(level, ev, a, b, cfg.stub2_floors || {})
    : stubVerdict;
  const out = [];
  Object.assign(USAGE, { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_cny: 0 });
  const stats = { cache: cache ? Object.assign({}, cache.stats) : { enabled: false, hits: 0, misses: 0, size: 0 }, pairs: pairs.length, model: cfg.judge_model, prompt_version: PROMPT_VERSION, stub_version: mode === "stub2" ? STUB2_VERSION : STUB_VERSION, judge_mode: mode, judge_provider: { id: provider.id, promptSha: provider.promptSha, heuristic: provider.heuristic }, judge_auto_fallback: autoFallback, levels: { L0: 0, L1: 0, L2: 0 }, verdicts: { "1": 0, "0": 0, "-1": 0 }, l0_forwarded: 0, l1_forwarded: 0, l0_verdicts: { "1": 0, "0": 0, "-1": 0 }, l1_verdicts: { "1": 0, "0": 0, "-1": 0 }, l0_dropped: 0, undecided: 0, errors: 0, audit_pool: 0, audit_sampled: 0, audit_overrides: 0, usage: {} };
  for (let i = 0; i < pairs.length; i += 1) {
    const r = pairs[i];
    const a = byPath.get(r.a_path), b = byPath.get(r.b_path);
    const evidence = buildEvidence(r);
    const trail = [], promptFiles = [];
    const emitPrompt = (pf, text) => { if (cfg.write_prompts === true) { writePrompt(pf, text); promptFiles.push(pf); } };
    let levelUsed = null, final = null;
    let [v0, p0, s0] = await runLevel("L0", a, b, evidence, cfg, runner, stubFn, cache);
    trail.push(Object.assign({ level: "L0", prompt_sha: s0 }, v0));
    let finalSha = s0;
    stats.l0_verdicts[String(v0.verdict)] += 1;
    let pf = path.join(promptDir, String(i + 1).padStart(3, "0") + "_" + a.name + "__" + b.name + "_L0.md");
    emitPrompt(pf, p0);
    if (ROUTE.l0_forward.includes(v0.verdict)) {
      stats.l0_forwarded += 1;
      let [v1, p1, s1] = await runLevel("L1", a, b, evidence, cfg, runner, stubFn, cache);
      trail.push(Object.assign({ level: "L1", prompt_sha: s1 }, v1));
      finalSha = s1;
      stats.l1_verdicts[String(v1.verdict)] += 1;
      pf = path.join(promptDir, String(i + 1).padStart(3, "0") + "_" + a.name + "__" + b.name + "_L1.md");
      emitPrompt(pf, p1);
      if (ROUTE.l1_forward.includes(v1.verdict)) {
        stats.l1_forwarded += 1;
        const [v2, p2, s2] = await runLevel("L2", a, b, evidence, cfg, runner, stubFn, cache);
        trail.push(Object.assign({ level: "L2", prompt_sha: s2 }, v2));
        finalSha = s2;
        pf = path.join(promptDir, String(i + 1).padStart(3, "0") + "_" + a.name + "__" + b.name + "_L2.md");
        emitPrompt(pf, p2);
        levelUsed = "L2"; final = v2;
        if (v2.verdict === 0) stats.undecided += 1;
      } else { levelUsed = "L1"; final = v1; }
    } else { stats.l0_dropped += 1; levelUsed = "L0"; final = v0; }
    stats.levels[levelUsed] += 1;
    const rowError = !!final.error;
    if (rowError) stats.errors += 1;
    stats.verdicts[String(final.verdict)] += 1;
    const action = final.verdict === 1 ? "MERGE" : final.verdict === 0 ? (levelUsed === "L2" ? "UNDECIDED" : "ESCALATED") : "KEEP_BOTH";
    const row = Object.assign({}, r, {
      error: rowError, level: levelUsed, verdict_id: final.verdict, action: action,
      reason: final.reason, prompt_sha: finalSha, prompt_files: promptFiles,
      trail: trail, judge_id: provider.id, heuristic: provider.heuristic,
      verdict_record: { level: levelUsed, verdict: final.verdict, action: action, reason: String(final.reason).slice(0, 240), prompt_sha: finalSha, model: cfg.judge_model, judge_id: provider.id, heuristic: provider.heuristic },
      evidence: final.evidence || []
    });
    out.push(row);
  }
  const poolIdx = out.map((r, i) => i).filter(i => out[i].level === "L0" && out[i].verdict_id === -1);
  stats.audit_pool = poolIdx.length;
  if (poolIdx.length) {
    const k = Math.ceil(0.1 * poolIdx.length);
    const rng = new PyRandom(Number(cfg.audit_seed || 1) + poolIdx.length);
    const pickedIdx = rng.sample(poolIdx, Math.min(k, poolIdx.length));
    let changed = 0;
    for (const i of pickedIdx) {
      const r = out[i];
      const a = byPath.get(r.a_path), b = byPath.get(r.b_path);
      const ev = buildEvidence(r);
      const [v2, p2, s2] = await runLevel("L2", a, b, ev, cfg, runner, stubFn, cache);
      r.trail = r.trail || []; r.trail.push(Object.assign({ level: "L2(audit)", prompt_sha: s2 }, v2));
      r.audit_sampled = true;
      if (v2.verdict !== -1) {
        changed += 1;
        r.verdict_id = v2.verdict;
        r.action = v2.verdict === 1 ? "MERGE" : v2.verdict === 0 ? "UNDECIDED" : "KEEP_BOTH";
        r.reason = "[抽检改判] " + String(v2.reason);
        r.level = "L2(audit)";
        r.prompt_sha = s2;
        r.verdict_record = Object.assign({}, r.verdict_record, { level: "L2(audit)", verdict: v2.verdict, action: r.action, reason: String(r.reason).slice(0, 240), prompt_sha: s2, judge_id: provider.id, heuristic: provider.heuristic });
        r.evidence = v2.evidence || [];
      }
      stats.levels.L2 += 1;
    }
    stats.audit_sampled = pickedIdx.length;
    stats.audit_overrides = changed;
  }
  if (cache) { cache.flush(); stats.cache = Object.assign({}, cache.stats); }
  stats.usage = Object.assign({}, USAGE);
  stats.judge_mode = mode;
  return [out, stats];
}


export { judgeCascade, resolveJudge, parseVerdict, ROUTE };