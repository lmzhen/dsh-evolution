/**
 * The panel stylesheet. The bundle is built outside the platform CSS-Modules pipeline, so it carries
 * the text itself and injects one tagged <style> element; the tag id keeps a hot reload from stacking
 * copies. Only the panel body is styled — the sidebar owns the row and its glyph slot.
 *
 * Every value comes from the generated family scale (`./tokens.ts`), so this file carries no literal.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import { TOKEN_CSS } from './tokens.ts'

/** Tag id for the injected <style>, so a hot reload replaces rather than stacks it. */
export const CSS_TAG_ID = 'dsh-evolution-skill-health'

const root = '.' + CSS_TAG_ID

/** The panel stylesheet text. */
export const CSS = [
  ':where(' + root + ') { display: flex; flex-direction: column; gap: var(--evo-space-8); padding: var(--evo-space-12); }',
  ':where(' + root + ') { ' + TOKEN_CSS + ' }',
  ':where(' + root + ' [data-role="row"]) { display: flex; align-items: baseline; justify-content: space-between; gap: var(--evo-space-8); border-bottom: var(--evo-hairline-width) solid var(--evo-tone-quiet); }',
  ':where(' + root + ' [data-role="note"]) { color: var(--evo-tone-quiet); }',
].join(String.fromCharCode(10))
