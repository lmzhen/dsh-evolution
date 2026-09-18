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

A card renders the namespace's user-writable (E3) fields with the registry's Chinese label, its unit, a 用户/部署 source chip, a control **typed from the registry** (switch / select / number / text) holding the current value, the registry's hint, and a per-field 恢复部署默认 action when a user override exists. The card's foot carries one 放弃修改 / 保存 pair: edits live in a draft, 保存 writes only the dirty fields in order and clears the draft on success, and a rejected write renders one line — the conflict copy for `SETTINGS_CONFLICT`, otherwise the owner's message verbatim, which is how the tighten-only and cross-field refusals reach the operator.

Writes go through the client settings scope (`set`/`unset`), which carries the revision it read as the write's fence; a field whose key is present in the raw user section reads as a user override even when its value equals the deployment value.

The field list AND the per-field UI metadata are GENERATED from the parameter registry (`packages/scripts/gen-param-client-view.mjs` writes `src/client/generated-params.ts`): id, group, the English summary, and the E3 rows' label / hint / control / unit / values. The browser half therefore cannot name a parameter the Host does not register, and cannot invent a control the registry does not declare. Regenerate after every registry edit; the family gate runs the generator with `--check`.

## Styling

The design system's CSS is not exported to packages outside the platform repository, so this bundle carries its own stylesheet and injects it once behind a `<style data-plugin-css="…">` tag — the mechanism the platform's own client bundles use. Every rule reads a `--dsw-alias-*` design token, so light and dark follow the theme without a colour of our own, and the field metrics (12px padding, 6px gap, 13px label, 12px hint) copy the platform's settings fields.

## Copy and locale

Section and card copy lives in `src/client/messages.ts` as a zh/en dictionary, registered through the platform's locale seat (`ctx.locale.register(namespace, { zh, en })` plus `bind`), so the nav entry and its copy follow the UI language. The earlier note in this file — that an outside package cannot bind the locale seat — was wrong: the out-of-repo market and skins plugins bind it exactly this way.

## Build

The browser half ships as the client module system's lazy CJS factory artifact (`lib/client.js`): `packages/scripts/build-client.mjs` runs tsdown for a CommonJS body and wraps it in `window.__ModuleLoader__.load({ id, factory })`, because the platform's own client bundle preset is not published for packages outside its repository. The Host half builds with the family's normal `packages/scripts/build-lib.mjs`.

## Known limitations and deferred work

- Only E3 (user-writable) rows are rendered; deployment tiers are reported by `/evolution params` and the doctor divergence section instead.
- The section renders plain controls styled with the design tokens rather than the platform's `@deepseek-ai/dsh-client-ui-primitives` kit: that module IS available to out-of-repo bundles (the market plugin requires it), but its prop shapes are not published, and guessing them would break the live GUI.
- A deployment that overrides a field through the `evolution-policy` row does not show on the card: the card reports the deployment value the settings scope serves, while the policy snapshot can differ. That divergence stays a doctor / `/evolution params` matter.
