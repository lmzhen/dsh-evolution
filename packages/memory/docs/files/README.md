# @lmzhen/dsh-memory-files

Default layered memory provider backed by `MEMORY.md` and `USER.md`. It registers as `files` and publishes the effective memory-budget view used by diagnostics.

`root` defaults to `$DSH_HOME/memories`. The store enforces its budget on the final result and refuses overflow rather than silently truncating an entry. Batch writes are serialized within the provider; cross-process safety still depends on the selected IO backend.

## Budgets and defaults

- `memoryTokens`: default 800 estimated tokens for `MEMORY.md`.
- `userTokens`: default 500 estimated tokens for `USER.md`.
- `memoryChars` / `userChars`: legacy character budgets. Setting only one of these on the row switches that file back to character mode; a row token value wins if both are set.
- `addDatePrefix`: default `false`.
- `maxConsolidationFailures`: default 3 failures before the model is told to stop retrying.
- `providerName`: default `files`.

The token estimate is `max(ceil(code points / 4), ceil(UTF-8 bytes / 3))`, the same conservative fallback as the family text-metrics layer. It is a pre-write gate, not provider-measured usage; tokens are always presented as estimates. An explicit row token value wins. With no row value, an already mounted evolution-policy token budget takes precedence; a policy that only carries legacy `memoryChars` / `userChars` is converted at 2.75 characters per token. A row-level legacy char value keeps character mode so an existing deployment does not change behaviour silently. The row budget controls what the store enforces; the policy budget controls what review plans against, so an explicit mismatch is warned about and surfaced by doctor.

`memoryCharLimit` and `userCharLimit` were removed from the live row schema in 0.48 (G0/S0.3); the old names survive only in the family's old-document migration table and doctor's old-key report, so a deployment config that still spells them must be rewritten. `threatExemptLabels` is deployment security configuration and defaults to empty.
