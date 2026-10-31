# @deepseek-ai/dsh-evolution-skill-discovery

Read model and view identity for evolution skill discovery (Program B, PLAN-DISC-001).

## Status

The package has a real `apply`, is referenced by the `evolution-all` bundle row, and is booted from a test `cordis.yml` through the Loader. The model-facing surface is `skill_search` plus injected domain cards; `skill_domains` remains OUT-006/UI-001 and is not registered. DomainMap bootstrap, persistent assignment queue, prompt constants, and the v0 gates are implemented. The optional command surface is `/skill-domain list` and `/skill-domain confirm <id>` for provisional domains; approval is optional (default: no approval). Approval-completed enqueue seam and preset-scope coverage are covered; remaining strength work is shadow silent-miss evidence. Shadow sampling and promotion evidence, disabled-domain search e2e, and Loader boot are covered in tests.

## Contract

- `SkillIndex` reads a source's `ctx.skills`-shaped snapshot and a managed-skill key set; it does not register a provider or cache a second catalog.
- `viewKey/viewCatalogDigest/catalogRevision/policyDigest/projectionDigest/searchIndexKey` are deterministic SHA-256 identities.
- Incomplete snapshots keep `complete:false`; callers must fail open, not hide skills.

## Verification

`pnpm exec vitest run packages/evolution/evolution-skill-discovery/tests/discovery.spec.ts --maxWorkers=1`
