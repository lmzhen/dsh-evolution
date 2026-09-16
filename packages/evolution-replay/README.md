# @deepseek-ai/dsh-evolution-replay

Replay/A-B evaluation primitives for evolution plans: it reads the activity sidecar back,
compares plan outcomes and provides the `evolutionReplay` service behind `evolution
replay`.

## Model surface

- **Model-visible:** nothing of its own: no prompt section and no tool schema; `/evolution replay` is a human command; consumers own the model-visible effects.
- **Prompt prefix / KV cache:** independent of request-prefix construction — it does not alter the assembled prompt or tool list; family rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-replay` row, carried by the `evolution-host`, `evolution-all` and one-click `evolution-preset` bundles.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
- **The activity-sidecar verdict is per read (`sourceCorrupt`).** When `apply()` meets bytes this build cannot read as the current format, every `compare()` result carries `sourceCorrupt: true` and its report states the leaderboard is NOT the recorded history (an empty list does not mean nothing happened); a later successful read clears the qualification (a repaired sidecar plus an io reload (HMR / plugin restart)), while the corruption stays observable through the one warn `apply()` emits at mark time.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).