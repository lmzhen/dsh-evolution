# @deepseek-ai/dsh-evolution-settings-ui

Web settings section (**自进化**) for the evolution family's parameter namespaces. The Host half registers nothing: the namespaces belong to the plugins that own them (evolution-review, memory-files, tool-memory, evolution-curator, tool-skill-manage), and this package's browser half registers one settings section that hosts one card per namespace.

## Where it lives

The section goes through the platform's own seam — the same call the platform's 插件 section and the out-of-repo market / skins / Web-plugins sections use:

    ctx.slots.register({
      name: 'settings.section', id: 'evolution', order: 25,
      label: () => t('title'), locale: NS,
      children: { 'evolution.namespace.card': { kind: 'keyed', scope: 'root' } },
    }, SettingsSection)

The cards claim the keyed child slot per namespace, so a namespace the Host does not serve renders nothing, and a deployment that drops this row loses the whole section — no Host-side behaviour rides on this pair. Until 0.6.1 the cards lived inside the platform's 插件 section; 0.7.0 moved them into their own section, which is how every other feature area presents itself.

## What a card does

A card renders the namespace's user-writable (E3) fields with the registry's Chinese label, its unit, a 我改过／默认 source chip, a control **typed from the registry** (switch / select / number / text) holding the current value, the registry's hint, and a per-field 恢复默认值 action when a user override exists. A select's option TEXT comes from the registry's optional `valueLabels`; the option VALUE stays the raw spelling the settings document stores. The card's foot carries one 放弃修改 / 保存 pair: edits live in a draft, 保存 writes only the dirty fields in order, and a settling effect clears the draft once the Host kept every written key.

Success is never assumed from the write call: the client settings scope RESOLVES a refused write (it recovers the snapshot and returns; the remote call never rejects). Both scopes this bundle runs on — the platform's own controller and the bridge variant — finish that recovery read BEFORE the write promise resolves, so the user section read in the settling effect already reflects the outcome. Presence cannot BE the verdict: on a field the operator had already overridden, a refused value's key is present too, so the card records what it asked for (`{ id, want }` per staged write) and settles on whether the section now holds that value (`src/client/settle.ts`). A refusal then renders a line at the card's foot, below the field list, and the draft stays — nothing the operator typed is lost and a refusal never looks like a silent revert. The verdict cannot be read from the save callback itself: the raw snapshot is reachable only through the render-time seat (see the next section).

Writes go through the client settings scope (`set`/`unset`), which carries the revision it read as the write's fence; a field whose key is present in the raw user section reads as a user override even when its value equals the deployment value.

The field list AND the per-field UI metadata are GENERATED from the parameter registry (`packages/scripts/gen-param-client-view.mjs` writes `src/client/generated-params.ts`): id, group, the English summary, and the E3 rows' label / hint / control / unit / values / valueLabels. The browser half therefore cannot name a parameter the Host does not register, and cannot invent a control the registry does not declare. Regenerate after every registry edit; the family gate runs the generator with `--check`.

## The pending-write card

One card in the same section is not a parameter namespace: **「待批写入」** lists the staged self-evolution
writes and carries the two decisions plus a preview. It reads the approval plugin's loopback routes
(`src/client/api.ts` + `approval-routes.ts`; the path literals are compared against the host table by a spec),
wears the same card shell and button vocabulary as the parameter cards, and invents no state of its own.

The card rides that keyed slot with a key of its own (`approval-pending`): it has no namespace, so no
namespace-driven loop can name it — and a keyed slot renders ONLY the keys its section asks for, so
`SettingsSection` names it explicitly and puts it FIRST (it is the one card in this section that waits on a
decision). A registration nobody asks for renders nowhere: 0.16.0 shipped exactly that, which is why
`tests/section.client.spec.ts` now drives the real `apply()` and requires the section's `renderSlot` calls to cover
every key the bundle registers into the slot.

Its states are deliberately distinct: **reading** ("正在读取待批项…"), **empty** ("没有待批的写入") and
**failed** (the reason plus a retry). Merging the first two is what once made a slow answer read as lost data
(E7), so the state machine lives in `pending-state.ts` and the three are asserted without a browser.

