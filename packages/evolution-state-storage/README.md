# @deepseek-ai/dsh-evolution-state-storage

Provider registry seam for durable evolution state: the consumer (`evolution-state`) never touches
a medium — providers register here (`json` = IO-seam files, `domain` = storage-domain KV).

## Model surface

- **Model-visible:** nothing of its own — the consumer rows own the injection.
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-state-storage` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset`; a seam consumed by `evolution-state`, `evolution-state-json`, `evolution-state-domain` and `evolution-approval`.

## Conformance suite

The package publishes `runStateProviderConsistency(provider, assert)` — the whole seam contract as one call: field-complete pending round-trips, claim/resolve rollback, refusals at the write boundary, clone/alias independence, unknown-field preservation, and the two caps (resolved pending tail, review-state session rows). A third-party provider checks itself by running the suite against its own instance:

```ts
import { runStateProviderConsistency } from '@deepseek-ai/dsh-evolution-state-storage'
import { expect } from 'vitest' // or any runner wrapped into `ConformanceAssert`

await runStateProviderConsistency(myProvider, expect)
```

The assertion surface is INJECTED rather than imported, which is what lets this module ship: it carries no test-runner dependency, so loading the package never loads vitest. Both shipped providers run the same suite (`evolution-state-json` / `evolution-state-domain` `tests/provider-consistency.spec.ts`), and `consistency-forge.spec.ts` proves the suite fails when a single field is forged.


## Known limitations

- Provider registry has no default medium. Mount `evolution-state-domain` or `evolution-state-json` before state reads.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- Conformance suite (S3-2 / J-5)
