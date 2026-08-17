# Design Review 003: Retiring the legacy `dsh-evolution` facade

Status: proposed (updated after independent review)
Review verdict: approve-with-changes

## Context

`@deepseek-ai/dsh-evolution` used to be a monolithic one-row plugin. After the
core extraction it is only a compatibility facade, but it still contains its
own memory/skill tools, review gate, curator timer and telemetry. Native
packages now own those responsibilities, and neither `evolution-host` nor
`evolution-preset` mounts the facade. It exists only for deployments that still
list the old single row.

## Architectural layers

1. Control plane: policy, approval, state, threat guard (native).
2. Model surface: tools and prompt sections (native).
3. Compatibility surface: `dsh-evolution` facade (legacy only).
4. Shared library: `dsh-evolution-core` (pure logic, no plugin row).

The facade currently crosses layers 2, 3 and partly 1, which is the root of
the duplication.

## Proposed design

Phase A - freeze and document (now):
- Keep the facade exported and tests green.
- Declare it maintenance mode: no new features, bug fixes only for data loss
  or security.
- Publish a configuration mapping from every legacy config field to native
  rows (`curatorIntervalHours` -> `evolution-curator.intervalHours`, etc.).
- Add migration contract tests for legacy state files.

Phase B - thin root-realm shim (next minor):
- Do NOT use a hidden `isolate` group. The legacy row is mounted in the root
  realm and composes native rows in the same realm.
- The JS apply performs an idempotent composition: if `evolutionIo`, native
  `memory` tool, or native review/curator services already exist, it emits a
  deprecation warning and skips duplicate registration.
- Minimal composed row set: `evolution-io`, `evolution-io-node`,
  `evolution-state-json`, `evolution-state`, `memory`, `memory-files`,
  `tool-memory`, `skill-usage`, `tool-skill-manage`, `evolution-policy`,
  `evolution-approval`, `evolution-threat`, `evolution-review`,
  `evolution-curator`.
- Data migration on first mount:
  - legacy flat `curator-state.json` is wrapped as `{ primary: ... }` for
    `evolution-state-json`;
  - `pending.json` / `pending-state.json` merge semantics remain as already
    implemented;
  - `.usage.json`, MEMORY.md, USER.md, skill markers are read in place and
    remain the compatibility contract.
- Observability: log once and emit `evolution/legacy-mounted`; the activity
  projection records it for later usage measurement.

Phase C - deprecate and remove (next major):
- Delete the package only after one release shows `evolution/legacy-mounted`
  usage below a defined threshold and zero one-click installer usage in the
  same window.
- Keep a permanent migration page in README/INSTALL.

## Decisions confirmed

1. A root-realm, idempotent compositor is safer than duplicated logic, and
   much safer than a hidden isolate re-export.
2. A pure alias row with no JS apply is not viable while existing deployments
   load `dsh-evolution` as a plugin package; keep a minimal JS shim.
3. Compatibility contract: legacy file names and paths remain stable until
   the package is removed.

## Review questions

- How do we measure legacy mount usage across web/GUI deployments?
- Does profile patch override work for rows composed inside a JS apply?
- What warning should the one-click installer print during the transition?
