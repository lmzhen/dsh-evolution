# @deepseek-ai/dsh-evolution-settings-ui

Web settings cards for the evolution family's parameter namespaces. The Host half registers nothing: the namespaces belong to the plugins that own them (evolution-review, memory-files, tool-memory, evolution-curator, tool-skill-manage), and this package's browser half claims one card per namespace in the keyed `settings.plugin.item` slot.

## What a card does

Each card renders the namespace's user-writable (E3) fields with their current value, a source badge, a write control and a revert control. Writes go through the client settings scope (`set`/`unset`), which carries the revision it read as the write's fence; a field whose key is present in the raw user section reads as a user override even when its value equals the deployment value.

The field list is GENERATED from the parameter registry (`packages/scripts/gen-param-client-view.mjs` writes `src/client/generated-params.ts`), so the browser half cannot name a parameter the Host does not register. Regenerate after every registry edit; the family gate runs the generator with `--check`.

## Build

The browser half ships as the client module system's lazy CJS factory artifact (`lib/client.js`): `packages/scripts/build-client.mjs` runs tsdown for a CommonJS body and wraps it in `window.__ModuleLoader__.load({ id, factory })`, because the platform's own client bundle preset is not published for packages outside its repository. The Host half builds with the family's normal `packages/scripts/build-lib.mjs`.

## Known limitations and deferred work

- Card copy lives in this package's own dictionary (`src/client/messages.ts`) and reaches components through the inject face; the platform locale seat is not bound yet (an outside package cannot declare an in-repo locale namespace type).
- The cards render plain controls with class names and no stylesheet: the family ships no CSS build step for client packages yet.
- Only E3 (user-writable) rows are rendered; deployment tiers are reported by `/evolution params` and the doctor divergence section instead.