It reads BOTH windows the route serves — `?status=pending` and `?status=executing` — and orders them the way
the CLI does. A record stuck in `executing` (an approve that died between the claim and the decision, or
another process running it) is NOT waiting for a decision: its row carries no approve/reject pair, says the
write may already have landed, and the header counts it apart ("{n} 项执行中"). Reading only the pending window
is what made such a record invisible here while `/evolution pending` and doctor both listed it.

The card re-reads the window on demand: a **refresh** control in the body and a window `focus`. It reads once
per mount otherwise — deliberately no timer, since the family has no polling precedent — because an agent can
stage a write while the reader is looking at the card, and the empty sentence standing there afterwards is the
"empty vs. actually something" lie.

A decision re-reads the window instead of editing the list locally (the host owns the state) and shows the
host's own sentence when it refuses. **Restore to default** (`unset`) is judged the same way as a save: the
reset's verdict is the next snapshot — the id must be GONE from the user layer, the opposite evidence a `set`
needs — so a host refusal prints "恢复默认值没有生效…" instead of leaving a chip that looks like a broken button,
the control reports its in-flight state, and a throwing settings service reaches the reader rather than
escaping as an unhandled rejection. `settle.ts` holds that one verdict function for both ops. **Preview** opens one row at a time: the facts line (`n 行新增` /
`n 行删除` / truncated) and the source block with `-`/`+` lines, the same shape the history panel's diff
uses; an unavailable preview prints the host's reason. A late answer for a row the reader already left is
dropped rather than painted under another row's heading.

## A seat that arrives late revives the card

The seat is probed lazily (never captured at apply time), but probing alone only answers the NEXT read —
a card that already painted 「本部署没有这个座位」 never asks again, and its row subscription was never
attached at all. `apply()` therefore subscribes to the platform's own arrival channel
(`ctx.inject(['configForms'], () => sources.revive())`): `revive` force-re-binds the form (a REPLACED
seat is picked up too), attaches the subscription and wakes every listener, so the card turns into a form
without a re-render and without a timer. The mechanism sentence this replaced — "the platform has no
service arrival signal" — was wrong: `ctx.inject` is exactly that signal (v46 S5.2 / T5-11).

## One save is one write, on both faces

A save hands the seat ONE op list (`mutateOnce(ops)`) instead of one call per field. The Plugins page
fences that list with the revision the render read, which is the platform's own form model ("apply
ordered field edits in one revision-fenced write"); the section path passes no fence, exactly as before.
Per-field calls with one shared render-time revision were the T5-01 bug: the host accepted the first
field, the revision moved, and every later field of the SAME save was refused with a conflict — the
change silently did not land while the card showed one generic refusal.

