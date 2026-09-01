# 008 — Skill loop completion: sensing / decision / acting seams (design)

Status: design declaration, reviewed and confirmed 2026-08-30. Trigger: the on-machine
diagnosis (2026-08-31) showed the loop's three seams are broken — sensing (usage.json
is `{}` while skills ARE read; no production caller of `record('use'/'view')`), decision
(review fires but repair never lands), acting (curator `runCount=0`, no restructure op).

## Judgement table (maintainability × extensibility, per seam)

| Seam | Verdict | Disposition |
|---|---|---|
| `computeQualityScores` six factors | qualified | KEEP — but hard boundary: structure health is a DIFFERENT dimension, never a 7th factor |
| `skill-usage` use/view signal | UNQUALIFIED (orphan API: zero production callers) | REFACTOR — registry owns one declarative `tool/call` observation wiring |
| Structure health computation | absent | NEW small domain module (pure, derived, NOT persisted) |
| Plan-op model for directory-level rewrite | mixed (qualified for single-file ops) | SkillLibrary control-plane `restructure()` + one plan op kind delegating to it |
| Review channel | qualified | EXTEND — health signal line + restructure op in the same batch (promise & capability never split) |
| Events timeline | qualified | EXTEND — `type:'skill'` (use aggregated / restructure) |
| Curator runtime | qualified | EXTEND — health section in scopeView/report, riding the existing runCore tree scan |
| 100k gate split-advice | one-line gap | FIX |
| Read-audit storage | platform session logs own it | NOT BUILD (duplication) |
| Health persistence / new scheduler / new approval domain / new event infra | negative ROI | NOT BUILD |

## Architecture (two assessment domains, four seams)

```
sensing:  skill-usage(observation wiring) + platform session logs(audit) + mutations/events(facts)
   │
assess:   usageQuality(six factors, KEEP) ‖ SkillHealth(NEW derived domain)
   │
decide:   review(plan + restructure op) ‖ curator(watch/report, rides existing run)
   │
act:      SkillLibrary.restructure(atomic control-plane) → approval(origin gate) → snapshot rollback → probes
   │
verify:   re-assess + report + event kind:'restructure'
```

## Batches (robust decomposition: measure-before-mutate, domain-before-consumers, risk islands)

| Batch | Content | Behavior | Risk |
|---|---|---|---|
| **A1 观测基座** | SkillHealth domain + curator health section + `/evolution skills health` + thresholds Config + split-advice line | zero (new domain + read-only exposure) | low |
| **A2 信号重构** | skill-usage observation refactor + churn dimension enabled | zero (additive wiring; write-path pinned by existing tests) | mid (3 consumers) |
| **B 执行闭环** | restructure() + plan op + validator + approval reuse + prompt line (bundle bump together) + events `kind:'restructure'` | yes | high (tree + approval) |
| **C 口径** | event use-aggregation + semantics + observation window | low | low |

Observation windows between batches; B's trigger thresholds are data-derived (A1/A2 baselines), never guessed.

## 实现注记（2026-08-31 v7 审计校准，覆盖本设计中的两处表述）

1. **事件命名**：判定表与 C 批次的 `type:'skill'` 在实现中为 **`type:'usage'`（`kind:'skill'`）**——usage 类别与 feedback/learn 并列，kind 字段承担对象域（skill/session）。语义不变：窗口锚点 + use 聚合落时间线。
2. **restructure 事件**：实现落在进程事件总线 `evolution/skill-mutated`（action `'restructure'`），**不进事件时间线**（时间线是 loop 事实记录，非树变更审计；树变更审计走 mutations 侧车）。因此"feedback 与 restructure 先后可答"仅适用于 usage 锚点与 feedback/learn 之间；restructure 时序由 mutations 侧车回答。
3. **幂等锚点**：窗口锚点在 view 0→1 那次读取追加一次；append 失败不重试（侧车是真相），见 skill-usage `appendUsageWindowEvent` 注释（v7 P3-2 校准）。

## Non-negotiable boundaries (from原版分层 + 三问 + loop discipline)

1. Sensing/Boundary = deterministic; Judgment = LLM proposal; Execution = human approval + deterministic implementation; Verification = probes + report (split-first, reversible).
2. Events入线前过三问：native-already? stable identity key? signal-window pollution?
3. Health is DERIVED — no sidecar, no schema change to quality_score, no new package.
4. Automatic rewriting never scans the library wholesale (original's cost rationale) — candidate-restricted + usage-triggered + approved.
