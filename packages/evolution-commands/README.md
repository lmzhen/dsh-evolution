# @deepseek-ai/dsh-evolution-commands

Human commands for the evolution family

## Command reference

The full `/evolution` subcommand table is single-sourced in the family
README's **Command reference** section (`packages/README.md` in the source
repository; it is named here instead of linked because a repo-relative
markdown link out of this package would be dead inside the npm published
tree). It is rendered from the subcommand registry (`src/registry.ts`, the same
single source as the `/evolution` input-declaration hint and the
bare-command help output), and `tests/registry.spec.ts` (T-WD2) pins that
rendered table byte-for-byte. This package README cites that home instead
of restating the table (doc-facts rule N19: never copy a fact across docs).

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-commands` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

P2-22 (v11) correction: this package's **only** direct model-visible token is the
`/evolution learn` injection — the full learning guidance is injected as a user
message in this session. Everything else adds no tokens; consumers add their own.
The injection goes through the agent's waking primitive (`followup`, falling back
to `inject` when the host lacks it), **called on the agent instance**: the
platform's `Agent.followup` is a prototype method (`this.send(...)`), so a
detached reference throws and queues nothing (0.3.73 fix; the same shape is
pinned by rule N13b in `packages/scripts/verify-arch-guards.mjs`, which masks comments and string literals before matching and self-tests its detector at startup).

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
- **① variant form: the `/evolution …` command face is visible in every session**
  (accepted, not fixed — 0.3.78). Commands are registered in scope layers, and the
  family registers once on the host plane, so a session on a platform original
  preset still lists the management-only subcommands even though no automatic
  family behaviour reaches it. The difference and its reasoning are single-sourced
  in `INSTALL.md` ("Known difference").

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
