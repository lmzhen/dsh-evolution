# Independent design review record

Three independent subagent reviews were run for the third-batch designs. This
file records verdicts, accepted changes, and unresolved questions.

## 003 Legacy facade retirement

Verdict: approve-with-changes.

Accepted changes:
- Phase B uses a root-realm, no-isolate, idempotent JS compositor instead of a
  hidden isolate re-export group.
- Legacy `curator-state.json` flat shape is migrated to the provider shape.
- Observability uses `ctx.emit('evolution/legacy-mounted')` plus one-shot
  logger warning, and Phase C removal is usage-gated.
- Compatibility contract: legacy paths and file names remain stable until
  package deletion.

Unresolved:
- Profile patch override behavior for rows composed inside JS apply.
- Measurement of legacy mount usage across web/GUI deployments.

## 004 Mirror CI and trusted publishing

Verdict: approve-with-changes.

Accepted changes:
- Trust boundary is a full upstream checkout pinned by a reviewable
  `UPSTREAM_SHA` file; minimal fixtures are rejected.
- Pack once in validate and publish the exact validated artifacts.
- `prepare-release.mjs` must gain `--version`, `--upstream-version`, scoped
  YAML/installer/row-contract rewriting, exports/files validation, and remove
  `exports["./src/*"]` in scoped mode.
- Publishing must be idempotent by npm integrity comparison, with retry and
  `--tag next` for prereleases; no rollback.
- Security: SHA-pinned actions, `persist-credentials: false`, minimal
  permissions, protected `npm-publish` environment, provenance.

Unresolved:
- Upstream repository public clone visibility for Actions.
- Whether the first release target is npmjs personal scope or GitHub Packages.
- OIDC preflight and per-package setup cost for 29 packages.

## 005 Per-skill tool declarations

Verdict: approve-with-changes.

Accepted changes:
- Private namespaced `x-dsh` frontmatter with strict schema instead of
  unnamespaced `allowed-tools` / `required-tools`.
- A real YAML parser must replace line-oriented frontmatter parsing before
  metadata publication.
- General enforcement is explicitly a non-goal; Phase B is demoted to an
  optional intersection-only experiment that can never widen `toolFilter.allow`.
- Upstream proposal separates `SkillToolPolicy` from
  `SkillInvocationPolicy`, adds `tools?` to summary/candidate/definition, and
  forbids loader/catalog mutation of global tools or KV cache keys.

Unresolved:
- Impact of stripping frontmatter metadata from catalog content.
- Whether `requiredTools` should exist before upstream semantics.
- Which upstream package owns the standard field.

## 010 Maintenance subagent (domain/layer drift review)

Verdict: approve-with-changes (v9 审计，已归档；设计被 011 取代).

Accepted changes:
- `drift-signals` naming split from the session review signal gate (`signals.ts`);
  signal definitions live in core, orchestration in the new `evolution-maintenance` package.
- `prefix_cluster` threshold mirrors the engine (>=2), no parameter fork.
- Execution mapping: new `/evolution restructure` user command bridging
  `SkillLibrary.restructure`; B2-B5 go through patch guidance; B3 keeps the
  ambiguous-anchor protection untouched.
- Plan state: event-log summary + runId back-reference; no new state table.
- Threat model with core-level `redact` migration; maintainRunning gate
  **explicitly waived** (read-only diagnosis, no reentrancy damage; concurrency
  costs tokens only).

Unresolved:
- Probe deep-dive tooling (Phase 3) and `--plan` audit back-reference (deferred).

## 011 Maintenance subagent v2 (revision)

Verdict: approved (v10 审计，已归档).

Accepted changes:
- F-1/F-2/F-4/A1/A5/A6/A7 all responses landed; A4 prefers event payload over
  a state table; A3 keeps the core bundle with same-version release discipline.
- Phase 1-2 implemented: `drift-signals`, `redact` migration,
  `evolution-maintenance` (scan/render/validate/orchestrate), bundle v10
  (`MAINTAIN_PROMPT`), `/evolution maintain|restructure`, commands
  `Config.skillsRoot` (A7 alignment).

Unresolved:
- Phase 3 (probe); MISMATCH command-side preflight (bundle digest + model-side
  signature comparison already cover it).

## Decision status

All three designs are approved with the changes recorded above and shipped
through the 0.2.0–0.3.1 releases. The design-time review record here is
historical; the current audit baseline is `AUDIT_REPORT_v12.md` (v9–v11
reports and the superseded 010 design were archived in the 0.3.1 cleanup).
