# @deepseek-ai/dsh-evolution-skill-history

The web surface for skill content history: a left-sidebar panel row (**Skill history**) that lists the versions every skill write records, and the four loopback host routes it reads.

The **facts** belong to `@deepseek-ai/dsh-evolution-core` (which artifact a version holds, how the body chain and the support-file chain split) and the **only write** is `curator.undo`. This package maps a route to that seam and draws it; it owns no state of its own.

## Where it lives

Two registrations, one id (`skill-history`), because that is the sidebar's contract: `sidebar.panellist` owns the button and the layout's keyed `main` slot owns the body, dispatched by the same id.

    ctx.slots.inject('sidebar.panellist', function* () {
      yield ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 35, label: () => t('entry.label') }, PanelIcon)
      yield ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ t, loadSkills, loadVersions, undo }) }, SkillHistoryPanel)
    })

The label is a **thunk**: the sidebar re-reads it on every projection, so a language switch follows without re-registering the row. The body receives plain callbacks through its inject face — no service handle, no subscription, and the component never sees the context.

## The host routes

| Method | Path | Use case |
|---|---|---|
| GET | `/api/dsh-evolution/skill-history/skills` | the skills that recorded at least one version, with their counts |
| GET | `/api/dsh-evolution/skill-history/versions?name=` | the body chain and the support-file chain, split, each body row carrying its own `undoable` verdict |
| POST | `/api/dsh-evolution/skill-history/undo` | `curator.undo(name, v?)` — the only write |
| GET | `/api/dsh-evolution/skill-history/health` | liveness probe for the client |

Every route sits behind the platform's own /api fence, kept local because the canonical implementation is not part of that package's published surface: the **socket** must be loopback (authoritative; `X-Forwarded-For` is never trusted), the **Host** header must name a loopback authority, an explicit `sec-fetch-site: cross-site` marker is refused, and an attached **Origin** must be exactly this authority.

Transport refusals stay transport refusals (`403` fence, `405` method, `400` missing name / malformed or oversized body). A **business** refusal is a `200` with `{ ok: false, code, message }`, and that message is the curator's own sentence — the same one `/evolution skill undo` prints, so the two faces cannot drift.

The row is **inert without a web server** (`ctx.get('webServer')`, not a declared inject): a headless profile keeps the slash commands as its entry point, and no fiber waits forever on a service that will never arrive. The curator is resolved **per request**, so a profile that mounts the routes before it answers the family's `E-302` sentence instead of throwing.

## What the panel shows

The selected skill's versions as two groups: **Body versions** (restorable) and **File versions** (history only, because a restore rewrites `SKILL.md`). A body row offers **Restore this version** unless it already IS the live content (the host marks those), and the button turns into an inline confirmation first. After a restore the list is read again, because the restore itself is a new version.

## Build

The host half builds with the family's normal `packages/evolution/scripts/build-lib.mjs`. The browser half builds with `build-client.mjs`: discovery is automatic for a package that declares `dsh.client` and ships `src/client/index.ts`, and the artifact is the module loader's lazy CJS factory (`lib/client.js`).

## Model Experience

This package adds **no model-visible content**: no prompt section, no tool schema, no tool result text. It therefore has no token cost and no KV-cache effect. The panel is a human surface and its routes are loopback-only.

## Known limitations and deferred work

- **No rendered spec.** The family's specs are Node-level and this package's client half cannot be rendered there, so the panel is covered by `tsc`, the client bundle build, the pure `tests/client-api.spec.ts` and a live pass on the installed artifact. A rendered spec (jsdom plus a driven fixture runtime) is the follow-up that would catch wiring in CI.
- **The list shows skills with recorded versions only.** A skill that never wrote through the library has no history to browse, so it does not appear; the tree-wide listing stays with the skill catalog.
- **No diff view.** The routes return entries, not bodies; a two-version diff would need a second read route and a client-side differ.
- **Support-file bytes are history only.** They share the index with the body, so they are listed and labelled, but `undo` refuses them by name — the bytes stay in the blob store for a hand copy.
- **No occupancy row.** `.history` growth is documented in the evolution-core README; showing the size in the panel would promise a cleanup path the family has not designed (a whole-library reference count belongs to the curator).
