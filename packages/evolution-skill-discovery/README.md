# @deepseek-ai/dsh-evolution-skill-discovery

Read model and view identity for evolution skill discovery (Program B, PLAN-DISC-001).

## Status

The package has a real `apply`, is referenced by the `evolution-all` bundle row, and is booted from a test `cordis.yml` through the Loader. The model-facing surface is `skill_search` plus injected, read-only domain cards. DomainMap bootstrap, explicit generation, and projection are implemented. Create-time assignment/classification and shadow mode are not shipped; provisional domains are not auto-promoted. The command surface is `/skill-domain status | generate`. The map plane is explicit experimental: default `mode:off`, no catalog rewrite or hidden skills.

## Contract

- `SkillIndex` reads a source's `ctx.skills`-shaped snapshot and a managed-skill key set; it does not register a provider or cache a second catalog.
- `viewKey/viewCatalogDigest/catalogRevision/policyDigest/projectionDigest/searchIndexKey` are deterministic SHA-256 identities.
- Incomplete snapshots keep `complete:false`; callers must fail open, not hide skills.

## Verification

`pnpm exec vitest run packages/evolution/evolution-skill-discovery/tests/discovery.spec.ts --maxWorkers=1`
