# @deepseek-ai/dsh-evolution-skill-history

The web surface for skill content history: a left-sidebar panel row (**Skill history**) that lists the versions every skill write records, and the five loopback host routes it reads.

The **facts** belong to `@deepseek-ai/dsh-evolution-core` (which artifact a version holds, how the body chain and the support-file chain split) and the **only write** is `curator.undo`. This package maps a route to that seam and draws it; it owns no state of its own.

## Where it lives

Two registrations, one id (`skill-history`), because that is the sidebar's contract: `sidebar.panellist` owns the button and the layout's keyed `main` slot owns the body, dispatched by the same id.

    ctx.slots.inject('sidebar.panellist', function* () {
      yield ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 35, label: () => t('entry.label') }, PanelIcon)
      yield ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ t, format, loadSkills, loadVersions, loadDiff, undo }) }, SkillHistoryPanel)
    })

The label is a **thunk**: the sidebar re-reads it on every projection, so a language switch follows without re-registering the row. The body receives plain callbacks through its inject face — no service handle, no subscription, and the component never sees the context.

## The host routes

| Method | Path | Use case |
|---|---|---|
| GET | `/api/dsh-evolution/skill-history/skills` | the skills that recorded at least one version, with their counts |
| GET | `/api/dsh-evolution/skill-history/versions?name=` | the body chain and the support-file chain, split, each body row carrying its own `undoable` verdict |
| POST | `/api/dsh-evolution/skill-history/undo` | `curator.undo(name, v?)` — the only write |
| GET | `/api/dsh-evolution/skill-history/versions/diff?name=&v=` | one body version against its recorded predecessor, as line counts plus the windowed changed region |
| GET | `/api/dsh-evolution/skill-history/health` | liveness probe for the client |

Every route sits behind the platform's own /api fence, kept local because the canonical implementation is not part of that package's published surface: the **socket** must be loopback (authoritative; `X-Forwarded-For` is never trusted), the **Host** header must name a loopback authority, an explicit `sec-fetch-site: cross-site` marker is refused, and an attached **Origin** must be exactly this authority.

Transport refusals stay transport refusals (`403` fence, `405` method, `400` missing name / malformed or oversized body). A **business** refusal is a `200` with `{ ok: false, code, message }`, and that message is the curator's own sentence — the same one `/evolution skill undo` prints, so the two faces cannot drift.

The row is **inert without a web server** (`ctx.get('webServer')`, not a declared inject): a headless profile keeps the slash commands as its entry point, and no fiber waits forever on a service that will never arrive. The curator is resolved **per request**, so a profile that mounts the routes before it answers the family's `E-302` sentence instead of throwing.

## What the panel shows

**The left column** lists the skills that recorded versions, one row per skill: its name, how many versions it has, its own one-line description (the listing already carried it) and the management state the marker probe reported. A **search box** filters that list by name or description — client state only, no route behind it.

**The right pane** shows the selected skill's versions as two groups: **Body versions** (restorable) and **File versions** (history only, because a restore rewrites `SKILL.md`). A body row reads like a sentence rather than a dump — `v3  targeted edit  2026-09-27 18:20 · 3 hours ago  (+1363 chars)` — with a *current* capsule on the live content, **Restore this version** (an inline two-click confirmation, with a **Cancel** beside it once it is armed) on the others, and **Diff** expanding that version against its predecessor (lines added and removed, plus the changed region, marked truncated when it is long). After a restore the rows are read again — the restore itself is a new version — while the curator's result sentence stays on screen. **Refresh** re-reads the skill list and the open skill.

**The panel owns no rule and no arithmetic.** The host reports every row with its whole verdict — `undoable` (evolution-core's artifact classification against the live bytes), `actionKind` (a closed vocabulary key), `age` (a bucket plus a count), `charsDelta`, `summary` — and this half substitutes words from its locale dictionary and renders. The time, the action words and the sentences are therefore localized; the facts are computed once, host-side, so the panel and the slash commands cannot drift.

**Appearance follows the platform's tokens, not its modules.** The panel carries its own stylesheet (`src/client/styles.ts`, injected once behind `data-plugin-css`) and copies its metrics from the platform's own components — the command card's `<pre>` for the diff block, the sidebar row's hover and focus ring for the controls, and the theme's semantic state pair (`--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary`) for the diff's added and removed lines — while every size is a `--dsh-content-font-size*` token or a `calc()` over one, so the panel follows the deployment's content size the way the platform's panels do. Importing the platform's control package is NOT possible from here without splitting this package's compiler faces: the specifier is path-mapped to source, and `tsc -b` then refuses the foreign project (host/client face split, `react` devDependencies and a CI graph change would all be needed). The roll call of what the panel deliberately does not do is in `## Known limitations and deferred work`.

## Build

The host half builds with the family's normal `packages/evolution/scripts/build-lib.mjs`. The browser half builds with `build-client.mjs`: discovery is automatic for a package that declares `dsh.client` and ships `src/client/index.ts`, and the artifact is the module loader's lazy CJS factory (`lib/client.js`).

## Model Experience

This package adds **no model-visible content**: no prompt section, no tool schema, no tool result text. It therefore has no token cost and no KV-cache effect. The panel is a human surface and its routes are loopback-only.

## Known limitations and deferred work

- **No rendered spec.** The family's specs are Node-level and this package's client half cannot be rendered there, so the panel is covered by `tsc`, the client bundle build, the pure `tests/client-api.spec.ts` and a live pass on the installed artifact. A rendered spec (jsdom plus a driven fixture runtime) is the follow-up that would catch wiring in CI — 0.11.3 is the cost of not having one: the first installed pass restored the content correctly and re-read the rows correctly while the curator's result sentence never appeared, because the reload that follows a restore cleared the note state it had just set. No Node-level spec and no `tsc` can see the order of two state updates; only clicking the panel showed it.
- **The list shows skills with recorded versions only.** A skill that never wrote through the library has no history to browse, so it does not appear; the tree-wide listing stays with the skill catalog.
- **No quality and no last-use in the list.** Both are real and both are wanted, but they live in the curator's health view and the usage store; joining them into this listing would make the route a second home for facts it does not own. The row shows what the listing already holds (description, managed/protected markers, version count).
- **No rendered component spec yet.** The panel's state machine (result sentence, two-click confirmation, the read ticket that discards a late reply, the lazy diff) is pinned by `tsc`, the bundle build and live passes; a jsdom lane is the follow-up, and it needs `react` in this package's devDependencies plus one `pnpm install` in the tree the specs run in.

- **Support-file bytes are history only.** They share the index with the body, so they are listed and labelled, but `undo` refuses them by name — the bytes stay in the blob store for a hand copy.
- **No occupancy row.** `.history` growth is documented in the evolution-core README; showing the size in the panel would promise a cleanup path the family has not designed (a whole-library reference count belongs to the curator).
