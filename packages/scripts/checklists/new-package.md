# New package

Skeleton: `templates/package/package.json.tmpl`, `templates/package/src-index.ts.tmpl`,
`templates/package/README.tmpl.md`.

## Checklist

- [ ] `packages/<pkg>/package.json`: name `@deepseek-ai/dsh-<pkg>` (publishing
      rewrites the scope to `@lmzhen`), the family `version`, `type: module`,
      the `repository` block every other manifest carries, `files` limited to
      what ships. — *`normalize-mirror.mjs` aligns all 30 manifests (29
      packages + the root) to the CHANGELOG head, and `verify-layout-sync.mjs`
      fails any manifest that disagrees with it; that guard's other half
      compares the two `scripts/` trees and runs only in the release chain.*
- [ ] Every import has a declared dependency (`workspace:^` for family packages,
      `peerDependencies` for platform packages), and every declared dependency is
      imported. — *`verify-dependency-closure.mjs packages --strict` fails in both
      directions (an unreferenced declaration is the retired-companion class).*
- [ ] `src/index.ts` is a Cordis plugin: `inject` list, `apply(ctx, config)`,
      Config with **clamped** numbers. — *`verify-arch-guards.mjs` N3 fails a bare
      `z.number()`; the 20 clamps landed in 0.3.71 are the reference.*
- [ ] No `process.env.DSH_HOME` outside `evolution-core/src`. — *N1 fails.*
- [ ] No `./invariant` companion and no `<pkg>/invariant` cordis row. — *N8 fails.*
- [ ] `SkillLibrary` only through core's `newSkillLibrary()`. — *N7 fails.*
- [ ] Service keys: provide what you probe. — *`verify-arch-guards.mjs` H2 fails a
      probed `evolution*` key with no provider (the doctor ghost-key incident).*
- [ ] Register the project in `tsconfig.base.json` **and** `tsconfig.host.json`
      (`./packages/evolution/<pkg>` references) and, if it ships a build, in
      `packages/tsdown.package.config.ts`. — *`tsc -b tsconfig.host.json` fails
      when a reference list is missing the new package.*
- [ ] Mount it: a row in the composition bundles that must carry it
      (`evolution-agent/agent.cordis.yml` for the preset delta, `cordis.yml` /
      `cordis.patch.yml` for the bundles). Bundles carry rows only, never code. —
      *N6 fails runtime code in a bundle; `verify-profile-bundles.mjs` and
      `bundle-mutual-exclusion.spec.ts` fail a row set that breaks E-33
      (shared rows must stay byte-identical across the three bundles).*
- [ ] A config key you declare must have a plane that reads it. — *`verify-declared-config.mjs`
      fails a declared key with no reading plane (a patch replaces `config` wholesale).*
- [ ] `tests/<pkg>.spec.ts` using `test-support/temp-home.ts`; cleanup via
      `tempHome`/`tempRoot`, never the real `DSH_HOME`. — *the E-33 spec
      pollution incident: a test without `tempHome` reads the developer's own profile.*
- [ ] Package `README.md` from the template (Model Experience, Known Limitations,
      the runtime invariant line) and one row in the package map
      (`packages/README.md` + root `README.md`). — *`verify-doc-facts.mjs`
      (N19) fails a fact stated in two documents.*
- [ ] Run: `tsc -b`, `oxlint`, the package's vitest suite, then the in-repo
      `verify-*.mjs` rows of the gate table — *`CONTRIBUTING.md` §The gate owns
      that list, so the count lives there and not here.*
