# @lmzhen/dsh-memory-files

Default layered memory provider backed by `MEMORY.md` and `USER.md`. It registers as `files` and publishes the effective memory-budget view used by diagnostics.

`root` defaults to `$DSH_HOME/memories`. The store enforces its character budget on the final result and refuses overflow rather than silently truncating an entry. Batch writes are serialized within the provider; cross-process safety still depends on the selected IO backend.

## Budgets and defaults

- `memoryChars`: fallback default 2,200 characters for `MEMORY.md`.
- `userChars`: fallback default 1,375 characters for `USER.md`.
- `addDatePrefix`: default `false`.
- `maxConsolidationFailures`: default 3 failures before the model is told to stop retrying.
- `providerName`: default `files`.

An explicit row/user value wins. Otherwise an already mounted evolution-policy budget takes precedence over the package fallback. The row budget controls what the store enforces; the policy budget controls what review plans against, so an explicit mismatch is warned about and surfaced by doctor.

`memoryCharLimit` and `userCharLimit` remain readable deprecated aliases of `memoryChars` and `userChars`; writes to the old names are refused (G0/S0.3). `threatExemptLabels` is deployment security configuration and defaults to empty.
