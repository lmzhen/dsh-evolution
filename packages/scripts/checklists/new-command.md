# New `/evolution` subcommand

Skeleton: `templates/command/registry-row.ts.tmpl`.

## Checklist

- [ ] One row in `packages/evolution-commands/src/registry.ts`
      (`{ usage, summary }`) plus its handler branch. The registry is the single
      source for the command table, the input hint and the emitted help text — a
      second list anywhere is the bug this rule set exists for.
- [ ] `summary` is non-empty and starts with a verb; `usage` carries the real
      argument shapes (`<id>`, `[--plan <runId>]`, `| `-separated choices). —
      *registry.spec.ts fails an empty summary.*
- [ ] The command table in `packages/README.md` §Command reference must match the
      renderer byte-for-byte. The README is the fact's home: edit it there, do not
      copy the table anywhere else (the root README had already drifted to the
      pre-0.3.77 `--base` form). — *registry.spec.ts (T-WD2) fails on a missing,
      changed or extra row; `verify-doc-facts.mjs` (N19 `command-surface`) fails a
      second table or the stale row.*
- [ ] Read-only commands say so and take no approval path; a command that writes
      goes through the same staged/approval surface as every other mutation.
- [ ] Session-scoped behaviour of the command face: under the ① variant form the
      command stays visible in every session by design. — *stated once in
      `INSTALL.md` ("Known difference"); N19 fails a second copy.*
- [ ] Test the dispatch (args parsing + refusals) in
      `evolution-commands/tests/commands.spec.ts` with a real
      `CommandInvocation` fixture (`attachments: []` is required on 0.1.5).
- [ ] Run `tsc -b`, `oxlint` and the commands suite.
