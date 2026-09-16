# @deepseek-ai/dsh-evolution-commands

Human commands for the evolution family: it registers the `/evolution …` command surface
and its help text, and drives the other rows from a command. It adds no automatic
background behaviour of its own.

## Model surface

- **Model-visible:** one direct token — the `/evolution learn` injection: the full learning guidance is injected as a user message in this session; everything else adds no tokens.
- **Prompt prefix / KV cache:** independent of request-prefix construction — it does not alter the assembled prompt or tool list; family rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-commands` row, carried by the `evolution-host`, `evolution-all` and `evolution-preset` bundles.

## Command reference

The full `/evolution` subcommand table is single-sourced in the family README's **Command reference** section (`packages/README.md` in the source repository; it is named here instead of linked because a repo-relative markdown link out of this package would be dead inside the npm published tree). It is rendered from the subcommand registry (`src/registry.ts`, the same single source as the `/evolution` input-declaration hint and the bare-command help output), and `tests/registry.spec.ts` (T-WD2) pins that rendered table byte-for-byte.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
- **① variant form: the `/evolution …` command face is visible in every session** (accepted, not fixed). Commands are registered in scope layers, and the family registers once on the host plane, so a session on a platform original preset still lists the management-only subcommands even though no automatic family behaviour reaches it. The difference and its reasoning are single-sourced in `INSTALL.md` ("Known difference").

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- P2-22 (v11) correction: this package's **only** direct model-visible token is the `/evolution learn` injection — the full learning guidance is injected as a user message in this session.
- **① variant form: the `/evolution …` command face is visible in every session** (accepted, not fixed — 0.3.78).
- The injection goes through the agent's waking primitive (`followup`, falling back to `inject` when the host lacks it), **called on the agent instance**: the platform's `Agent.followup` is a prototype method (`this.send(...)`), so a detached reference throws and queues nothing (0.3.73 fix; the same shape is pinned by rule N13b in `packages/scripts/verify-arch-guards.mjs`, which masks comments and string literals before matching and self-tests its detector at startup).