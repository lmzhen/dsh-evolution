# @deepseek-ai/dsh-evolution-threat

Write-time threat guard for evolution tools: one monotonic `tools.guard()` scans the payload of
every evolution write tool and refuses the call on a pattern hit. It registers no prompt or tool
schema — a denial is its only model-visible effect.

## Model surface

- **Model-visible:** nothing of its own — a refused write is the only thing the model notices.
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-threat` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset`.

## Configuration

- `enabled` — `true` — master switch; off installs no guard.
- `maxScanChars` — `65536` — the scan window size in normalized characters. Legal range is `>= 4097` — a smaller window cannot guarantee full-coverage scanning (the overlap floor is `PATTERN_OVERLAP + 1` in evolution-core), so the schema rejects it at load and the assembly clamp falls back to the default. The whole text is always scanned in overlapping windows; this value is not a total cap.
- `threatExemptLabels` — `[]` — pattern labels the deployment knows to be benign. The exemption surface is per config site: this guard row, the tool-skill-manage row, the evolution-commands row (its own SkillLibrary for the command write paths), the evolution-learning-graph row (its own SkillLibrary for the graph edit/delete write channel) and the memory store options each carry their OWN list and must be set separately. A label exempted only on the store side still blocks here.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- P2-4 (v14) closed the store-vs-guard asymmetry for the STORE gates (`SkillLibrary`/`MemoryStore` options)
- (v17 audit: the evolution-commands site was missing from this enumeration; the evolution-learning-graph site was missing from it as well.)
