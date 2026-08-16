# @deepseek-ai/dsh-evolution

DeepSeek Harness native self-evolution core plugin for DeepSeek Harness.

## Architecture layers

- `src/memory-store.ts` — bounded, file-backed memory with batch/dedup/ambiguity/drift guards.
- `src/skill-store.ts` — skill create/edit/patch/archive and support files with protection markers.
- `src/usage.ts` — `.usage.json` telemetry compatible with Hermes core fields.
- `src/curator.ts` — deterministic active → stale → archived transitions.
- `src/signals.ts` — zero-LLM review signal gate; subagent sessions are excluded.
- `src/prompts.ts` — Hermes-adapted memory/skill/combined/curator prompts.
- `src/threats.ts` — block-any prompt-injection/exfiltration/persistence scanning.
- `src/index.ts` — DSH plugin adapter: tools, prompt layers, review orchestration, curator timer.

## Key invariants

- Stable guidance is a `systemPrompt.section`; memory is a `systemPrompt.context` snapshot.
- Review never injects nudges into the main session when a subagent provider is available.
- Review/curator child sessions (`origin: subagent`, `delegationDepth > 0`) cannot recurse.
- Foreground `skill_manage(create)` is user-owned; only background-origin create marks `created_by: "agent"`.
- Pinned skills reject delete/archive but remain patchable/editable.
- Every self-evolution mutation is threat-scanned before write.

## Configuration

See the evolution family README and `cordis.patch.yml.example` in the old standalone package.
