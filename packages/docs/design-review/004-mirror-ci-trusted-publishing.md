# Design Review 004: Mirror CI and trusted publishing

Status: proposed (updated after independent review)
Review verdict: approve-with-changes

## Context

The public mirror `lmzhen/dsh-evolution` is a flat source mirror. Build and
test scripts currently run only inside a DeepSeek Harness checkout. We need a
CI/release path that validates changes and publishes community packages under
`@lmzhen/*` without long-lived npm tokens.

## Trust boundary

- Use a full upstream checkout pinned by a repository file `UPSTREAM_SHA`.
  A minimal vendored fixture is explicitly rejected: tests depend on the full
  agent/session/tools/storage/skill graph and tsconfig projects.
- PRs can change `UPSTREAM_SHA` only with review.
- Overlay is `mirror/packages/* -> upstream/packages/evolution/`, excluding
  `node_modules`, `lib`, `dist`, and `.release-staging`.

## CI matrix

1. `validate` on PR and push:
   - static mirror checks: normalized manifests, no `lib`/`dist` artifacts, no
     stale `@deepseek-ai/dsh-evolution/src` imports;
   - overlay into pinned upstream checkout;
   - `pnpm install --frozen-lockfile`;
   - `tsc -b tsconfig.host.json --force`;
   - `vitest run packages/evolution`;
   - `oxlint packages/evolution`;
   - `build-lib.mjs`;
   - `prepare-release.mjs --scope @lmzhen --version <version>`;
   - pack once and upload the exact tarballs as an artifact.
2. `publish` on semver tag:
   - download the exact validated artifact; never rebuild;
   - preflight registry state;
   - publish in topological order with OIDC trusted publishing;
   - no rollback: failed publish is resumed by re-running against the same
     immutable tag artifacts, skipping already-published identical integrity.

## Scoped release requirements

`prepare-release.mjs` must close these gaps before publishing:

- `--version` parameter instead of hardcoded `0.1.0-rc.1`.
- external `@deepseek-ai/dsh-*` dependencies pinned to one consistent upstream
  version family (`--upstream-version`, recommended `0.1.0-rc.6`), not each
  package's `latest` dist-tag.
- `--scope` rewrites package names, cross-dependencies, `repository.directory`
  (`packages/<dir>`), Cordis YAML row names, installer prefixes and row
  contracts.
- scoped manifests remove `exports["./src/*"]` because `files` excludes `src`.
- tarball validation: every exports target must exist; `lib/*.js` must not
  import `@deepseek-ai/dsh-evolution/src/`.
- write `manifest.json` and `smoke-package.json` only after all validations
  pass.

## Publishing controls

- Idempotence: compare `npm view <pkg>@<ver> dist.integrity`; same integrity
  means skip, different integrity means fail.
- Retry E409/E429/5xx with backoff.
- Prereleases publish with `--tag next`.
- A publish order manifest is generated from directory->package mapping.

## Publishing order (29 packages, including legacy facade)

```text
evolution-core
evolution-io, evolution-state-storage
evolution-io-node, evolution-state-domain, evolution-state-json
evolution-state
memory, memory-files, skill-usage
evolution-policy, evolution-approval, evolution-threat
evolution-plan-validator
tool-memory, tool-skill-manage
dsh-evolution
evolution-review, evolution-curator, evolution-commands
evolution-activity, evolution-feedback, evolution-learning-graph,
evolution-replay, evolution-skill-catalog, evolution-capability
evolution-host, evolution-preset, evolution-agent-preset
```

## Security requirements

- pin Actions to commit SHAs; `persist-credentials: false`;
- validate job: `contents: read` only;
- publish job: `contents: read`, `id-token: write`, protected
  `environment: npm-publish` with required reviewers;
- verify release tag or rely on environment protection for tag triggers;
- publish with `npm publish --provenance --access public`;
- npm trusted publishing must be configured per package; maintain a checklist
  in `docs/release/oidc-checklist.md`.

## Review questions

- Is the upstream repository publicly cloneable by GitHub Actions?
- Does npm trusted publishing support preflight for all 29 packages?
- Should the first release target npmjs personal scope or GitHub Packages?
- Should the legacy `dsh-evolution` package be published in the scoped family
  or left out?
