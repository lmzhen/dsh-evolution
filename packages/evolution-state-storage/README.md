# @deepseek-ai/dsh-evolution-state-storage

Provider registry seam for durable evolution state


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-state-storage` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Conformance suite (S3-2 / J-5)

The package publishes `runStateProviderConsistency(provider, assert)` — the whole seam contract as one call: field-complete pending round-trips, claim/resolve rollback, refusals at the write boundary, clone/alias independence, unknown-field preservation, and the two caps (resolved pending tail, review-state session rows). A third-party provider checks itself by running the suite against its own instance:

```ts
import { runStateProviderConsistency } from '@deepseek-ai/dsh-evolution-state-storage'
import { expect } from 'vitest' // or any runner wrapped into `ConformanceAssert`

await runStateProviderConsistency(myProvider, expect)
```

The assertion surface is INJECTED rather than imported, which is what lets this module ship: it carries no test-runner dependency, so loading the package never loads vitest. Both shipped providers run the same suite (`evolution-state-json` / `evolution-state-domain` `tests/provider-consistency.spec.ts`), and `consistency-forge.spec.ts` proves the suite fails when a single field is forged.

## Known Limitations and Deferred Work


- Provider registry has no default medium. Mount `evolution-state-domain` or `evolution-state-json` before state reads.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

