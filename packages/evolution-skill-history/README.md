# @deepseek-ai/dsh-evolution-skill-history

The web surface for skill content history: a left-sidebar panel row (**Skill history**) that lists the versions every skill write records, and the six loopback host routes it reads.

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
| GET | `/api/dsh-evolution/skill-history/versions/body?name=&v=` | one version's whole text, for the panel's preview; bounded by `MAX_BODY_CHARS` and flagged `truncated` |
| GET | `/api/dsh-evolution/skill-history/health` | liveness probe for the client |

Every route sits behind the platform's own /api fence, kept local because the canonical implementation is not part of that package's published surface: the **socket** must be loopback (authoritative; `X-Forwarded-For` is never trusted), the **Host** header must name a loopback authority, an explicit `sec-fetch-site: cross-site` marker is refused, and an attached **Origin** must be exactly this authority.

Transport refusals stay transport refusals (`403` fence, `405` method, `400` missing name / malformed or oversized body). A **business** refusal is a `200` with `{ ok: false, code, message }`, and that message is the curator's own sentence — the same one `/evolution skill undo` prints, so the two faces cannot drift.

The row is **inert without a web server** (`ctx.get('webServer')`, not a declared inject): a headless profile keeps the slash commands as its entry point, and no fiber waits forever on a service that will never arrive. The curator is resolved **per request**, so a profile that mounts the routes before it answers the family's `E-302` sentence instead of throwing.

## What the panel shows

**The left column** lists the skills that recorded versions, one row per skill: its name, how many versions it has, its own one-line description, clipped with an ellipsis (the listing already carried it), the management state the marker probe reported and — on the description line, where it cannot squeeze the name — **when the content last changed**. That last fact comes from the index this route already reads (`latestVersionAt` across both chains); *last use* is a different fact and stays in the usage store. A **search box** filters that list by name or description — client state only, no route behind it.

**The right pane** shows the selected skill's versions as two groups: **Body versions** (restorable) and **File versions** (history only, because a restore rewrites `SKILL.md`). A support file's bytes land in the second group even when the entry wears the `baseline` label — a support write's predecessor is that FILE's previous content, not a body version — because the entry's `path` says which artifact it holds, and for an entry recorded before that field existed the link the support write left behind (`beforeHash`) says it instead. A body row reads like a sentence rather than a dump — `v3  targeted edit  3 hours ago  (+1363 chars)`, where the absolute clock is the row's hover text — with a *current* capsule on the live content, **Restore this version** (an inline two-click confirmation, with a **Cancel** beside it once it is armed) on the others, and **Diff** expanding that version against its predecessor (lines added and removed, plus the changed region, marked truncated when it is long). A support row names the file it holds (`references/notes.md`) once the entry records it, and says so plainly when it does not — entries written before the path was recorded have none, and the blob store cannot recover the name. After a restore the rows are read again — the restore itself is a new version — while the curator's result sentence stays on screen. **Refresh** re-reads the skill list and the open skill.

**Preview** renders one version as a document, support files included (the body route above). Inside the diff view, **Source / Rendered** switches between the exact window the host computed and the same two sides rendered as Markdown — removed first, added second, each under a tinted edge. Block level on purpose: line-level interleaving of two rendered documents is a different, much larger problem, and the source view stays one click away. Only one row is expanded at a time (`expanded: {v, kind}`), and each kind keeps its own lazily-filled cache.

While nothing is selected the pane says so — a line pointing at the left column, or the empty listing when no skill has a history yet. **Reading and empty are different states** (E7, 2026-09-30): until the
first list read lands the column says it is reading, and a FAILED read lands on the empty listing plus the error sentence instead of a spinner that never stops.

