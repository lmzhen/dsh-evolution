# Release decisions

Final Phase 0 decisions for the community release.

- npm account: `lmzhen`
- npm scope: `@lmzhen`
- registry: `https://registry.npmjs.org`
- first candidate version: `0.1.0-rc.1`; first STABLE version: `0.1.0` (2026-08-30)
- npm dist-tag: auto-selected by `publish-scoped.mjs` — stable semver → `latest`,
  prerelease (`-rc.*`) → `next`; explicit `--tag` overrides
- package set: all 29 packages (legacy facade `dsh-evolution` deprecated since
  rc.18; the current publish set is the 27 packages minus the facade)
- legacy `dsh-evolution`: publish and mark deprecated
- publishing auth: GitHub Actions + npm trusted publishing (OIDC); the first
  release candidate may use interactive `npm publish` as a canary
- long-lived 2FA-bypass GAT: forbidden
- branding: community build; not an official DeepSeek release
- upstream version family for dependency pinning: `0.1.1-rc.2` (single
  definition point `PLATFORM_VERSION` in the release workflow; CI asserts the
  packed dsh-* ranges match it — second-round audit N-2)
- upstream SHA pin: `UPSTREAM_SHA` — validate-only dev anchor; it must never
  feed release metadata (the compat anchor is the released tag
  `dsh-v<PLATFORM_VERSION>`)
- install smoke against the public npm registry: allowed to fail until
  upstream `@deepseek-ai/dsh-*` packages publish a complete dependency graph

## Second round (N-2 / N-7 / sidecar list)

- **CI purity (N-7)**: the `publish` job consumes ONLY the baseline validate
  artifacts (`evolution-dist-baseline` / `evolution-scripts-baseline`). The
  released-upstream compat check (`compat-check`) is a pure interception gate:
  it never produces publish artifacts, and it validates the released tree as
  shipped — the overlay swaps in `packages/evolution/` plus a minimal
  `tsconfig.base.json` alias injection (`inject-evolution-paths.mjs`), never a
  mirrored copy of the root configs.
- **Root-config policy**: the baseline job overlays the mirror's
  `tsconfig.base.json`/`tsconfig.host.json` (the pinned-dev-tree project graph
  is commit-bound, rc.51); the released job injects only the evolution alias
  path lines. A released tree that already declares an evolution alias row
  fails the injection loudly (platform absorbed the row — adapt the set).
- **Sidecar transaction list (v2 §8.3 + rc.68)**: every read-modify-write sidecar file
  under `$DSH_HOME/evolution/` (and the skills root) runs through
  `io.transact` via core's `transactIo`, with the single-process chain as the
  second layer: `.usage.json` (`mutateUsage`), `.mutations.json`
  (`recordMutation`), `.suppressed.json` (`updateSuppressedNames`),
  `activity.json` (activity store, rc.58), `feedback.json` (boot cache of the
  feedback event log), `events.json` (event log via `appendEvolutionEvent`,
  rc.68/rc.71 rotation).
  Any NEW sidecar must join this list and carry a "transact exists and the
  fallback behaves the same" test.
