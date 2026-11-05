# Acceptance fixtures (G0)

These helpers write **acceptance-home data only**. They do not change plugin
code, platform code, or production routes. Use a clean profile; the merge fixture
refuses to overwrite an existing schema-4 state.

## Required profile

The acceptance profile must enable `evolution-state-domain`; a workbench-only
profile can render the UI while its skill surface stays empty. A minimal
`cordis.patch.yml` needs `- id: evolution-state-domain / disabled: false`
(plus the family merge config used by the test). Reuse the g34 acceptance
profile or copy that patch into the clean profile before seeding.

## Stable pending pair

```bash
node packages/scripts/acceptance/fixtures.mjs \
  --home <acceptance-home> --a g0-merge-a --b g0-merge-b --target g0-merge-a
```

It creates two family-managed skills and a v3 pending row. The host migrates the
row on startup. Use the printed row id for approve/reject. Engine `keep` is not
required and must not be used as a pending fixture.

## Archived time

```js
import { seedArchivedUsage } from './fixtures.mjs'
await seedArchivedUsage(home, 'g0-archived', '2026-10-01T12:00:00.000Z')
```

This creates `.archive/<name>` with a reason and a real `archived_at` in
`skills/.usage.json`. It is the fixture for "no commit receipt" history rows.

## Stale readback

Start a host and open a page, then arm the fault before clicking refresh:

```bash
node packages/scripts/acceptance/cdp-faults.mjs --port <cdp-port> --mode stale
```

The next `settings/describe` request receives HTTP 500. The page must keep its
last-ready values and mark them stale; this is not a plugin-install failure.

## Clipboard denial

```bash
node packages/scripts/acceptance/cdp-faults.mjs --port <cdp-port> --mode clipboard
```

Copy must keep the selectable command and expose retry; a toast alone is not a
pass.

## Evidence protocol

- Screenshots: `_acceptance/shots/g<group>-<surface>-<viewport>-<theme>.png`.
- Every matrix claim names the fixture, the host profile, the viewport and the
  data source; no screenshot without a reproducible seed.
- Browser token URLs are lost on `Page.reload`; navigate back to the token URL.
- The G2 release gate requires a real pending row, real approve/reject/release,
  and visible row state changes, not merely a successful route response.