A removed support file now shows up too: its removal is recorded as its own entry (see evolution-core's note),
so the file's chain ends with a `support file removed` row whose undo restores the bytes.

**The panel owns no rule and no arithmetic.** The host reports every row with its whole verdict — `undoable` (evolution-core's `entryTarget` classification against the live bytes), `actionKind` (a closed vocabulary key), `age` (a bucket plus a count), `charsDelta`, `summary` — **and the row's cells**: `evolution-core`'s `skill-row-cells.ts` decides what the row says, in which order and in which slot (`lead` / `meta` / `aside`), and the host ships that list with the row, because a browser half cannot import core at runtime. This half substitutes words from its locale dictionary and renders by slot, so a decision fact (`aside`) can no longer be eaten by the browser's ellipsis. The time, the action words and the sentences are therefore localized; the facts are computed once, host-side, so the panel and the slash commands cannot drift.

**Appearance follows the platform's tokens and the family's own scale.** The panel carries its own stylesheet (`src/client/styles.ts`, injected once behind `data-plugin-css`), split into two prefixed faces: `.evo-hist-*` is the tool face (the list, its rows, its controls) and `.evo-doc-*` is the reading face (one version as a document — one measure, page-like spacing, no inner scroll), so neither face's comfort can be overruled by the other's rules. Every type step, space, radius, hairline, tone, focus ring and container cap is a token from `packages/scripts/client-tokens.json`, generated into `src/client/tokens.ts` in both client halves (identical bytes; `verify-client-tokens` is a gate step), and N25/N26/N27 in the family's guard keep literals, borrowed interaction colours and off-scale geometry out. It copies its metrics from the platform's own components — the command card's `<pre>` for the diff block, the sidebar row's hover and focus ring for the controls, and the theme's semantic state pair (`--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary`) for the diff's added and removed lines — while type follows the shell rather than the conversation: the panel is one relative step below the shell's chrome size (`calc(1em - 1px)`, never the conversation-content setting) and steps again inside itself — `calc(1em + 2px)` for the title, `calc(1em - 1px)` for a group label. Only the diff block takes the platform's code-block token — it renders content, not chrome. The setting behind `--dsh-content-font-size*` is documented as affecting conversation content only, so the panel deliberately does not follow it. Two platform seams are reached differently, and the difference is deliberate. **Controls and styles are drawn here**, because a STATIC import of the platform's control package cannot compile from this tree: the workspace tsconfig maps the specifier to platform sources (`TS6059`/`TS6307`) and this package's `react.d.ts` shadows the real React types (`TS2305`); an ambient `declare module` for that specifier loses to the paths mapping. **The Markdown renderer is borrowed at runtime instead**: `src/client/markdown.ts` is the one seam, taking `MarkdownText` from `@deepseek-ai/dsh-client-ui-primitives` — a `PLATFORM_MODULES` row every dynamic bundle can `require`, exactly like `react` — through the loader-provided `require` (the bundler keeps `@deepseek-ai/*` external, so nothing is inlined and no dependency is installed). It renders with the platform's own mdast pipeline and the shell's own stylesheet, and when the row is absent the seam reports `{ok: false}` and every caller falls back to plain text: a missing renderer degrades a view, never the panel. `verify-arch-guards` rule **N24** keeps the drawn half honest — no literal `font-size`/`font`/`font-family` and no literal colour under `src/client`, only `var(--…)`, `calc(…)` or a CSS-wide keyword. The roll call of what the panel deliberately does not do is in `## Known limitations and deferred work`.

## Where the boundaries are

**Restore is confirmed here and deliberately not in the CLI.** The panel's only write is a two-click confirmation with its own Cancel; `/evolution skill undo` keeps no prompt at all, because typing the command IS the intent and the face has to stay scriptable. That asymmetry is a decision, not an oversight — it is written down so the question does not reopen.

**Browsing belongs to the skill centre; versions and restore belong here.** The panel lists the skills that recorded versions and shows nothing about curation or lifecycle beyond the marker facts the listing already carries, so it cannot grow into a second skill-management surface. The third-party skill browser (`dsh-client-ui-skill-explorer`) covers discovery; this panel covers what changed and how to go back.

## Build

The host half builds with the family's normal `packages/evolution/scripts/build-lib.mjs`. The browser half builds with `build-client.mjs`: discovery is automatic for a package that declares `dsh.client` and ships `src/client/index.ts`, and the artifact is the module loader's lazy CJS factory (`lib/client.js`).

## Model Experience

This package adds **no model-visible content**: no prompt section, no tool schema, no tool result text. It therefore has no token cost and no KV-cache effect. The panel is a human surface and its routes are loopback-only.

## Known limitations and deferred work

- **The rendered lane covers behaviour, not the assembled artifact.** `tests/panel.client.spec.ts` renders the panel under jsdom (result sentence survives the re-read, two-click confirmation with Cancel, a late rows reply for a skill the operator left is discarded, empty state and refusal) and `tests/client-apply.client.spec.ts` drives `apply` over a fake slot registry (one row, one keyed body, one locale namespace, and nothing left behind on dispose). What neither sees is the artifact the platform actually loads: module identity, the shell's stylesheet reaching the borrowed renderer, and the sidebar's own projection still need a live pass on an installed build.
- **The list shows skills with recorded versions only.** A skill that never wrote through the library has no history to browse, so it does not appear; the tree-wide listing stays with the skill catalog.
- **No quality and no last-use in the list.** Both are real and both are wanted, but they live in the curator's health view and the usage store; joining them into this listing would make the route a second home for facts it does not own. The row shows what the listing already holds (description, managed/protected markers, version count).
- **A support version can be read but not restored.** Its bytes and (from 0.14.0) its file name are recorded, and the preview shows them, but `undo` still refuses a support version by name: restoring one means deciding deletion semantics, path validation and what happens to a `scripts/` file, which is a design of its own.

- **Support-file bytes are history only.** They share the index with the body, so they are listed and labelled, but `undo` refuses them by name — the bytes stay in the blob store for a hand copy.
- **No occupancy row.** `.history` growth is documented in the evolution-core README; showing the size in the panel would promise a cleanup path the family has not designed (a whole-library reference count belongs to the curator).