The stylesheet carries two structural invariants, both pinned by `tests/styles.client.spec.ts`: one
selector never carries two rules (the row chip and the preview's diff block were both
`.evolution-param-source`, so the diff rule's padding/border/overflow landed on a 20px chip and the
chip's `inline-flex` laid every diff line out in one row), and the family scale is declared on the
CARD root as well as the section root (the Plugins page renders the same card outside
`.evolution-params`, where a section-only declaration left every `--evo-*` undefined — no border, zero
padding, square corners).

## The `hooks` compartment never reaches the component

A card's inject face carries `hooks: { paramSection: source }` — that is the SHELL's seat, not a prop. The renderer binds each entry to a `use<Name>` seat and hands the component the face with `hooks` REMOVED (the slot contract is `PropsHooks<face['hooks']>` plus `Omit<face, 'hooks'>`). Reading `props.hooks` therefore reads a prop that never exists, and the failure only shows up at runtime, inside the save path.

The props type is spelled the way the renderer derives it — `Omit<ParamCardFace, 'hooks'> & { useParamSection }` — so re-introducing that mistake fails `tsc` instead of failing the operator's save. 0.7.0 shipped the mistake; 0.7.1 fixed it and derived the type this way.

## The seat contract: lazy probe, stable snapshot, one source object

`src/client/source.ts` is the one place that turns `configForms.get(namespace)` into the three things a card needs — a snapshot, a subscription and the two write calls — and it holds three obligations the platform's renderer imposes:

- **The seat is probed lazily.** `apply()` may run before the settings shell that declares this section and provides `configForms`, so a seat captured at apply time would pin the row to the empty state for the life of its fiber. The source reads a `SeatProbe` on every snapshot read; the write face re-probes per call.
- **The projected snapshot keeps ONE reference until the row's raw snapshot moves.** The renderer binds the `hooks` compartment through `useSyncExternalStoreWithSelector`, which compares by reference: a projection that builds an object per call never compares equal, so React aborts the card (minified invariant #185) and the slot error boundary replaces it with an empty placeholder — that is 0.17.0's "all the cards disappeared". The projection caches per raw snapshot reference, and a projection failure returns the frozen `PROJECTION_FAILED` snapshot instead of throwing: a throw from `getSnapshot()` happens inside the renderer's render pass, where this bundle cannot catch it and where a `try`/`catch` around a hook call would not be legal React.
- **One source object per namespace.** The renderer caches a hook binding per SOURCE object, so a source built per render re-binds the hook and remounts the card. `createSourceCache(probe)` owns the per-namespace cache and goes away with the fiber.

A card therefore tells three unavailable reasons apart — `seat-missing` (no settings surface composed), `projection-failed` (the seat served the row and reading it failed; the error is logged once) and `not-served` (the row itself is unavailable) — instead of painting one blank state. `N29`/`N30` in the family guard hold the shape of this seam, and `tests/section.client.spec.ts` pins the stable reference, the re-projection on change, the frozen failure value, the per-namespace identity and the late seat.

## Styling

The card draws from the FAMILY's scale, not from magic numbers: `src/client/tokens.ts` is generated from `packages/scripts/client-tokens.json` (identical bytes in the history panel, which shares it), and its type steps are relative to the surface that hosts the card — `calc(1em - 2px)` for a hint, `calc(1em + 2px)` for the title — so the card no longer resizes itself with the `--dsh-content-font-size*` setting, which is documented as affecting conversation content only and which the platform's own surfaces never read. Fields take the family's single focus ring (`outline: var(--evo-focus-ring)`), the same one the history panel draws, instead of a recoloured border. The design system's CSS is not exported to packages outside the platform repository, so this bundle carries its own stylesheet and injects it once behind a `<style data-plugin-css="…">` tag — the mechanism the platform's own client bundles use. Every rule reads a `--dsw-alias-*` design token, so light and dark follow the theme without a colour of our own, and the field metrics (12px padding, 6px gap, 13px label, 12px hint) copy the platform's settings fields.

## Copy and locale

Section and card copy lives in `src/client/messages.ts` as a zh/en dictionary, registered through the platform's locale seat (`ctx.locale.register(namespace, { zh, en })` plus `bind`), so the nav entry and its copy follow the UI language. The earlier note in this file — that an outside package cannot bind the locale seat — was wrong: the out-of-repo market and skins plugins bind it exactly this way.

## Build

The browser half ships as the client module system's lazy CJS factory artifact (`lib/client.js`): `packages/scripts/build-client.mjs` runs tsdown for a CommonJS body and wraps it in `window.__ModuleLoader__.load({ id, factory })`, because the platform's own client bundle preset is not published for packages outside its repository. The Host half builds with the family's normal `packages/scripts/build-lib.mjs`.

## Known limitations and deferred work

- Only E3 (user-writable) rows are rendered; deployment tiers are reported by `/evolution params` and the doctor divergence section instead.
- The section renders plain controls styled with the design tokens rather than the platform's `@deepseek-ai/dsh-client-ui-primitives` kit: that module IS available to out-of-repo bundles (the market plugin requires it), but its prop shapes are not published, and guessing them would break the live GUI.
- An unsaved draft lives in the card's own component state and the settings shell renders only the active section, so switching to another section drops a draft that was not saved yet. Values already written are unaffected; moving the draft into an apply-time store is the 0.7.x follow-up.
- A deployment that overrides a field through the `evolution-policy` row does not show on the card: the card reports the deployment value the settings scope serves, while the policy snapshot can differ. That divergence stays a doctor / `/evolution params` matter.
- The parameter card's spec covers the **wiring**, not the **assembly**. `tests/section.client.spec.ts` renders the real card component with the props the renderer actually builds — no `hooks`, the settings seat stubbed — so a wrong prop name or a missing `useParamSection` binding fails in CI, on top of `tests/settle.spec.ts` (the pure `landedWrites` decision, including the already-overridden refusal case). What no Node-level spec can see is the assembly the loader performs: the framework's real kit, the style scoping, the module identity handed to the bundle. Defects of that layer — two same-named classes overwriting each other, styles scoped to the wrong root — still surface only in a live pass on the installed artifact (0.7.0's save defect was found exactly there).
