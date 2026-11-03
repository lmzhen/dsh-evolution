# New `/evolution` subcommand

**When to use:** you are adding a subcommand — a new row in
`packages/evolution-commands/src/registry.ts` plus its handler branch.

Skeleton: `templates/command/registry-row.ts.tmpl`.

## Checklist

- [ ] One row in `packages/evolution-commands/src/registry.ts`
      (`{ usage, summary }`) plus its handler branch. The registry is the single
      source for the command table, the input hint and the emitted help text — a
      second list anywhere is the bug this rule set exists for.
- [ ] Merge exception: for `/evolution merge ...`, edit `MERGE_COMMAND_DEFS` in
      `packages/evolution-merge/src/command-defs.ts` and the parser/dispatch under
      `packages/evolution-merge/src/`, not only the ordinary registry. `/evolution`
      forwards the whole merge input to `evolutionMerge` before its ordinary branches.
- [ ] `summary` is non-empty and starts with a verb; `usage` carries the real
      argument shapes (`<id>`, `[--plan <runId>]`, `| `-separated choices). —
      *registry.spec.ts fails an empty summary.*
- [ ] Update the user reference in `docs/commands.md` for the new syntax and keep
      the canonical preset-install row in `packages/README.md`; do not add a second
      full command table to the root README. — *`verify-command-table.mjs` checks
      registry/dispatch parity; `registry.spec.ts` (T-WD2) requires non-empty
      summaries; `verify-doc-facts.mjs` (N19 `command-surface`) pins the canonical
      preset-install row.*
- [ ] Read-only commands say so and take no approval path; a command that writes
      goes through the same staged/approval surface as every other mutation.
      Exception (E-70, `tool-skill-manage`): a lifecycle-flag flip (pin/unpin) stays
      outside the seam whatever surface invokes it — staging it would let a request
      that expires hold the library pinned invisibly. Say so in the row's summary.
- [ ] Session-scoped behaviour of the command face: under the ① variant form the
      command stays visible in every session by design. — *stated once in
      `INSTALL.md` ("Known difference"); N19 fails a second copy.*
- [ ] Test the dispatch (args parsing + refusals) in
      `evolution-commands/tests/commands.spec.ts` with a real
      `CommandInvocation` fixture (`attachments: []` is required on 0.1.5).
- [ ] Run `tsc -b`, `oxlint` and the commands suite.
