---
name: dsh-plugin-compatibility
description: Audit DSH plugins against a new release and fix what breaks.
---

# DSH Plugin Compatibility

DSH has changed its client module-system protocol between releases. Plugins
that hard-code an old global usually break on newer hosts with errors like:

- `[plugin] chunk "x": client module system unavailable`
- `client-modules: window.__DSH_MODULES__ missing`
- `window.__ModuleLoader__ bootstrap facade is missing`
- lazy-loaded chunk externals fail to resolve after a DSH upgrade

**Host-service contract changes also break plugins** — audit every host API
your plugin consumes after a DSH upgrade, not just the client surface. See
`references/session-projection-contract-011.md` for the 0.1.0-rc.6 → 0.1.1
`sessionProjections.register` contract change (`schema`/`view` →
`stateSchema` + `wire.viewSchema`, cold reads call `stateSchema.parse`) and
the dual-contract registration shim that serves both host lines.

### Browser-realm service rename: `settingsScope` → `configForms` (0.1.7-rc.2)

The seam was **replaced, not aliased** — and the API moved with the name:
`bind({ namespace })` → `get(entryId)`, writes return `Promise<boolean>`, and
registration is now `whileServed`. Version boundaries, declared-at paths, the
measured fallout and the upgrade recipe: `references/browser-realm-seam-rename.md`.

`settingsScope` is **0 hits in the whole 0.1.7-rc.2 and 0.2.0-rc.2 trees** except
`.agents/notes/**` prose (one *implemented* note still names the old symbol — a
stale doc, not evidence; trust the code). An ecosystem plugin that lists
`settingsScope` in its client `export const inject = [...]` stays **PENDING
forever** (cordis required inject has no timeout), so its whole browser half
silently never mounts — no error, no crash, just a missing UI. Cascades outweigh
counts: where a compat shim wraps the seam, every sibling that falls back to
that shim dies with it (measured numbers in the reference file).

### Three edges, not one — and two planes a Context diff cannot see

Scan **every tree in the corridor**, not the two endpoints: the same 0.1.5-rc.2 → 0.2.0-rc.2 delta splits across three edges, and mis-attributing them makes the migration plan wrong.

| break | first version it is gone | how it was pinned |
|---|---|---|
| `settingsScope` (client seam) | **0.1.7-alpha.1** | present in 0.1.6-alpha.1 (`packages/client/ui-settings/src/client/settings-scope.ts`), replaced by `config-form.ts`; `configForms` grep = 0 files in 0.1.6-alpha.1 vs 56 in 0.1.7-alpha.1 |
| `dsh-code-runtime` (`CodeRuntime`/`CodeRunRequest`/`CodeRunResult`) | **0.1.6-alpha.1** | `packages/code-runtime/code-runtime` still exists in 0.1.5-rc.3; 0.1.6-alpha.1 has `packages/ptc-runtime/ptc-runtime` + `-node` instead |
| peer-floor **enforcement** (install refused exit 1 / rows disabled at startup) | **0.1.7-rc.2** | `plugin-compatibility.ts`, `compatibility-preflight.ts`, `compatibility.json`, `--accept-risk` = **0 hits** in 0.1.5-rc.2, 0.1.5-rc.3, 0.1.6-alpha.1, 0.1.7-alpha.1; present from 0.1.7-rc.2 (and in 0.2.1-alpha.1) |
| `dsh.configTrees` / `dsh.profile.sessionFormatMigration` / `dsh.moduleFallback` removed, `dsh.manifestVersion` added | **0.1.6-alpha.1** | field-by-field read of `packages/util/package-manifest/src/types.ts` per tree |
| `dsh.profile.patchReload` removed | **0.1.7-alpha.1** | same file, next tree |

A card's edge label is the **upgrader's** version, not the mechanism's: `DSH-0.1.7-RC1-01` files peer enforcement under 0.1.7-rc.1 while the code first ships in 0.1.7-rc.2. Keep the card for the recipe, take the version from the tree.

**A Context-surface diff cannot see these planes — check them separately:**

- **Members.** `settings` exists in every tree, so the service diff says green; what actually changed is the *declaring file*: at 0.1.6-alpha.1 `packages/settings/settings/src/index.ts` is 894 lines with `export abstract class SettingsProvider extends Service` (`register<Namespace,T>()`), at 0.1.7-alpha.1 it is 432 lines with `export class SettingsForms extends Service` whose module augmentation is `settings: SettingsForms` and whose only surface is `describe`/`update`/`replace`/`mutate` — namespaces are now derived from Loader entry ids. Read the exported class + method names per tree whenever you consume a *method*, not just a service name.
- **Manifest fields.** `dsh.*` keys are JSON contract, not TypeScript surface; the same script that diffs the Context surface never looks at them. Diff `package-manifest/src/types.ts` (and your own `cordis.patch.yml` seeds) per tree.
- **Deprecations are not removals.** `eventAt`/`snapshotEvents`/`ownEvents` carry `@deprecated Existing logic may remain unmigrated for now, but new calls are prohibited` from **0.1.6-alpha.1** (lint-enforced: the platform itself needs `oxlint-disable-next-line typescript/no-deprecated`) and are **still present** in 0.2.0-rc.2. A mere existence check marks them green while the platform forbids new calls; the replacement path is `ctx.sessions.registerMessageProjection()` + `foldSurface`/`deriveEventMessage`. Grep your own tree for existing call sites and file them as a migration item instead of a pass.
- **State your counting rule.** Platform scale numbers shift with whether `*.spec.ts` is scanned: `family-surface-audit.mjs:71` skips only `.d.ts` (so spec-only `interface Context` declarations count — 121/145 services at 0.1.5-rc.2/0.2.0-rc.2), while `diff-platform-surface.mjs` also skips `.spec.ts` (116/141). The delta is exactly those spec-only services (5 → 4). Add/remove tallies only reconcile at one rule (`−3/+28` and `−10/+64` fit 116→141 / 287→341). Quote the rule with the number, or a later audit will think one of them is wrong.
### Catching this class: diff the Context surface, then intersect with declared seams

1. Extract every service name from `declare module '@deepseek-ai/cordis' {
   interface Context { … } }` — from the installed host's
   `@deepseek-ai/*/lib/types/**/*.d.ts` **and** from the new tree's
   `packages/**` **plus `vendor/**`**.
2. Extract each plugin's **declared** seams from its shipped `.js`
   (`.map` excluded): `export const inject = [...]`, `ctx.inject([...])`,
   `ctx.get('name')`, and its own `declare module` block.
3. A consumed name present in the old surface and absent from the new one is a
   real break; a name absent from **both** is almost always the plugin's own
   service or a `ctx.get` optional read — not a finding.

Three traps that produce wrong answers:

- **Scanning only `packages/` invents removals.** Services provided by
  `vendor/` look deleted; `loader` (`vendor/loader/src/index.ts`) was wrongly
  indicted this way. Always include `vendor/`.
- **Grepping raw `ctx.<ident>` invents breaks.** Minified bundles use `ctx` for
  a canvas 2D context (`fillRect`, `drawImage`, `globalAlpha`) and for acorn's
  parser state (`indent`, `argList`, `column`). Use the declared seams above;
  treat raw `ctx.x` hits as candidates needing a read, never as findings.
- **PowerShell `Out-File -Encoding utf8` writes a UTF-8 BOM**, so piping
  `gh api` JSON to a file and `JSON.parse`-ing it throws `Unexpected token` on
  the first character. Strip the leading U+FEFF before parsing.

Also check what a *profile* pins: a platform package installed at
`profiles/<name>/node_modules/@deepseek-ai/…` loads that old copy even on a new
host, so its consumed contracts need the same check.

### The community card corpus is a SECOND source — reconcile against it

`oh-my-dsh/dsh-plugin-upgrade-skill` (clone it once: `git clone https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill`; on this machine it lives at `D:/dsh/dsh-plugin-upgrade-skill`) turns every known DSH breakage into a **card**: symptom → migration recipe → verification → upstream source link, filed per version edge under `skills/plugin-upgrade/references/` (243 cards covering 0.1.0-rc.8 → 0.2.0-rc.1; `v<version>.md` per release plus big `jump-<from>-to-<to>.md` edges; some edges carry a deliberate **negative-evidence** card, e.g. `DSH-0.1.5-RC2-06 · no Host-plane surface moved on this edge`).

**Rule learned the hard way: a source-level diff is not enough.** Existence/symbol checks cannot see *consequences*. Reading the cards after my own 0.1.5→0.2.0 audit added seven real gaps, including three that change the plan: peer ranges are **enforced at install and startup** (rows silently disabled, installs refused) with a documented `allow-version … --accept-risk` + `compatibility.json` escape hatch; the settings migration needs **`.volatile()`** on each editable `Config` field (without it a namespace has no writable fields); and `dsh.bundle.patch` became `string | string[]` while `dsh.profile.patchReload`/`configTrees`/`sessionFormatMigration`/`moduleFallback` were removed. For the 0.1.5-rc.2 → 0.2.0 corridor the load-bearing cards are J1-01/RC1-01/0.2.0-RC1-01 (peer enforcement), J1-04 + J1-27 (settings host + client), J1-02/J1-16 (PTC rename ledger), J1-15 (bundle manifest), J1-03 (agent presets split), J1-10 (subagent runtime), J1-05 (session V4 + attachment carriers).

