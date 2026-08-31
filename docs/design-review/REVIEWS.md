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

## Decision status

All three designs are approved with the changes recorded above. No third-batch
implementation starts until the unresolved items are answered or explicitly
waived.