Four tools ship with the corpus (`skills/plugin-upgrade/scripts/`, described in the corpus's `skills/plugin-upgrade/scripts/README.md`): `plan-migration.mjs` (read-only, turns cards into a first-pass plan), `verify-runtime.mjs` (**not** read-only: installs into an isolated temp profile and cold-boots with a dead model endpoint; POSIX only; run untrusted plugins in a container), `inject-lint.mjs` (read-only: removed-inject residue, peer completeness, and **raw WebServer registrations flagged for manual auth review**), `ghost-host-check.mjs` (read-only: is the running host older than the checkout — a *ghost* still running the old code; exit 1 = ghost). Whole-fleet sweeps have their own checklist: `skills/plugin-fleet-sweep/references/fleet-sweep-checklist.md`.

**The cards are only half the corpus — the framework files carry the migration-engineering half.** Read `plugin-upgrade/references/pre-flight.md`, `precision-checklist.md`, `migration-hygiene.md`, `troubleshooting.md`, `host-plane-probes.md`, plus `plugin-fleet-sweep/` and `dsh-upgrade-audit/` (with the corpus's `skills/dsh-upgrade-audit/references/audit-playbook.md`), and the 13 general countermeasures `R-01…R-13` in `rollup-0.1.2.md`. Judging a docs set card-by-card only, and skipping these, is how a 0.1.5→0.2.0 audit ends up **covered 3 / partially 20 / missing 13** at framework level while its static interface plane is strong.
The missing 13 are all migration engineering, and each can invalidate the plan: is the upgrade target the **host you are currently running** (R-12); never run the global host upgrade from inside a session on that host (stop every dsh process, install the pinned version from an external terminal); **baseline** before any write (mechanical-suite failures + fingerprints + HEAD + lockfile hashes, R-06); rollback baseline in a dedicated branch/worktree; ghost-host probe (`ghost-host-check.mjs`, exit 1 = the running process predates the checkout); explicit timeouts on every cold boot/smoke command; one editing pass, one deploy; a separate staging instance fed by `link:` (R-09); three-layer verification (whole-lockfile old-cohort scan, one assertion per touchpoint, one real cold boot through a full conversation round);
migration hygiene (`pnpm run clean` before build, `pnpm approve-builds --all`, the oxc/vite parser is stricter than tsc); a **revert sweep** (classify each withdrawn behaviour as migrated vs gone); fleet live sweep (bump the version *before* the build, then assert each plugin's DOM surface marker, console slot crashes, expected requests, interaction gating); npm `alpha` dist-tag for prerelease cohorts with `latest` kept for the stable host line (R-04). Two judging rules ride along: **a plugin `loads` ≠ it `works`** (works needs its surface marker in the DOM, and an unrun interaction gate is reported as *unverified*, never as *available*), and every finding cites card IDs / recipe numbers.
### One delta, four documents: the perspective-set audit

The same upstream delta answers four different questions, and this user asks for them as**separate, self-contained documents**（接口 → 功能 → 版本 → 能力/新要求）；交叉引用即可，别合并成一份。每份都要带判定分级（P0–P2 或 A/B/C）与「判据」列，并有一个边界节（静态面 vs 行为面、未实测项）。

1. **接口视角** — 我们消费的每个接口 × 「新树还在不在」，逐条给位置、调用形态、判定。工具：`D:/dsh/audit-v44/family-surface-audit.mjs`（TS 面：导入符号／服务／缝调用／事件名）＋ `family-nonts-surface.mjs`（manifest 与 yml/json 里的平台包引用）。
2. **功能视角** — 功能项 → 它骑的接口 → **爆炸半径**（一个接口没了会带走哪些功能）。按产品能力分组而不是按包分组；反查表才是排优先级的产物。调用点证据用 `interface-sites.mjs`（接口 × 文件:行）。
3. **版本视角** — 声明支持线（`release.yml` 的 `PLATFORM_VERSION` 唯一来源；`verify-platform-ranges` 只接受 `^<version>`，且 prerelease caret 不放行别的线）vs 最新版，再做「我们消费的接口 × 本机各版本树」矩阵：`version-matrix.mjs`。**报逐跳差异计数**——它才能指出「唯一的破坏发生在哪一跳」。
4. **能力视角** — 平台自己的分包组（`packages/README.md` 的 group 表）× 新增服务/包，再对每个落在我们域内的新能力判 A 必做／B 建议／C 观察，每条配一句判据。官方 release notes 用 `gh api repos/<repo>/releases/tags/dsh-v<ver> --jq .body` 取原文（引原文、不转述）。

**三类必错的假阳性（不排必反结论）**：① 家族自有包名（镜像里 `@deepseek-ai/dsh-evolution-*`／发布成 `@lmzhen/*`）会被读成「新树没有的平台包」；② 旧侧若是**脏 overlay**，家族包会被算成「平台删除」——两侧都按 `git ls-tree -r --name-only dsh-v<ver>` 过滤；③ 裸 `ctx.<ident>` 会混进 cordis 核心 API（`effect`／`get`／`inject`／`logger`…）与家族自有服务——「平台服务」只取两棵树 `declare module '@deepseek-ai/cordis' → interface Context` 成员的并集。

本机跑过一轮的实测数字、四个差异项与 A/B/C 要求清单：`references/family-window-audit-0.2.0.md`。
### Run the diff source-vs-source, and verify the old side is really upstream

`scripts/diff-platform-surface.mjs <oldRoot> <newRoot> [--tag dsh-v<ver>]` does
this: prints both sides' service/package counts with their scope, lists what was
added and removed, warns when the old tree is a dirty overlay, and exits 1 on any
removal so it can gate a review.

The installed `.d.ts` tree is a **derived** lens: it only contains what is
installed by default, so optional providers vanish from the old side and the
delta silently misses them — one such pass lost an entire optional sandbox
family that the source diff found. Use two source trees whenever both exist.

A local "0.1.x source mirror" may not be upstream — it can be an **overlay
working tree** of the release tag with the user's own packages dropped in.
Check before scanning:

- Detect it with `git -C <tree> status --short` and
  `git -C <tree> ls-files --others --exclude-standard`.
- Restrict the old-side scan to tag-tracked paths:
  `git -C <tree> ls-tree -r --name-only dsh-v<version>`. Unfiltered, the overlay's
  own packages read as "deleted in the new release".

Two extractor bugs worth pre-empting, both of which invented findings:

- **Attribution by distance.** Matching `declare module '@deepseek-ai/cordis'` to
  an `interface Context` within N characters hides services whose JSDoc is
  longer; `loader` (provided by `vendor/loader/src/index.ts`) looked deleted.
  Attribute each `interface Context` to the *nearest preceding* `declare module`
  with no other `declare module` in between, and always include `vendor/`.
- **Raw `ctx.<ident>` greps** (covered above) — keep using declared seams.

- **Verifying citations: read SMALL WINDOWS, never the whole file.** The file reader silently truncates a large file (a 1869-line source came back short), so a line-by-line check reports "no such line" for lines that DO exist and you "correct" a correct document. Read `offset`/`limit` windows around each target line instead, and when a whole-file scan says a symbol is absent, re-check with a windowed read before believing it.
Report the scope with the numbers ("packages + vendor + apps, source vs
source") — service and package counts move by dozens depending on whether
`apps/` and `vendor/` are in scope, and a number without its scope is unusable
for the next comparison.

> 详见 references/protocol-history.md — 各版本模块系统面对照（旧页面全局 vs `ctx.modules`）
## Diagnosis checklist

1. Check the actual runtime version:
   ```bash
   dsh --version
   ```
2. Check the installed plugin version and its declared DSH range:
   ```bash
   node -e "console.log(require('./node_modules/<plugin>/package.json').version)"
   ```
3. Check whether the host still exposes the old global by grepping the served
   frontend bundle:
   ```bash
   grep -R "__DSH_MODULES__" <dsh-web-frontend>/dist/assets/*.js
   ```
   (Empty match on a new DSH means the global is gone.)
4. **Web UI rendering crashes** (composer vanishes, text stops rendering
   after a reply) get a host-side-first exclusion pass before touching the
   client: see `references/web-ui-rendering-diagnosis.md` for the verified
   checklist (projection snapshot probe, response-schema widths, event
   envelope fields) and the live-reply observation technique.
   - **Fastest first step**: the browser Console line `slot entry crashed in
     '<slot>'`. But `NotFoundError: Failed to execute 'removeChild' on
     'Node': The node ... is not a child of this node` is the fingerprint of
     **Chrome page translation mutating the DOM** (it wraps text nodes in
     `font`/reshapes the tree), which makes React's reconcile throw and
     unmounts the slot — NOT necessarily a plugin bug. Rule out browser
     translation before blaming any plugin.
   - **Bisection pitfall**: every round MUST hard-refresh (`Ctrl+Shift+R`);
     a stale page from a disabled config can masquerade as a still-broken
     state and wrongly indict an innocent plugin. Confirm the refresh
     happened before trusting a "still crashes" result.
   - **Establish a user-confirmed good baseline first**, then narrow from
     it — don't churn on a working state hunting the culprit. See
     `references/web-ui-rendering-diagnosis.md` for the resolved case: the
     four conversation-hook plugins were innocent; the real cause was
     Chrome page translation, caught only when the user noticed the crash
     correlated with the translate toggle.
   - **When editing `cordis.patch.yml` to disable rows, keep it a valid
     top-level YAML array.** Removing the last `- id: x / disabled: true`
     row and leaving only comments breaks boot with
     `overlay ... must be a top-level YAML array of loader patch entries`.
   - **Vitest: `Failed to resolve entry for package "@deepseek-ai/..."` is
     usually a toolchain issue, not your code.** Check the actual Vite
     version Vitest resolved to (`node_modules/.pnpm/vite@8.*`). If Vite 8,
     the `vite-tsconfig-paths` plugin is DEPRECATED and no longer applies —
     Vite 8 natively supports `resolve.tsconfigPaths: true` (it reads
     `tsconfig.json`, which `extends tsconfig.base.json`). Fix by removing
     the plugin and setting `resolve.tsconfigPaths: true` on the outer
     defineConfig AND on every `test.projects` entry (projects do NOT inherit
     the outer resolve). See
     `references/vite8-tsconfigpaths-migration.md`.
     Keep the comment block but leave `[]` as the (empty) array root. Verify
     with `dsh --profile web --dump-config` after any patch edit — it
     exits 0 only when the patch parses; a comments-only file exits 1.
5. Check the plugin's `dsh.client.inject`:
   - Old protocols only need `@deepseek-ai/dsh-client-runtime`.
   - New protocols need `@deepseek-ai/dsh-client-modules` in the inject list.

## Compatibility audit for multiple plugins before install

When checking several candidate plugins against each other and against an
existing profile, do a static audit before installing:

1. Know the baseline: `dsh --version`, the profile `package.json`
   `dsh.profile.bundles`, and the profile `cordis.patch.yml`. When the ask is instead "list every
   plugin this client has installed", treat it as a four-layer roster reconciled against the running
   process — see 「Enumerate the installed roster」 below.
2. Clone or read each candidate; inspect `package.json`
   (`dsh.client.inject`, `peerDependencies`, declared version), and the
   bundle's `cordis.patch.yml` (inserted row ids/names).
3. Gather all inserted row ids/names from every installed bundle
   (`node_modules/<bundle>/cordis.patch.yml`) and compare. Duplicate inserted
   ids break boot; the same plugin `name` across layers causes runtime
   shadowing.
4. Check for collisions in HTTP route paths, model-facing tool names, prompt
   section names, client slot names/ids, and input-trigger sources. UI slots
   often accept many registrations, but duplicate ids and duplicate web routes
   can hard-fail.
5. Verify every host service the plugin injects/uses actually exists in the
   installed DSH line (`ctx.tools`, `ctx.subagents`, `ctx.fs`,
   `ctx.webServer`, `ctx.sessions`, `ctx.web`, `ctx.systemPrompt`, etc.).
6. Separate runtime prerequisites (Node/Python versions, `npx`, network)
   from plugin-vs-plugin compatibility.

### Enumerate the installed roster (and prove it describes the running client)

Four layers, not one — `node_modules` alone answers a different question:

1. `profiles/<name>/package.json` → `dependencies` (what is installed) **and** `dsh.profile.bundles`
   (what is mounted). A dependency without a bundle row never mounts; a bundle row without a
   dependency resolves from the platform install.
2. `<bundle>/package.json` → `dsh.bundle.patch` → that patch file's `- insert:` rows = the entry ids
   that actually enter the composition. Meta-bundles inflate: `@lmzhen/dsh-evolution-all` is ONE
   dependency that inserts 26 rows while pulling 30 family packages into `node_modules`.
3. Overlay layers, last wins: `~/.dsh/cordis.patch.yml`, then `profiles/<name>/cordis.patch.yml`.
   `disabled: true` there is the only honest way to report a plugin as off; also report rows that are
   mounted but switched off inside their own bundle (`enabled: false`, `disabled: true`).
4. Platform bundles (`@deepseek-ai/dsh-base`, `dsh-web-app`, `dsh-experimental-*`) ship inside the
   app/global install, not in the profile's `node_modules` — list them separately from user-installed
   plugins instead of counting them as installed third-party.

Prove the roster describes the RUNNING client rather than a stale file: the host process command line
names the profile directory, the process start time must be ≥ every config mtime, and the boot log's
client-bundle list corroborates which client halves are live. Exact commands, the desktop path map and
the traps (CJK `package.json` breaking `ConvertFrom-Json`; transitive build deps such as
`@oxc-project`/`@rolldown`/`@yuku-*` are not plugins): `references/installed-roster-inventory.md`.

### Judging "does this plugin support my DSH version?"

Two rulers disagree — know which one you are quoting.

- **The npm/pnpm peer range is not an install gate here.** pnpm 11 defaults
  `strict-peer-dependencies=false`, and a web profile's `node_modules/@deepseek-ai`
  holds only a handful of packages (`cosmokit`, `dsh-brand`, tool packages). Host
  packages live in the GLOBAL install at
  `<global npm root>/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-*`, so plugin
  `peerDependencies` on `@deepseek-ai/dsh-*` are largely decorative in a profile.
- **The ecosystem's own ruler** is `dshmarket/lib/check.js` + `lib/compatibility.js`.
  `check.js` states: diagnostics use npm's default prerelease rule (a prerelease
  version satisfies a comparator set only when some comparator shares its
  [major,minor,patch] tuple AND itself carries a prerelease), while the discovery path
  may opt into `includePrerelease`. `compatibility.js` treats `aboveMax` as a **risk
  only when the author wrote an explicit `<`/`<=` or an exact pin**; `^`/`~`-derived
  bounds and unbounded `>=` stay warnings.

So "declared range excludes the installed version" is usually a warning, not a blocker.
**Real blockers are structural**: a `cordis.patch.yml` row or `dsh.client.inject` entry
naming a package absent from the installed line. Check against the global install AND
the release source tree before declaring a plugin unsupported.

Measure a range; do not eyeball prerelease rules — npm's own semver is the ruler:

```powershell
$a = @('view', '@deepseek-ai/dsh@>=0.1.2-rc.1', 'version')  # array splat: a bare
& npm.cmd @a                                                # '>=' arg gets mangled
```

Also note: GitHub repos in this ecosystem often default to `master`, not `main` —
resolve `default_branch` via the API before concluding a file is missing.
Fetching a raw file from the wrong branch returns 404 and silently becomes `null`.

### Pre-install gate: an inject entry is a module or a seat — they fail differently

- **A package/module name** must exist in the platform install — resolve it under
  `<global npm root>/@deepseek-ai/dsh/node_modules/@deepseek-ai/<name>` (a profile's own
  `node_modules/@deepseek-ai` holds only a few packages, so look in the global tree).
- **A service/seat name** must be *provided* by some mounted plugin. If none provides it, the entry stays
  `pending` **forever** and the plugin never activates — and the failure is **client-side only**: the host
  log stays clean (0 `did not activate`, 0 Error) while the GUI shows
  `Failed to load plugins — web boot: 1 entry did not activate: <pkg>: pending (waiting for service: X)`.
  Measured 2026-10-11: `@linxin666/dsh-doctor@0.3.24` declared `settingsScope`, a seat 0.2.x removed
  (replacement `configForms`), with no newer release to upgrade to. Never conclude "boot is clean" from the
  host log alone — read the client's boot report (the GUI banner) as well.
- **`ctx.get("X")` is not an inject.** A legacy service fetched *optionally* and followed by an explicit
  fallback is safe: `@linxin666/dsh-client-ui-skin-center@0.4.6` and `@linxin666/dsh-usage@0.4.6` still call
  `ctx.get("webUiSettings")` but fall back to `ctx.configForms`, and both activate on 0.2.0-rc.2. Grep the
  shipped bundle for the name and read the following line before calling it a blocker.
- If `plugin remove/add` dies with pnpm's internal `handleResolutionPolicyViolations` error, edit
  `dependencies` **and** `dsh.profile.bundles` in the profile `package.json` by hand — those two
  declarations are what the loader reads — then restart and re-check the client boot report.

Fast gate for a candidate: `npm view <pkg> version 'dsh.engines' peerDependencies 'dsh.client.inject' --json`
→ compare `dsh.engines.dsh` with the installed version → resolve every inject name as above → read the
bundle's `cordis.patch.yml` (a single `- insert:` row is the standard shape) → install, restart, verify
**both halves** (host-side state files *and* the GUI panel). Automation: `scripts/plugin-preflight.mjs`. Measured verdicts for the dsh-web 0.4.6 line (skin-center / usage / pet on 0.2.0-rc.2) and why they pass where doctor failed: `references/dsh-web-0-4-6-on-0-2-rc2.md`.

### A discontinued inject entry is not automatically fatal

`dsh.client.inject` listing a package the platform has dropped (classically
`@deepseek-ai/dsh-client-runtime`, unpublished after 0.1.1-rc.2) is a strong smell, but
before calling it a blocker grep the plugin's own shipped client bundle for an actual
import. A maintained plugin can carry a vestigial inject entry while its client code never
references it — different risk class from a live import. Also compare against a working
plugin in the same profile: `dsh-better-sidebar@0.19.1` injects
`@deepseek-ai/dsh-client-modules` (new protocol) and `dsh-client-ui-slots` (resolved from
the frontend bundle), which is what a current inject list looks like.

### "Tool is not a function" is not proof the plugin failed to register

A plugin can register its agent tools and then actively mask them per session. DSH Vision
Router does exactly this: with session vision mode off it calls
tools.restrict({ deny: [...ownedVisionToolNames] }), so vision_describe reports
tools.vision_describe is not a function while the plugin is mounted, healthy, and present
in --dump-config. Before blaming registration, grep the plugin for a restrict/deny or an
authorization gate, then read the gate's enable condition (for Vision Router: the
composer's vision toggle, or an image in the turn via autoActivateOnImage). Tool absence
is a symptom of the gate, not of a broken install.

Registration and enablement are separate layers: an opt-in switch can add a tool name to
the surface with no restart (Vision Router's desktopScreenshot mounts vision_screenshot
live) even when the source comment claims a restart is required. Trust the observed tool
surface over the comment, and say so when they disagree.

### Declared capability is not preserved payload

Capability metadata says what a model *accepts*; it says nothing about whether the raw
bytes survive the layers in between. DSH Vision Router's deepseek-vision wrapper declares
inputModalities: ['text','image'] on its resolved model, yet its stream body is built
without preserveImageInput, so keepOriginalImages stays false and image blocks are
rewritten into tool-hint markers before delegation. A session on the wrapper route
therefore receives an attachment id plus a tool reminder — not pixels — while the same
model on its plain route receives the image itself.

Verify the FORM that arrived, not just the capability: an image delivered as pixels shows
up as an image content block with its dimensions; one that was bridged shows up as a path
or attachment id plus a reminder. When two routes differ, establish which route the
session is actually on before reasoning about what the model can do.

### Does the referenced package exist?

A patch row or `dsh.client.inject` entry naming an unresolvable package is a REAL blocker;
a peer-range mismatch usually is not. But `node_modules` alone is the wrong lens — client
modules may be installed packages OR baked into the served frontend. Check three lenses:
installed tree (`<global npm root>/@deepseek-ai/dsh/node_modules/@deepseek-ai/`), release
source tree (`packages/**`), and the frontend bundle
(`@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`) — `dsh-client-ui-slots` lives ONLY
in the third. Always run a control: a sibling the plugin already injects that demonstrably
works (`dsh-client-locale` is a real installed package). Control absent => the LENS is
wrong, not the package. Second transport rule: a raw.githubusercontent fetch can return
a SPURIOUS 404 (or ECONNRESET) through this machine's proxy — re-check with
`gh api repos/<owner>/<repo>/contents/<path>` before recording any file as missing.
Both failure modes here (wrong lens, lying transport) are the same root error: concluding
absence from a single failed probe.

### Auditing a third-party managed installer

Typical shape: download repo zip into `~/.dsh/<name>`, build, create a directory junction
in the profile, `pnpm add -w link:<junction>`, then REWRITE `profiles/<n>/package.json`
wholesale (`ConvertFrom-Json` -> `ConvertTo-Json -Depth 20`). Read the script before
running it; back up `package.json` + `cordis.patch.yml` first (the rewrite is
formatting-destructive). Verify with `--dump-config`: exit 0 and no duplicate inserted ids.
Host-half changes need a dsh restart — never restart the server the user is talking through
without asking.

See `references/post-install-verification.md`.

### Install pitfalls seen in practice

- Monorepo GitHub subpackages use pnpm's `#path:` selector:
  ```bash
  dsh plugin --profile web add "github:owner/repo#path:packages/the-plugin"
  ```
  Do **not** use `#main&path:...` — pnpm 11 silently ignores that fragment and
  may install the repo root instead. If the root also declares a `dsh.bundle`
  patch, remove the root package before adding the subpackage, otherwise both
  can insert the same row id and break the next boot.
- Back up the profile `package.json` and `cordis.patch.yml` before a bulk
  install.
- After install, verify composition:
  ```bash
  dsh --profile web --dump-config > /tmp/config.out
  grep -nE "id: (expected-row-id|...)" /tmp/config.out
  grep -E '^\- id:' /tmp/config.out | sort | uniq -d
  ```
  Exit code 0 plus no duplicate inserted ids means the loader composition is
  at least structurally sound.

See `references/multi-plugin-compatibility-audit.md` for a worked three-plugin
audit with the exact commands and checks used.

### Preset-scoped plugins

Some DSH plugins ship dedicated agent presets rather than global tool packs.
Detect them by looking for bundled `presets/*/agent.cordis.yml` and
`agentPresets.composedPreset()` / `tools.restrict()` / `tools/pre-execute`
guards in the plugin source.

- They are **mode/preset scoped**: only sessions that select that preset are
  affected; other presets/sessions keep their normal tool set.
- Inside the dedicated preset they may intentionally hide or deny most other
  plugin tools (shell, filesystem, search, etc.). That is a feature, not a
  coexistence bug — but it means those tools cannot be combined in the same
  novel-dedicated session.
- Check newer client layout APIs separately: a plugin may ship a V1 path that
  works on the installed host and a V2 path that requires a newer client API
  (e.g. `layout.acquireSidebarRail`). Search the installed DSH client packages
  before claiming full compatibility.

See `references/dedicated-preset-plugins.md` for the AI-Novel-Writer case.

## 平台契约：用编译器当审计员（编译期锚定）

源码里**手抄**的平台形状不会被任何门禁发现 —— 12k 行、123 用例全绿、`verify` OK 的重写工程，一旦把 tsconfig `paths` 指向**真实**平台声明，一次暴露 **35 条**契约错误（`exec.args` vs `arguments`、`subagents.start` 缺 `await`、`session.events` 不存在、工具 schema 用了 JSON-Schema 的 `required: [...]`…）。判据：**报错数＝缺陷数**，改动前的报错清单就是缺陷清单。

装好的 dsh 自带全量声明，可直接当编译目标：

```
<npm 全局>/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/types/*.d.ts
```

做法：① tsconfig `paths` 指向那棵树 + `moduleResolution: Bundler` + `allowImportingTsExtensions`（平台 d.ts 用带扩展名的相对导入）；② 让**生成器**拥有 paths 块并校验必取符号（符号消失即 fail ⇒ 平台升版＝加一条规则，而不是重新发现一类 bug）；③ 测试替身只提供**平台形状**（假 session 只给 `snapshotEvents()`，假 `start` 返回 Promise），否则契约测试失效。

运行期值（`SessionId(id)` 这类 brand）另需一条 Vitest alias 指向 `devkit/<pkg>-runtime.ts` 替身，替身行为按平台实现写实。

完整清单（类型树定位、必取符号、`defineTool` 为何不能类型互钉（TS2321）、九类已抓缺陷的症状→机制→修法、验收三步）见 `references/platform-contract-compile-time-anchoring.md`。

**★ Read the declarations *before* budgeting a design around a guess — "未实测" is a status, not an instruction to go build something.** A design log is expected to carry open items; the mistake is treating each one as work. Measured: an untested item (*"can this contribution be registered per-agent scope?"*) was settled by reading **two interfaces in the package's own `lib/types/index.d.ts`** — and the answer **overturned a cost the design had already written into its own trade-off table** (a *"0 event listeners → 1 listener"* penalty that turned out to be **avoidable**, because both registration surfaces take `text: string | ((context: AssembleContext) => string)` — evaluated per assembly — so a **single global registration** is enough and the per-agent re-registration path is never needed).

⇒ A one-file read beat both a live experiment *and* the workaround it would have justified. Two habits follow: **(a)** when a design says "needs testing", first grep the dependency's `.d.ts` for the exact question — it is often answered verbatim in a doc comment; **(b)** when it *is* answered, **go back and delete the cost you budgeted for the guess** — a stale trade-off row is worse than the missing fact, because it keeps justifying architecture that is no longer needed.

### ★★ 加闸之前先问：这件事有没有**运行期权威**可问？

**判据（用一次事故换来的）**：*能问真品的，都不要写成静态扫描。* 静态规则只该留给**没有运行期权威可问**的问题。

- **反例（该发生过的形态）**：一条手写的方言闸宣称"出参必须用标准 JSON Schema，`required` 是名字数组"——而**名字数组是编译器的\*产物\***，作者写它会被**拒收**。这条闸主动要求的形状恰好是编译器拒绝的形状 ⇒ **整个插件在宿主上不激活**，而它**自己就是复核读的那个"证据源"**，于是四轮独立复核全被它骗过。
- **正例（同一个问题该怎么写）**：把它换成**动态闸** —— 让 5 个工具声明逐个过**真编译器**，再在**真 `Context` ＋ 真 `apply()`** 上观测**注册面**（不是扫源码文本）。"注册了但没有这个面"这类缺陷，静态闸**永远看不见**。

**⇒ 落地判据（一句话）**：加静态条目前先问 **"这句话能不能问真品？"** 能 ⇒ 去加动态闸；**只有"同一个概念被实现了几份"这类纯数量问题**才留静态条目（真编译器只会说"编译通过"，不会说"你写了几份"）。

**★ 写单一定义类规则时的坑**：要区分**定义**与**使用**。`defineTool: (o) => o` 是就地又造一份（违规），`defineTool: unitDefineTool,` 是正当引用（把公共替身传进去）—— **判别点是那个箭头，不是冒号**。用冒号判会把所有正当调用点误报成违规。

### ★★★ 去重之前先问：**它为什么是重复的？**

发现同一行在 5 个文件里**逐字符相同**，第一反应是"抽成共享函数"。**先别抽 —— 先问它为什么会被抄 5 次。** 实测：那 5 份抄写**不是马虎**，而是被一条架构约束逼出来的 —— 本仓的机械判据明确要求 `lib/tools/` **零 import**，所以那些文件**根本 import 不到**那个函数，只能就地写。

⇒ **直接抽成共享模块会破掉那条约束**（闸立刻报红），于是"修复"变成"换一处违规"。**正确的根治是\*注入引用\*而非\*搬迁定义\***：把函数挂到调用方本来就拿得到的那个东西上（这里是 `deps` 对象），**调用点保持零 import，实现只剩一份**。

**判据**：动手去重前，先确认**阻碍共享的那个约束是什么**。
- 约束不存在 ⇒ 直接抽共享模块。
- **约束存在** ⇒ 找调用方已有的**注入通道**（依赖对象、上下文、工厂参数），把引用递进去。
- 两者都不可行 ⇒ 那这份重复是**有意的**，**如实记录理由**，不要为了"好看"破约束。

**★★★ 而注入通道存在，不等于注入是划算的 —— 先数调用点，再决定。**
实测：复核建议把某文件里手工复刻的谓词改成"从 deps 注入真品"。**通道确实存在**（那个工厂本来就收一个 `deps`）⇒ 按上一条该做。**但先数了一下调用点：13 处**（1 个生产点 ＋ 12 个测试夹具，其中一个测试文件里就有 9 处）。**给 deps 加一个\*必传\*的新键，就要改 13 处** —— 按同一条判据（*同一类变更再来一次要改几处？1 处＝根治，>1 处＝补丁*）**那本身就是一次反向的补丁**。

⇒ **结论：那份重复是\*有意的\*，处置是"记账"而不是"修"**：在两处复刻点各写清 **① 被哪条约束逼的（此例是零 import 规则）；② 注入修法的\*实测\*代价是 13 处；③ 将来要收，正确做法是先加注入通道、\*一次性\*改完 13 处，不是只改一行。**
⇒ 并把被误解的那句自我声明**限定作用域** —— 一份文件里写"这里绝不重定义"，被复核读成了全仓法规，于是他拿它去点了别处的名。**"本文件的纪律"和"全仓的规则"要在字面上分开**，否则你的注释会替你制造一条你没立过的规矩。

**★ 推论（比这一条更一般）：复核给的是\*发现\*，不是\*指令\*。** 每个建议都要拿同一把尺子量一遍代价；**代价高于收益时，正确的动作是"如实记录为什么不做"，而不是"照做"** —— 照做会把一个 P2 的洁癖换成一打被惊动的调用点。反过来说，不做的理由必须**算出来**（"13 处"），不能是"我觉得没必要"。

### ★★★ 冻结区／活跃链的分野要在\*动手之前\*判，不是在核验时判

一个项目常常把文档分成两半：**活跃链**（要跟代码同口径）与**冻结历史**（明令不追改）。实测我犯的错：改完一处旋钮后**顺手**同步了一份文档，随后跑分类器才发现 —— **那份文档在冻结区，而规则白纸黑字写着"不追改"**。
⇒ **回退它，并在活跃链里如实挂账**：_「`<冻结文件>:<行>` 未改 —— 它在冻结区，按约束不追改，故那里的旧名字是**已知且有意保留的陈旧引用**。」_ **这比偷偷改掉它诚实，也比不管它有用** —— 下一个读者 grep 到那个旧名字时，能读到"这不是漏改"。

**判据（动手前问，一问一秒）**：**这个文件属于活跃链还是冻结区？**
- **冻结区** ⇒ **只读**，任何"顺手同步"都是违规；分歧写进活跃链。
- **活跃链** ⇒ 必须同步，**少改一处就是"文档与代码不一致"**，而那是独立的一类缺陷。

**★ 顺序上的教训**：我那个分类器**本来是核验步骤的一部分** —— 它确实抓到了违规，但**是在违规已经落盘之后**。**同一件工具，往前挪一步就从"事后发现"变成"事前拦住"。** ⇒ 凡是有"改哪些文件"清单的活，**先跑一遍分类**再动手。冻结区里往往还有你\*\*没逐个判过\*\*的文件，别假设上次判过就这次也安全。

### ★★ 规格有多个面时，\*\*一个面的决定不迁移到别的面\*\*

实测：一个旋钮同时挂着两件事 —— **(a) 它在设置界面里有没有入口**，**(b) 它背后的机制存不存在**。设计文档对 (a) 有明确决定（*"用户没有据此决策的场景 ⇒ 出局"*，并把它列进"砍项"），而对 (b) 是**另一份文档要求它存在**、且要求把它的边界写进用户文档。**只读到 (a) 就会去把整个东西砍掉 —— 而正确动作是实现 (b)。**
⇒ **判据**：看到"这个东西被砍了"时，先问**砍的是哪个面** —— 暴露面（控件／开关／文档可见性）与机制面（它实际做的计算与副作用）**各自有独立的决定记录**，**要分别去读**。
⇒ 反面同样成立：**机制在、暴露面被砍**是常见且合理的形态（默认值照常生效，只是用户不能调）。**"界面里看不到它"绝不等于"它不该工作"。**

### ★★ 在既有流水线里插一段之前，先读**插入点周围**——那里的约定不在任何规格里

设计一段新逻辑时，规格告诉你**做什么**；而**怎么做才不违和**只写在插入点旁边的代码里。实测：要给一条写链加"清理动作"，规格只说"在下一次 ingest 写链里清理"。**读插入点（`ingest.js:311-326`）才看到三条没写进任何规格的局部约定**：

1. **破坏性动作只落在成功路径上** —— 判定可以在提交点之前做，但**改数据的动作一律在提交点成功之后**（"拒绝时什么都没写"）；
2. **提交点之后最后一个 `await` 若抛错，降级成"不阻断 ＋ 可见字段"**（`capacityWrite = 'failed'` ＋ `logger.warn`），**而不是把整次调用报成失败** —— 原话：*"记录落盘是既成事实，淘汰没做成是可报告的降级，不是调用失败。"*
3. 那个可见字段**要真的声明进返回值**（否则降级只活在日志里，调用方看不见）。

⇒ **做法**：动手前把插入点**前后各读 20 行**，找**同类的邻居**（上一次做破坏性动作的地方），**照它的形状写**。**自己发明一套错误处理，会把一致性换成"看起来更严谨"** —— 而一致性才是下一个读代码的人依赖的东西。
⇒ 适用范围不止写链：**任何"往既有流程里插一段"的活**（中间件、钩子、清理、计数）都先找邻居。**规格描述意图，邻居描述惯例；两者都要。**

### ★ 上下文触顶时的诚实停手：连续两轮撞同一个约束 ⇒ 换会话，不是更努力

一条改动跨 N 个面时，**开始前先估"做完它需要多少余量"**。余量不够就**只做能完整收口的那一半**（实测的有效形态：把改动重排成"先加只增不改的那半，再删旧的那半" —— 中途停下时树仍是**完整的增量**，而不是半拆状态）。
**而如果同一个约束连着两轮成立，结论不是"下一轮更努力"，是换一个余量充裕的会话** —— 此时唯一有价值的产出是**把交接面写到可机械执行**：插入点 `文件:行`、要遵循的既有形状、要动的**面清单**、以及**已知的架构约束**（如"该目录零 import，所以只能靠注入"）。**交接写到这个程度，等于把工作从"需要判断"降级成"照着做"。**

**验证要数残留，不要看感觉**：改完 `grep` 旧形态在**代码**里的出现次数（注释与文档里的引用不算），期待 **0**；再确认新定义**只有一处**、且每个调用点都真的走了它。

### ★★★ 改了一个数或一个名字之后：**按模式扫，不要按记忆改**

实测漏掉一次，值得记。砍掉一个旋钮后，我同步了**代码 ＋ 四处活跃链文档** —— 而**漏了一份**。
漏的原因不是疏忽，是**方法**：我改的是**"我记得提到它的地方"**，而不是**"按模式扫出来的地方"**。
那份漏掉的文档，是**后来为了别的事打开它时**才发现的（它写着「14 个旋钮」，而实际已是 13）。

⇒ **规则：凡变更会让某个\*计数\*或\*名字\*失效，就按那个计数的\*模式\*扫一遍全部在册文档**，
而不是凭印象列清单。这和代码那条判据同源 —— *同一类变更再来一次要改几处？* ——
**答案是"扫出来的处数"，不是"想起来的处数"。** 记忆式同步**总是少覆盖**，
而且**漏掉的地方不会有任何征兆**：它安安静静地留着旧数，等下一个读者当真。

### ★★★ 扫出来的每一处都要判：**它在说"当时决定了什么"，还是"现在是什么"？**

同一轮里，模式扫出多处「14 个控件」，而它们**分属两类，处置相反**：

| 句子 | 类别 | 处置 |
|---|---|---|
| 「砍 4、**留 14** 个控件」 | **决策记录**（当时决定留 14） | **保留** —— 改了就是**伪造历史** |
| 「落地结果：共 **14** 个控件」／「§2.3 **14** 个控件」 | **当前状态陈述** | **必须跟着代码改** |

⇒ **判据一句话**：这句在说「**我们当时决定了什么**」，还是「**现在是什么**」？**前者冻结，后者跟代码。**
⇒ 配套：**这类扫描必须逐条判，绝不能批量替换。** 同一轮里有一处命中「四条…」的文本，
指的是「**四**个零 token 的工**具**」（四零一有），与「限制有**四**条」毫无关系 ——
**批量替换会把它改坏，而且改得很像一个正确修改。**

**★★★ 紧接着第二轮就出现了同一族的第二个实例，而且它把判据\*推到了更一般的形式\*：**
复核提了一条 P2 —— 某条诊断**恒报 `line: 0`**，修法也给了。核落点时发现同一处还有**另外两处 `line: 0`**，
而**那两处是对的、不该改**：它们报的是"**整个文件都没解析出来**"（找不到目标文档／找不到表的解析边界）——
**那种情况下本来就不存在某个具体行，用 0 是诚实的。**

⇒ **一般形式（比"逐条判"更可操作）**：
**一个哨兵值（`0`／`undefined`／`'unknown'`／`''`）在\*它所指的东西真的不存在\*时是诚实的；
只有当那个东西\*确实存在、只是没被算出来\*时，它才是缺陷。**

- `line: 0` 而**文件里有那一行** ⇒ **缺陷**（该算出真实行号）；
- `line: 0` 而**根本没解析出那个文件** ⇒ **诚实**（没有行号可言）。

⇒ **这条判据把"逐条判"变成了"问一个具体问题"** —— 对每一个命中处问：
**"它所指向的那个东西，此刻存在吗？"** 存在 ⇒ 改；不存在 ⇒ 留。
**批量替换的危险不在"改错文件"，而在"把一个诚实值当成不合格值修掉"，而修完看起来更规范了。**

**★ 顺带一条关于"什么时候值得只交方案不交代码"**：当任务被估成 **P2（诊断/文案级）却要动 5 个以上落点**，
而余量不足以**一次做完并验完**时，**最值钱的产出不是半成品，而是一份\*可机械执行\*的交接**：
逐落点写清改法，并**显式列出"哪几处明确不改、依据是什么"**。
实测这样交出去的方案，新会话照着做**不需要重新判断** —— 它把"需要判断"降级成了"照着做"，
而那份"明确不改"的清单，正是防止下一个人把它当漏项补上的东西。

### ★★★ 有些文档不是散文，是**闸的输入** —— 动它们等于动代码

本仓的机械判据**会读设计文档**：某条闸解析一份指定的设计文件、按表头与收尾标记切出码表，再与实现双向对账。
⇒ **改那份文档，就是在改一条闸的输入。** 实测两轮里都改了同一份文档（一次改一段历史陈述、
一次改一句过时的键名），**两次都专门重跑了那条闸** —— 结果 `通过/0`，确认表边界与解析都没被碰坏。

**⇒ 规矩：改文档之前先问"有没有闸读它"，改完\*\*必跑那条闸\*\*。**
- **读它的闸**：文档里通常自己写着（"这条判据读 `design/13` 的码表"）——**照那条线索找**，别猜。
- **改完必跑**：文档类改动看着"不涉及行为"，但**它可能正是一条闸的权威输入**，
  而解析靠的是**表头与收尾标记**（`| # | code | 载体 |` … `**表读法**` 一类）——
  **在表外新增段落通常安全，但你必须\*确认\*它在表外**，而不是假设。
- **判据**：`文档改动 ⇒ 跑读它的闸`，与 `代码改动 ⇒ 跑闸` **同级**，不是可选项。

**★★ 配套：找\*工具链真正读的\*那张表，不是\*看起来相关\*的那张。**
同一轮要给一个新模块"补登记"，我先把**模块清单表**补了一行 —— 然后才在文档里读到另一处写着
**某条闸检查的是\*\*允许-import 白名单\*\***，而那张表按文中的措辞是**规范性**的（"不在列内的东西一律不许出现"）。
⇒ **前者是给人读的，后者是给闸读的**；只补前者，等于补了一张没人校验的表。
**⇒ 做法：补登记前，先在文档里搜"哪条判据/闸提到了这张表"** —— 一句话的搜索，
把一个"看起来做完了"变成"确实做完了"。

### ★★★ 工具参数里的 Windows 反斜杠会让**整条调用作废**（报 `tool input is invalid JSON`）

实测踩到一次整轮运行失败。根因不是内容错，是**序列化**：JSON 字符串里 `\d` `\l` `\R` `\s` **都不是合法转义序列**，
而本仓的文档与命令里塞满了 `D:\dsh\loupe`、`lib\domain.js`、`design\12`、`%TEMP%\loupe-r6-lab` ——
**一个反斜杠字母组合就足以让整条参数判为非法 JSON。**

⇒ **写法规则分两面，别混**：
- **我\*新写\*的内容一律用正斜杠**（`D:/dsh/loupe`、`lib/domain.js`、`design/12`）——
  Node 与 Windows API 都接受，且**不引入转义风险**。
- **锚定\*既有\*文本时必须逐字复现**（既有文档里就是反斜杠）⇒ 这类锚点要么老实转义，
  要么**改用\*\*短、唯一、不含反斜杠\*\*的子串**（如 `[双端分家]` 这样的括号前缀）。

**⇒ 配套三条**：
1. **长文档改动优先 `write` 整文件**，少用 `edit` 的双大字符串 —— 每次编辑的**转义机会减半**。
2. **长命令行（PS 嵌套引号＋反斜杠）写进 `.ps1`／用 `write` 落文件再执行**，别塞进 `pwsh` 的单参数字符串。
3. **锚点失败时先怀疑锚点，不是先怀疑工具**：本仓实测 `remove` 类操作**接受子串**、
   而**替换类操作要整条逐字** —— 用错了就会得到"no entry matching"而以为是内容问题。

### ★★★ 而这次踩坑还带出一条更一般的：**改 bug 时，别把"要匹配的文本"一起改了**

实录：我在修"反斜杠破坏 JSON"时，**顺手把\*锚点\*里的 `D:` 后那个反斜杠也换成了正斜杠** ——
于是**锚点再也匹配不上**（报 no entry matching），而我去怀疑"内容不存在"。
**⇒ 修 bug 的那次修改，自己制造了下一次失败。**

⇒ **一般形式（值得单独记）**：当一条规则要求你改写文本时，
**要分清\*输入的文本\*与\*输出的文本\*** ——
- **输出的文本**（我新写的内容）：按新规则改写。
- **匹配用的文本**（锚点、要删/要替换的原句、grep 的模式）：**它必须保持\*原样\***，
  因为它的职责是**描述世界现在已经是什么样**，不是"应该是什么样"。

**⇒ 判据一句话**：**这次编辑里，这段字是"我要写出去的"还是"我要对上号的"？**
是后者 ⇒ **原样照抄，哪怕它违反你正在推行的新规则。**
**把规则用在锚点上，等于用"应该的样子"去匹配"现在的样子" —— 必然不中。**

**⇒ 配套（同一个病的另一面）**：**批量替换前，先确认命中的是不是\*语义同类\***。
本轮实测：同一份记忆里 `remove` 的 `。` 锚点**匹配到多条**（垃圾条目不止一个），
而 `「彻底完成」＝三件` **一条都不匹配**（替换类要整条）——
**两次失败的报错\*看起来一样\*（都是"匹配失败"），成因却完全相反**：
一次是**命中太多**，一次是**要求太严**。
⇒ **"失败"不是诊断，报错原文才是。**

### ★★★ 发布到 npm：`EOTP` 与**被掩码的认证链接**（实测一条可绕的路）

**症状**：`npm publish` 报 `npm error code EOTP / This operation requires a one-time password`，
并给一个浏览器认证链接 —— 但**它被掩成** `https://www.npmjs.com/auth/cli/***`。

**⇒ 关键判定：那三个星号是\*工具自己写进日志时\*就掩掉的**，不是宿主或终端干的。
实测三条路都拿不到真值：**控制台输出**、**把 stderr 原样重定向到文件**、**npm 的 `_logs/*-debug-0.log`** ——
**三处全是 `***`**（日志里连 UUID 形态的串都搜不到）。
⇒ **所以"再抓一次输出"这类努力是白费的，别在这上面耗。**

**⇒ ★★★ 但下一轮实测推翻了这个结论的一半，并给出真正的根因**：
**npm 只有在\*真 TTY\* 下才会走"弹浏览器换 OTP"那条分支；在捕获输出的子进程里它\*\*立刻重抛\*\*，压根到不了那里。**
本机 `npm/lib/utils/auth.js` 的 `otplease`：

```js
catch (err) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { throw err }   // ← 没有 TTY ⇒ 直接抛
  if (err.code === 'EOTP' && err.body?.authUrl && err.body?.doneUrl) {
    const { token: otp } = await webAuthOpener(
      createOpener(npm, 'Authenticate your account at'), …)         // ← 这里\*弹浏览器\*
```

⇒ **所以那个被掩码的 URL 是\*\*兜底产物\*\*，不是"唯一的路"** ——
`***` 之所以出现，正是因为无 TTY 时 npm 开不了浏览器，只好打印链接（并掩掉）。
**⇒ 正解：把这条命令放进\*\*可见的真控制台窗口\*\*跑。**
实测有效：`Start-Process cmd.exe -ArgumentList '/k', '<命令>'`（`pwsh` 与 `wt` 都可能解析不到，`cmd.exe` 必定在），
然后在那个窗口里 **npm 自己弹出浏览器 → 人按指纹 → 命令继续跑完**。

**⇒ 一般化的判据（不限 npm）**：**任何"需要人在场做 2FA/交互"的 CLI，都会用 `isTTY` 决定要不要走交互分支。**
**⇒ 用捕获输出的方式跑它，等于静默地关掉了那条分支** —— 而失败信息会伪装成"认证不可用"，
让人误以为是账号或网络问题。**⇒ 先问"这条命令我在什么终端里跑"，再问"认证为什么失败"。**

**⇒ 一条操作提醒**：`get_desktop_state` 截图**能读到那个终端的文字**（包括未掩码的 URL）——
在 Windows 上，**读一个可见控制台的内容，截图比任何输出重定向都可靠**。

### ★★★ npm 12 的"暂存发布"：`0.0.0-stage` 是**中间态**，不是故障，也不是别人占名

npm **12.0.2** 起默认走 *staged publishing*：`npm publish` 之后，registry 上会先出现一个
**`0.0.0-stage` 占位**（`"stub": true`、`"description": "Temporary package placeholder for staged publishing"`），
**真版本在约 1 分钟后落地**（本轮实测：stub `03:59:45Z` → 真 `0.1.0` `04:00:42Z`）。
⇒ **我在 03:59 那一刻读到 stub，差点把它报成"版本不对/有人占名"** ——
**那是一份\*发布进行中\*的读数，不是终态。**

**⇒ 判据：发布后的 registry 读数必须在\*\*它自己说"processing"之后\*\*再取一次，且\*\*取两次一致才算数\*\*。**
**⇒ 别让"抢在中间态取证"制造一个假故障** —— 它和"取证太晚漏了问题"是两种相反的错，都源于只看一次。

### ★★★ 用标题行当锚点 ⇒ **必然把正文悬空**（同一轮犯两次，第三次才立成规矩）

**实测形态**：`edit` 的 `old_string` 写成**小节标题**（`### ★★★ 第 110 轮：…`），
`new_string` 只写新内容、**没把那个标题重新写一遍** ⇒
**标题被消耗掉了，它下面那一整段正文失去归属，挂在\*上一节\*底下。**
**语法过、测试过、判据过 —— 没有任何闸看得见文档结构。** 同一轮里犯了两次。

⇒ **预防判据（比"改完回读形状"更靠前，因为它是\*动手前\*就能问的）**：
**我这次替换掉的这段字，是不是一个\*结构标记\*（标题 / 列表项 / 代码围栏 / 分隔线）？**
**是 ⇒ 替换文本里必须\*\*原样把它再写一遍\*\***；不是 ⇒ 才可以直接换掉。

⇒ **更稳的做法（推荐）**：**不要拿标题行当锚点** —— 锚点取**标题\*下面\*正文的第一句**
（或任何**非结构**的句子），这样替换天然不会吃掉标题。

⇒ **检测（动手后仍要做）**：回读时**不只确认它解析**，还要看
**"每个 `###` 后面紧跟的是不是它自己的正文"** —— 本轮就是用这条查出第二次悬空的。

**★ 附一个同族风险**：`edit` 的锚点若含**反斜杠**（Windows 路径），
**别为了"统一写法"把锚点里的反斜杠顺手改成正斜杠** —— 锚点必须**逐字复现**它要匹配的现状，
"应该的样子"匹配不上"现在的样子"。（这条本轮实测踩过。）

**★ 配套**：`npm stage list` 此时会显示 `No staged packages found` ——
**因为自动暂存的那一版不需要人工批准**（`npm stage approve` 是给\*\*显式\*\* `npm stage publish` 用的）。
**⇒ 看到 `stage list` 为空、而 registry 上有 stub，不要据此判定"发布丢了"。**

**⇒ 而有一条路能拿到：`npm login --auth-type=web`** ——
**登录流程打印的链接\*不掩码\***（`https://www.npmjs.com/login?next=/login/cli/<uuid>`）。
把它 `Start-Process` 出去、让人在浏览器里完成指纹／口令，**后台那条 login 会回 `Logged in on …`。**

**★★ 但登录成功 ≠ 能发布**：账号若是 `auth-and-writes` 级 2FA，**网页登录得到的会话令牌仍不足以 publish**，
**`npm publish` 会再次报 `EOTP`** ⇒ 那一次仍要 `--otp=<6 位>`。
**⇒ 别把"登录通过了"当成"发布能过"** —— 两者是两次独立的鉴权。

**★★ OIDC 工作流的一个致命写法（我当场写错又改回）**：
可信发布（Trusted Publisher）的 workflow **绝不能设**
`env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` ——
**设了会拿一个不存在的 secret 去\*覆盖\* OIDC 身份，发布必然失败。**
只要 `permissions: id-token: write` 在，`npm publish --provenance` 自己就会用 OIDC 换取权限。
**⇒ 判据：OIDC 场景下，"再补一个令牌更保险"的直觉是\*反的\*。**

**★ 顺带两条假象**：
1. `npm whoami` 成功**只证明令牌有效**，不证明能发布（是两次鉴权，见上）。
2. **PowerShell 会把 npm 写到 stderr 的 `notice` 行报成 `NativeCommandError`**，
   于是**命令明明成功、`$LASTEXITCODE` 却是 1** ⇒ **判 npm 成败看它自己打印的结论行，别看 PS 的退出码。**

### ★★★ `npm` 自己就有 `trust` 命令 —— 别去驱动网页表单

**代价实录**：为了给一个包绑定可信发布（Trusted Publisher），我去开了浏览器、
在 npmjs 表单里找控件、因坐标打偏把窗口最小化、又要用户按了一次指纹 —— **折腾了一整轮**。
而**本机 npm 自带**：

```
npm trust github [package] --file <workflow.yml> [--repo|--repository] [--env|--environment]
                            [--allow-publish] [--allow-stage-publish] [-y|--yes]
npm trust list   [package]      ← 列出该包已有的可信关系
npm trust revoke [package] --id=<trust-id>
```

（实现在 `npm/lib/commands/trust-cmd.js`；provider 另有 `gitlab` / `circleci`。）

⇒ **一般判据（不限 npm）**：**要对某个平台做一次"配置/绑定"操作之前，先问\*\*这个平台自己的 CLI 有没有这个子命令\*\*。**
平台把某件事做成了网页流程，**不等于**它没有 CLI 入口 —— 尤其当那个网页流程还要过人机验证时，
**去找 CLI 往往一次就过。** 这正是"先读平台自带文档/技能"那条在 **CLI vs GUI** 上的形态。

⇒ **配套**：`npm trust list` 同样会撞 `EOTP`（本轮实测）——
**它也是"要看认证"的命令**，所以上面那条"放进真 TTY 才会弹浏览器"同样适用于它。

### ★★ 更正一条我先前记错一半的：`repository` 字段**仍会被读、被校验**

我早先记的判据是"绑仓+workflow，**非 `repository` 字段**"。
**前半对（绑定的入口确实在 npmjs/CLI，不靠 package.json），但后半会误导** ——
`trust-cmd.js:175-182` 明确 `getRepositoryFromPackageJson(pkg)` **从 `pkg.repository` 推断 `user/project`**，
`:268` 还会在**与绑定不一致时比较**、`:294` 给出告警。
⇒ **`repository` 不是绑定入口，但它是\*被读取并被校验\*的输入。**
**⇒ 结论修正：「不靠它绑定」≠「可以不写它」。** 走 OIDC/provenance 发布时，
`package.json` 里该有的仓库字段要写全（本轮补上 `repository`/`homepage`/`bugs` 后重试）。

**★ 一条排错纪律（本轮用上，值得记）**：Actions 失败时，**日志里"成功的那半"同样是证据** ——
本轮 `Signed provenance statement … from GitHub Actions` ＋ `Provenance statement published to transparency log`
**证明 OIDC 身份已被接受**，所以那个 404 **不可能是"OIDC 没通"**，只能是**注册表对这次写入的授权/元数据**问题。
**⇒ 先把失败范围从"整条链路"缩小到"最后一步"，再去查那一步。**
**"哪一步成功了"和"哪一步失败了"一样能定位问题。**

### ★★★ 检验假设的方式：**把新报错与旧报错\*逐字\*比**

上一条说"成功的那半也是证据"；**这一条是它的孪生兄弟 —— 失败的那半也要求你把两次失败\*对齐着看\*。**

**实测**：OIDC 发布连续失败两次（`v0.1.1` 与 `v0.1.2`），**两次报错逐字相同**。
而这两次之间我改过一个**自认为很可能就是成因**的东西（补了 `package.json` 的 `repository`/`homepage`/`bugs`）——
**报错一个字没变 ⇒ 那个假设被\*\*证伪\*\*了，干脆利落。**

⇒ **判据**：**改完一个"我认为是成因"的东西之后，第一件事不是看它有没有好，而是\*把新报错与旧报错并排比对\*。**
- **报错变了** ⇒ 你动到了相关的东西 ⇒ 顺着新报错继续。
- **报错逐字未变** ⇒ **假设被证伪** ⇒ 不要再在同一个方向上加固（那会开始叠补丁）。

**⇒ 为什么这条值钱**：没有它，"改了一处、还是失败"最容易被读成 *"改得不够"*，
于是继续在同一个假设上加码 —— **那正是多层补丁嵌套的起点**（本仓明令禁止的那种）。
**把两次报错并排，是让"不够"与"无关"这两个结论分开的\*\*唯一廉价办法\*\*。**

**★ 顺带**：`gh run view <id> --log-failed` 的输出很长，**用 `Select-String` 先筛出
`error|notice publish|E404|provenance` 这类行**再读 —— 本轮两次失败的**全部**有效信息只有 12 行。

### ★ 覆盖核对要报"扫了什么范围"，不只报"改了哪些"

「改了 A/B/C」是**关于我已经做完的事**的陈述；「扫了 X 类模式、覆盖 N 份在册文档、命中 M 处、其中 K 处按冻结保留」才是**关于世界**的陈述。
前者**无法暴露漏项**，后者可以 —— **而上面那次漏项，正是因为上一轮只报了前者。**
⇒ 报告同步范围时，**"改了哪些"要和"扫了哪些范围"一起给**；只有前者时，读者无法判断你是不是又漏了。

### ★★★ 两条关于"自己写的代码"的教训（都来自同一个函数的同一行）

**① 文件头与实现互相打脸，比没有注释更糟。**
实测：一个模块的文件头写着「**只认 `agent.id`**」，而**紧接在下面一行的实现**是
`holder?.agent?.id ?? holder?.scope?.id` —— **一句话里立规矩，下一句话就给自己开例外**。写这两行的是同一个人，相隔不过几分钟。独立复核的原话：**"文件头与实现互相打脸"**。
⇒ **注释是\*声明\*，实现是\*事实\*。两者冲突时，读注释的人（包括三个月后的你）会被引到错的地方**，而且他会以为自己已经理解了。**规则：写下一条"只做 X"的注释后，回头读一遍紧跟的实现，确认它真的没有 `??`／`||`／`if` 之类的例外分支。** 这条检查只花几秒，而漂移一旦落盘，只有\*别人\*读你的代码时才会发现。

**② "今天不可达"不是"契约允许"—— 靠调用方恰好这么传，是在赌一个没写进契约的巧合。**
上面那条回退的**理由**曾经是充分的：平台唯一的装配调用点确实传 `scope: agent`（`dsh-agent/lib/index.js:291-297`），所以 `scope.id` 分支**永远不会生效**。**但"永远不生效"和"契约允许"是两件事** —— 该上下文类型是 **merge-extensible** 的，平台自己的类型注释就写明第三方可以构造它并直接调用你的 provider ⇒ **今天不可达的分支，明天可能被别人的代码走到**。
⇒ **判据**：一个防御性回退要留下，理由必须是**契约允许**（规范里写了这个输入形态），不能是**调用方恰好这么传**（观察到的实现细节）。观察到的事实要写进注释时，**标明它是观察**（"当前唯一调用点传 X"），而不是把它讲成契约（"X 就是身份"）。
⇒ 同族的第三种形态：**把平台当下的传参巧合写进注释当成规范** —— 实测有注释断言"从 `ctx.scope` 就拿得到会话身份"，而该类型的定义是 `ScopeKey = object`，**根本不是会话身份**；真正靠得住的是 `agent`。**引用平台行为时，引"哪个函数返回了什么"，不要引"某个测试文件第几行"**（那三处 `*.spec.ts` 在已安装的发行版里**并不存在**）。

### ★★★ 一条**不会变红的闸等于没有闸** —— 新闸必须做反向验证

绿色读数**不能**作为闸可用的证据：它可能只是**从没被触发过**。每加一条闸，当场造一个**真违规**，看它是否报红，再清理掉确认回到绿：

```
造出违规（就地写一份 (o) => o）  →  C-SINGLE-DOUBLE 违规/1   12/13
删除探针                      →  C-SINGLE-DOUBLE 通过/0   13/13    探针残留 False
```

**⇒ 没有这一步，"13/13 通过"与"这条闸根本没在工作"无法区分** —— 而这正是本项目栽过的形态（清单全清 ≠ 可发布）。同一原则的两个配套动作：**豁免要带反向守卫**（豁免了某文件，就得断言那份定义**真的还在**，否则定义一被删，闸会因为"别处没有定义"而全绿 —— 恰恰是它要防的事）；**夹具要有防空过守卫**（断言"两个面都真的被观测过"，而不只是断言计数）。

### 工具出参 schema 的方言：`required: true` 标在**属性节点**上，绝不能用 `required: [...]`

上面 35 条里那条「工具 schema 用了 JSON-Schema 的 `required: [...]`」值得单列 —— 它是**整条插件不可用**级别的。平台对工具 schema 有**自己的**值 schema DSL，**入参与出参走同一个编译器**（`defineTool` 里相邻两行：`parameterSchemaSpecToJsonSchema(options.parameters)` / `valueSchemaSpecToJsonSchema(options.output.schema)`）。DSL 的 `authorKeys` 只在 `task.allowRequired` 为真时收 `required`（`dsh-tools/lib/index.js:655`），而 **`oneOf` 分支**（:677）、**`array.items`**（:725）、以及 `compileValueSchema` 给出的**出参根节点**（:777）都传 `false`。

⇒ 出参 schema 里写成数组，**任何层级都非法**。两条症状：

- 分支里写成数组 → `JsonSchemaError: unsupported JSON schema: schema.oneOf[0].required is not supported by the value schema DSL`
- 非 `oneOf` 的顶层写成数组 → 同上，路径变 `schema.required`

**代价是整个插件消失**：宿主日志只留一行 `warning: 1 entry did not activate`，GUI 里该插件的设置页显示「这一页暂时读不到」，工具与命令**全部不存在** —— **没有第二条报错**。一个 schema 笔误 ＝ 插件完全不可用。

- **正解**：`required: true` 标在每个**属性节点**上（就是 `parameters` 的写法），由 `compilePropertyMap`（注释原文 "collecting per-property requiredness"）收集成编译后的标准 `required` 数组。
- **判定法**：别读文档、别信测试 —— 写个探针调**真的** `defineTool`，把候选写法各喂一遍，看谁编译通过。这是这条的唯一硬判据。

**三个把这条埋掉的陷阱（都要在插件仓里消除）：**

1. **测试替身让编译器从不运行。** 测试里 `defineTool: (o) => o` 这类替身（实测一个仓 6 处）意味着 DSL 编译器**一次都没被调用过** —— 没跑过的编译器不可能报错，于是 263 条用例 + 13 条门禁全绿而插件起不来。修法：至少一条契约测试走**真** `defineTool`（平台包可直接 import），并校验**编译后**的 schema。
2. **用错验证器会造出假 P0，而"修"它直接加重故障。** `validateJsonSchemaValue` 要的是**编译后**的标准 schema；把**作者面 spec** 直接喂它，`required: true` 会以 `"value" must be a lossless JSON value` 之类形状"失败" ⇒ 误判成"布尔 `required` 不合法" ⇒ 改成数组 ⇒ 插件从此起不来。**契约测试必须沿真实管线走（spec → 真 `defineTool` → 编译后 schema → 验证器），不能跳级。**
3. **★★★ 手写的"方言闸"不只是漏判，它会\*主动要求\*那个让插件起不来的形状 —— 而且它会变成后续每一轮复核的证据源。** 实测一个仓为此专门加了第 13 条静态判据（扫源码找 `required: [...]`，**方向写反**），于是五个工具全被改成编译器拒收的样子；此后**四轮独立复核全部读这条规矩、于是全部确认了错的东西**，直到装后实测才炸出来。
   ⇒ **看到这种闸，正解是\*\*删掉它\*\*，不是把它改对。** 它的存在本身就是症状（"没有让真品来回答"）；留着它就等于留第二份可以再次写反的事实源。撤除处留一段**墓碑**：写清它曾要求什么、真品要什么、以及"凡某层收不收这个形状，一律由那层自己回答"。

**★★ 由此得到一条通用的替身判据（比上面三条都值钱）：**

> **替身替换"外部效果"（文件读写、图像解码、时钟、网络）是隔离，允许；
> 替身替换"编译/校验/规范化"是把闸拆掉，不允许。**

同一个 `defineTool` 在一个仓里被判成前者（"平台边界，可替换"）—— 而它是**编译期权威**，不是效果。判据落到代码上：这类注入**不要给默认值**。实测那个仓的 `makeDeps(over = {})` 里写着 `defineTool: (o) => o` —— **默认值正是事故能发生的原因：有默认值，就没有任何调用点需要为"用真品还是替身"表态**。改成 `makeDeps(over, defineTool)`（必传、缺了就抛带解释的错）之后，每一处调用点都必须自己选。

**★ 顺序纪律（反了就会白干一轮）：** 先把真品接上、让闸**报出完整缺陷清单**，再改源码 —— 不是先手工改完再建闸。判据是「**报错数＝缺陷数**」：那份清单本身就是缺陷清单，照着它改不会漏第 N 处。先改后建，闸只能确认"我已经改的"，抓不到剩下的。

**★ 正面确认（"没有告警"不等于"活着"）：** 修完在真宿主上，**没有** `warning: N entry did not activate` 只是必要条件 —— 那是 absence of evidence。正面判据要么读插件自己的注册痕迹（工具/命令/配置命名空间真的在），要么走 GUI 看设置页那一节渲染出**控件**而不是「这一页暂时读不到」。

### 入口导出契约：`name` / `inject` / `Config` / `apply`（装载期，编译器看不见）

平台 `packages/AGENTS.md`：函数式插件**具名导出** `name` / `inject` / `Config` / `apply` 且**没有 default 导出**；服务包才 default 导出服务类。两种形态混用会让 Loader 取 `default` 并**丢掉函数插件的命名空间**——`inject` 静默失效（postmortem 0001）。

- 症状：行照常加载、行为看似正常，但必需服务晚挂载时不再等待，注册永久不发生，且**不报错**。`tsc` 与单测都不会发现：命名空间是运行期装载形状，测试通常直接调用 `apply`。
- 判据（逐入口模块一次）：`grep -n "^export default" <entry>.ts` 必须为空（服务包除外）；`name` 取该模块在 cordis.yml / patch 里的**行 id**；`Config` 写 `export const Config = <该文件已有 schema>`，**不改名**已有 schema（别处 import 它），模块本身没有 schema 时不要现造（会新增装载期校验与默认值语义）。
- `inject` 只列模块真正必需的服务：原版同行的顶层 `inject` ∪ 该行 apply 内 `ctx.inject([...])`（或类上 `static inject`），**再按本模块 `ctx.get('x')` 的实际读取收敛**；代码里 `if (!x) { warn; return }` 这种容忍缺失的可选读取不进 `inject`，空清单写 `export const inject: string[] = []`。
- 改完后 `apply` 的调用方（测试/其它 src）必须同步改成 `import { apply as applyX } from '...'`；漏改会被 vitest 直接报成 undefined 调用。

### 状态要落盘，而且要在正确的时点取比较基准（运行期，编译器同样看不见）

缺陷的两种同源形态，都会让「机制跑过但什么都没变」：**① 算完只报告、没写回**（把 lifecycle/状态迁移的结果拿去做提名或渲染，却不写进记录）——症状是报告里明明列出了候选、下次运行又说同一件事；**② 比较基准取晚了**（compare-and-set / 乐观并发的 snapshot 在变更循环**之后**才构建）——症状是 `runStartStates.get(name) !== diskRecord.state` 恒真，所有更新被当成「被并发赢走」而静默跳过。

- 判据：状态机/迁移这类纯函数**必须有一个应用点**（把 `to` 写进记录并加入本次运行拥有的字段集合），不能只有消费方；snapshot 必须在该次运行的**任何变更之前**捕获。
- 验证：造一条应迁移的记录（旧时间戳 + 该状态的前提），跑**dry-run 断言不改盘**、再跑真运行**断言盘上字段变了**。只断言「报告里有」是无效验收——上面两种形态都能让报告正确而状态不变。


**挂到真宿主上跑一次（不碰用户真实 profile）**：`DSH_HOME=<临时目录> dsh --profile smoke --from-default-profile web --dump-config` 造隔离 profile，再用 `--patch <overlay.yml>` 把**本地构建产物**挂进行集——插件行的 `name` 支持相对 specifier（loader 用 `new URL(name, ctx.baseUrl)`，baseUrl 即 profile 目录），所以写 `../../../<repo>/lib/<entry>.js`；绝对路径 `D:/...` 不行。判据是「组合树含全部本地行 + 真启动进程存活且 stderr 为空」，**不要**用重定向后的 `$LASTEXITCODE`（管道早关会把它变成 1）。同一 bundle 的多个 patch 文件转 overlay 时必须按 id 去重（host ⊂ full ⇒ 否则 `duplicate loader entry id`）。产物对真实平台包的加载断言：`Config` 可能是**函数**（schemastery），正解判 `Config['~standard'].validate` 是函数。完整步骤与坑见 `references/real-host-smoke-isolated-profile.md`。

### 真组合门：手写形状过不了的一道门（本会话实测抓到 3 条，全绿下隐形）

单元测试测的是**作者手写的平台形状** —— `{type:'tool/result', data:{callId, name}}` 这类平台从不发出的载荷被写成期望，于是缺陷"通过"。修法不是加断言，而是先在**真平台 `Context`** 上把每个 row 的 `apply(ctx, config)` 跑一遍（vitest 里就能做，不必起 boot harness；数据驱动地读 patch 文件得出 row→构建产物路径），三条断言覆盖本次 5 条 P0 的 4 条：①不抛 ②该 row 声明的平台服务真的被用上 ③喂一次真实 `tool/call → tool/result` 后信号计数 +1。

两条让它真正有效的细节：**夹具从平台源码抄**（一份事件一个 JSON，带 `_source` 指向文件:行），**平台的每个服务用成员检查代理**（取到不存在的成员就抛）——因为 `platform.policyOf?.(...)` 这种可选调用对不存在的成员只恒得 `undefined`、不抛错，所以它在类型检查与单测下**完全隐形**。

它抓到的三条（都此前全绿）：**① `ctx.effect` 体内引用上方未初始化的 `const` ⇒ 整行 `apply` 中止**（cordis 的 `ctx.effect` 回调**同步执行**，而 devkit 替身从不执行 effect 体，所以这一整类缺陷在单测里不被触发）；②「首见产出」与「结算回填」必须分两个事件位（否则 `toolCalls` 要么恒 0 要么算两次）；③**门必须看新鲜产物**（改源码不 build，门报的是旧产物的错，会误判成"修了没用"）。

**边界要如实标注**：成员检查抓不到「成员存在但语义用错」（`skills.register` 与 `registerProvider` 都存在）；给 `ctx.get` 加兜底代理会把某些错误变成"可调用"从而让门变绿——别用门的绿去证明它没覆盖的东西。**配一条静态契约探针**（事件名/服务名/seam 成员/载荷字段都去平台树里查，平台树不可解析就红），并且**每条新门都要把旧缺陷放回去验红**——没做过注入复验的门只算"没报错"。完整清单（含静态探针的语料与四类探针）见 `references/real-composition-gate.md`。

## Fix patterns

### 向上游反馈缺陷时（用户口径）

**严肃技术人员口吻，不装。** 他明说过「别装活人了，装不出来」—— 伪装身份是错方向，正解是**用专业本相写**：环境 / 现象 / 定位（文件·函数·行）/ 一手引用（平台源码注释、同机 grep 对照）/ 最小复现与量化前后值 / 独立问题分开列 / 修复建议。不寒暄、不致谢、不卖惨、不 emoji、不搭「预期行为／实际行为／影响」这种架子 —— 但要敢下判断（「根因在本包，皮肤只是触发者」）。
文案先给用户过目再发；`gh` 已登录 `lmzhen`，可直接代发（配图先裁干净：只留现象本身，别带整屏）。
这条也管**回复本身**：他的「AI 味」判在**结构**不在词汇 —— 别在对话里套 `## 小标题`／版本对照表／条列排场，直接给结论和证据。

### Prefer: upgrade the plugin

Find the plugin version whose README/changelog says it supports the installed
DSH line. Most DSH ecosystem plugins publish compatibility updates quickly.

```bash
dsh plugin --profile web add <plugin>@latest
```

or bump the profile dependency and reinstall:

```bash
cd ~/.dsh/profiles/web
pnpm install
```

Then restart the DSH web process if the plugin also carries host-half changes,
and hard-refresh the browser (`Cmd/Ctrl+Shift+R`).

### Custom/local patch: migrate from `__DSH_MODULES__` to `ctx.modules`

- Add `"@deepseek-ai/dsh-client-modules"` to `dsh.client.inject` in
  `package.json`.
- Add `'modules'` to the client plugin's `inject` array.
- In `apply(ctx)`, capture `ctx.modules` and hand it to your lazy-chunk/loader
  code:

  ```ts
  setChunkModuleSystem(ctx.modules)
  ```

- Store the injected system in a plugin-owned global (e.g.
  `globalThis.__dshSidebarModuleSystem__`) because lazy chunk bundles may run
  in separate bundle copies and no longer have access to the page global.
- Resolve module systems in this order:
  1. injected `ctx.modules`
  2. plugin-owned global
  3. `window.__DSH_MODULES__` fallback for older hosts

## Verification after fix

- Hard refresh; no module-system error when opening the previously failing tab.
- For lazy chunks (terminal/editor/mermaid), open the actual feature and
  confirm the chunk network request succeeds.
- If the plugin has host-half code, restart DSH, not just the browser.

See `references/dsh-better-sidebar-module-system-migration.md` for a concrete
case.

## Asking the RUNNING host (stronger than a screenshot)

A screenshot shows *"something rendered"*. The host's own RPC answers **"is this row applied, and in what state"** — callable from a shell, therefore repeatable and diffable.

    POST http://127.0.0.1:<port>/api/<method>
    {"type":"client-request","rpcId":"1","method":"<method>","payload":{"args":{<args>}}}
    →  {"type":"server-response","rpcId":"1","result":{"ok":true,"value":…}}

**Do not guess the envelope — make the validator write it for you.** Send the shortest possible body (`{"type":"client-request","rpcId":"1"}`); each reply names exactly one missing or invalid field (`expected string, received undefined`; `path: ["payload"]`; then `must contain exactly one plain-object args field`). Three round-trips produced the shape above. This generalises to any gateway with a schema-validated envelope, and it beats reading the client bundle — one such attempt returned **zero grep hits for a string that demonstrably existed** (the extractor lied; the validator did not).

**Two calls answer most "did it actually install?" questions:**

| method | answers |
|---|---|
| `pluginInventory/list` | every entry with `enabled` + **`fiberPhase`**. `fiberPhase: "active"` is *positive* proof the row applied; a broken row is simply absent / not active, and the only other trace is one `warning: N entry did not activate` line in the host log — **absence of that warning is not proof**, this is. |
| `settings/describe` | the whole config surface: per-namespace `applies` / `revision` / `writable`, and a `schema` whose **leaf count = the number of controls the settings page will render**. |

Auth: the URL carries `?token=`; **the token rotates on every host restart** and the host log accumulates every historical one. Take the **last** one printed after the most recent launch — a stale token returns 401, which reads like "no such endpoint".

⇒ Prefer this channel whenever the question is *"what state is the host in"*. Reserve the GUI for the one thing it uniquely answers — **does that settings section render controls** rather than "this page is temporarily unavailable" — and note even that has a host-side proxy: if `settings/describe` returns the namespace with a non-empty schema, the form exists.

**Starting a session works; prompting it does not (yet).** `session/create` succeeds with `payload.args = {"request":{}}` and returns `{"sessionId":…,"agentPreset":"standard"}`; the new session then shows **`agentAvailable: true`** in `session/list` (older, inactive ones show `false`). `session/prompt` also exists, but its `request` is an **undocumented wire shape**: the validator names the missing *top-level* arg (`missing "request"`) yet answers only `wire field "request" failed boundary validation` for the nested one — **no field names, no type, no path**. Four plausible shapes (`text` / `content[]` / `parts[]` / `message`) were rejected identically. `session/new`, `agent/create`, `turn/create` are 404.

⇒ Two rules to carry forward:

- **Probing a live host has persistent side effects — report them.** Those `session/create` calls left **two real, empty sessions** in the operator's list. A probe that *looks* read-only is not; anything that creates state must be disclosed, not quietly left behind.
- **Know when to stop guessing.** When a validator enumerates top-level fields but refuses to describe a nested one, further guesses are a lottery, not a method. The cheaper moves are: ask the human for **one paste** in the UI (30 seconds), or fetch the **client bundle that constructs the call**. Say plainly which one you are choosing and why — do not let "I'll try a few more shapes" become an unbounded budget.

**JSON must not travel through a shell.** `--args '{"_request":{}}'` handed to a *native* `node` from PowerShell arrives as `{_request:{}}` (`Expected property name or '}'`) — the inner quotes are eaten. Same family as "file content goes through the file tools only": if an argument carries quotes, backslashes or CJK, **write it to a file and pass the path** (`--args-file`).

**Two more pieces of host-side evidence, both cheap:**

- **The served shell's module list is the authoritative roster of loaded client halves.** Fetch `/?token=…` and read the `<script src="plugins/??…">` href — it enumerates every client module being served, comma-separated. **Your plugin's own `<name>/client.js` appearing there is positive proof its browser half was served**, and it is the *only* cheap proof: `pluginInventory` reports the **host** half only. A good companion to the RPC table above when judging "did this plugin actually load".
- **No prompt-assembly endpoint exists.** Seven spellings (`systemPrompt/{describe,sections,list}`, `prompt/describe`, `session/{context,snapshot,systemPrompt}`) are all 404 ⇒ **the rendered prompt cannot be read from outside; it requires a real turn.** Plan verification around that rather than hunting for an endpoint.

**The stopping rule — corrected.** An earlier pass recorded "do not guess shapes, do not scrape bundles" after four `request` shapes were rejected identically and the client bundle came back with zero hits. **That conclusion was wrong, and the correction is the useful part.** The shapes are not secret; they are *generated into the installed tree*. Recipe:

1. **Search the installed packages for a method you already know works** (`session/create`), not for the one that is failing. It lands you in the generated remote client — `@deepseek-ai/dsh-api-remotes/lib/client.js` — which contains the **complete endpoint table**: one entry per method with `id`, `service`, `namespace`, `method`, and a `parameters[]` array whose every item carries **`name` / `wire` / `source` / a `typeSymbol`**. The referenced zod schema a few thousand lines above gives the field types verbatim.
2. **Read the parameter descriptors, never the bundle.** A served client bundle is the wrong artifact: the table lives server-side and is generated from `packages/api/*/src/index.ts` (each entry even carries `sourceLocation`).

**Two traps this recipe immediately exposed:**

- **Same-named methods in a bundled third-party SDK are a false lead.** A full-tree search for the failing method returned 24 hits, **all** inside `@agentclientprotocol/sdk` — a *different protocol* (ACP) that happens to use the identical `session/<verb>` spelling. A plausible-looking schema from the wrong protocol is worse than no schema.
- **Nesting is per-method, and the validator says which.** `session/prompt` takes its args **wrapped**: `{"request": {requestId, sessionId, mode, content:[…]}}`. `settings/mutate` takes them **bare at the top level**: `{"ns", "ops"}` — passing `request` there fails with `unexpected "request"`. Assume nothing; when a call fails, the message usually names both the missing and the unexpected field.

**So the operative rule is: stop *guessing*, not stop *looking*.** The endpoint table is authoritative, cheap to find, and removes this entire class of dead end.

**Verifying that a settings write actually reaches a component's live config.** "The mutate call returned OK" proves nothing — the failure mode is *accepted and ignored*. The end-to-end check, done here and worth copying: (1) mutate the value through the **same write path the UI uses**; (2) confirm the returned/described **revision incremented**; (3) **trigger one real render**; (4) read the **rendered artifact** and confirm it changed. Steps 3–4 are the ones people skip, and they are the only ones that prove the value reached the component rather than a cache.

**The session log is a first-class verification channel — a whole class of "what did the model actually see?" needs no API at all.** Each turn's assembled `system/message` is persisted verbatim in `session.vN.jsonl.zstd` under the session directory, including every injected section. So an injected-index change is directly observable: **dump the log, count the lines in each `system/message`, diff across turns.** Two practical notes: the file is **multi-frame zstd** — a single decompress call yields only the *first* frame, so split on the magic `28 B5 2F FD` and concatenate; and a stats/grep probe may cap its hit list, so for "is this line present in *that* record" write the full text out and search that. A bonus this gives for free: it timestamps **when** each section was evaluated, which distinguishes "assembled per turn" from "refreshed live" — the two behave differently and only the log tells them apart.

**Prefer (a), and far sooner than instinct suggests.** Every practical unblock in one long session came from a single operator paste, after hours of agent-side attempts at the same goal. When the remaining gap is a **five-second human action**, asking immediately beats continuing to reverse-engineer — and this operator does it without complaint. Ask, and keep the ask to literal steps plus what you will do with the result.

### Shipping: `exports` and `files` are two different resolution paths

A relative `import` resolving says **nothing** about whether `import '<pkg>/<subpath>'` works — the latter goes through `exports`. Two failure modes hide in that gap, and **both are green in-repo**:

- `exports` names a subpath whose target is missing or misspelled ⇒ the installer gets `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `exports` points at a file that **exists but is not covered by `files`** ⇒ the tarball simply does not contain it. The repo stays green; only a fresh install fails.

⇒ Assert exactly that pair: for every `exports` entry, resolve the target, require it to **exist**, and require **`files` to cover it** (`package.json` itself exempt). Add the vacuum guard — an emptied `exports` makes the loop pass zero times.

## Skill/plugin visibility in the model catalog

A skill that shows up in the model's catalog with a name but **no description**
(an empty/blank description), or that is entirely missing, is usually a
`SKILL.md` without YAML frontmatter. The catalog derives `description` from
frontmatter; without it the entry is an empty description. Always give a
`SKILL.md` a `name:` + `description:` frontmatter block (lowercase-hyphenated
name, one-sentence ≤60-char description). See
`references/skill-frontmatter-contract.md` for the parser contract, the
symptom table, and how to verify/model-catalog refresh.

Also: placeholder/test skills (description like "lifecycle boundary test",
body "Body.", no external refs, no `.pinned`/`.bundled` marker) should be
deleted so they don't pollute the model's catalog — see that reference's
cleanup checklist.

## 插件自绘 UI 的生命周期（浮层塌陷）

症状：插件画的浮层/开关**塌进文档流** —— 页脚多出一个 300×150 的 iframe（HTML 固有尺寸）、页面被撑高、要滚动才看得见；或弹窗一开插件开关就点不动。
机制（平台侧，已读到代码，两个函数都在 asar 的 client modules 段）：`claimStyles(id)` 在**每个插件 factory 返回后**把页面上**所有无 `data-plugin` 的 `<style>` 盖上「发起 require 的那个插件」的 id**（注释原文 `any untagged tag is claimed for the materializing plugin (HMR bookkeeping)`）；`removeOwnedStyles(id)` 遍历 `style[data-plugin]` 并**按 `data-plugin === id` 精确删**。
**触发条件比看上去窄得多，别外推**：`removeOwnedStyles` 只有四条调用路径 —— `materialize` 的 catch（factory 抛异常回滚）、`replace()`（代码替换：`tearDownEntryFiber` → 删样式 → 重新 import）、`reload()`（该 id 无 managed entry）、`updateManifest()`（行已不在 managed 且 rev 变化）。**改配置、启停皮肤行都不触发**（用户实测切皮肤无复现，与代码一致——别再写「切皮肤＝重载」）。认领同样非必然：只在「某插件的模块在裸 `<style>` 插入**之后**才被 materialize」时才发生；实测新开客户端里那份裸 style 仍是 `data-plugin=null`，未被认领。
皮肤包有 `releaseClaimedStyles()`（`@smalltailqwq/dsh-client-ui-skin-maid-atelier:2129`、`-orca-link:3872`，各自在 `ctx.effect` 注册成 dispose 回调 `:2734`/`:4205`），把自己名下非自产的标签摘掉，**因为它们自认重载频繁**。这是第三方对同一机制的证词，可引，但**不等于"切皮肤会删别人样式"**。
取证判据（一次就能定性，比推演可靠）：在真实页面上数 `[...document.querySelectorAll('style')].map(s => [s.dataset.plugin, s.dataset.pluginCss, s.textContent.slice(0,40)])` —— 裸 style 的数量与归属、以及 `.dsh-td-overlay` 的个数（＝host 数，多份即 apply 跑过多次）。
判据（插件侧）：`createElement('style')` 之后**没有** `tag.dataset.plugin` / `data-plugin-css` ⇒ 自愿进了可被认领的池子。同机对照很有力：8 个客户端包里 7 个都带（连 DSH 自己的 `dsh-client-locale` 都带），只有它不带。修法：补 `data-plugin` + `data-plugin-css`（`<包名>/<文件>`）、两处副作用进 `ctx.effect` 清理、`apply` 加已存在即复用的幂等。
另一条独立缺陷（与皮肤和平台都无关，是插件自己的）：z-index 低于宿主模态层 —— 0.2.x 的 `._root_o6lrb_6` 是 `z-index:1000`，插件常用 100/120，实测被 `intercepts pointer events` 拦，点击要带 `force`。
最硬的证据是差分：在真实页面上**只删掉插件那一个 `<style>`** ⇒ `position:fixed; inset:40px 0 0 0` 变 `static`、iframe 由 1707×979 变 **300×150**、`scrollHeight` +158。
进真实页面（`/` 是 401）：拿 `~/.dsh/.credentials.yaml` 的 `secret` 按 `packages/client/connection/src/browser-auth.ts` 自签浏览器会话 cookie。取证工具（像素 run-length 扫结构边界、`WindowFromPoint` 判「是窗口还是 DOM」、route 注入同源宿主页复现 iframe 内行为、`window.parent !== window` 判 SPA 是否在 iframe 内）与本次实测全表、以及「最新版修没修」的三步核查法：`references/host-page-overlay-collapse.md`。

## Unexpected UI bubbles / toasts

A dark pill bubble saying `命令行走起：{hint}` (e.g. `python - <<…`) next to the
pet mascot is **not an error or notification** — it is a chatter line from
`@linxin666/dsh-pet` (`src/chatter.ts`), the pet plugin reacting to command
activity. Dismiss with its ×. Check `dsh-pet`'s chatter source before
reported "mysterious popups".

## Attachment/image troubleshooting

"Pasted images don't work well" is usually not a plugin bug — it's the
attachment → projection → Files API pipeline. Diagnose in this order: (1)
the session model must be an `inputModalities`-image catalog entry
(`deepseek-v4-flash-vision-exp`) — other/unlisted models route as **text-only**
and replace pixels with placeholder text; (2) paste-time source limits
(20 imgs/msg, 20 MiB, 6400万 px, side ≤8192); (3) history eviction (128 MiB /
600 imgs → oldest images become `[image omitted …]`); (4) Files API errors
(7-day expiry, 10k files/25 GiB quota). See
`references/dsh-image-attachment-pipeline.md` for full limits, symptom→cause
map, and user workarounds (crop before paste, `read_image` the local path).

## Native capabilities vs community plugins

Before recommending or installing a community plugin, check whether DSH
already ships the capability natively.

### Subagents (native)

DSH has a first-class subagent subsystem:

- Service: `ctx.subagents` (provider and continuation service)
- Providers: `spawn`, `fork`, `acp`, `codex`, `claude-code`, `dsh-sdk`
- Model-facing tools: `subagent`, `subagent_control`, `subagent_report`
- GUI: `@deepseek-ai/dsh-client-ui-subagent`
- Jobs integration: subagent runs appear in `ctx.jobs`

So ordinary subagent creation, continuation, control, and reporting do NOT
require a third-party plugin.

### AgentTeams / orchestration plugins (optional)

Community tools like `@nanmicoder/dsh-agent-teams` are optional layers on top
of the native subagent seam. They add team-level orchestration: captain,
members, task DAGs, shared schedulers, member mailboxes, Web panels.

When evaluating one:

- Confirm it actually builds on `ctx.subagents` / `tool-subagent` rather than
  vendoring its own agent runtime.
- Check release notes for the DSH line you run (`dsh --version`). A plugin
  tested against `0.1.0-rc.8` may still need explicit verification on
  `0.1.1-*`.
- For regular delegation, prefer the built-in tools unless you specifically
  need team/dependency orchestration.

See `references/dsh-native-subagents-vs-agent-teams.md` for the detailed
comparison.


> ⚠ 2026-10-15 清理：本文引用的 `audit-v44` 目录已于 2026-10-15 移出 `D:\dsh`（按「audit 只留最高版本」的规则保留 `audit-v46-0.17.1`；发布门禁用的 `audit-v42` 例外保留）。文中这些路径**仅作历史出处**，结论不依赖它们仍然存在；需要复现探针时从 `D:\dsh-trash-20261015\` 取回。
