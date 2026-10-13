/**
 * The panel stylesheet. The bundle is built outside the platform CSS-Modules pipeline, so it carries
 * the text itself and injects one tagged <style> element; the tag id keeps a hot reload from stacking
 * copies. Only the panel body is styled — the sidebar owns the row and its glyph slot.
 *
 * Every colour is a platform design token and every type step, space and radius is a FAMILY SCALE token
 * (`./tokens.ts`), so this panel cannot drift from the sibling half of the family.
 *
 * The metrics are COPIED from the platform’s own components rather than invented, each cited here:
 *
 * - label colours (`--dsw-alias-label-primary/secondary/tertiary`), hover and current-row fills
 *   (`--dsw-alias-interactive-bg-hover/active`) follow the platform sidebar row
 *   (client/ui-sidebar/…/SidebarRoot.module.css) as the sibling panel does;
 * - focus follows the same row (`--evo-focus-ring` + `--evo-focus-offset`, the family scale’s copy of
 *   the platform’s 2px inset ring);
 * - the field radius (`--evo-radius-6`) is the platform’s own Input primitive radius
 *   (client/ui-primitives/Input.module.css);
 * - the hairline border is `--evo-hairline-width`, the family scale’s copy of the platform’s 0.5px
 *   card border (client/ui-chat/…/GenericCommandCard.module.css).
 *
 * Layout: four verdict cards, then the by-rule table as a grid (rule / skills / count) so numbers sit
 * on tabular figures and long skill lists wrap into pills instead of ragged comma text.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import { TOKEN_CSS } from './tokens.ts'

/** Tag id for the injected <style>, so a hot reload replaces rather than stacks it. */
export const CSS_TAG_ID = 'dsh-evolution-skill-health'

const root = '.' + CSS_TAG_ID

/** The panel stylesheet text. */
export const CSS = [
  ':where(' + root + ') { ' + TOKEN_CSS + ' }',
  ':where(' + root + ') { display: flex; flex-direction: column; gap: var(--evo-space-12); padding: var(--evo-space-16); color: var(--dsw-alias-label-primary); font-size: var(--evo-type-sm); line-height: var(--evo-leading-base); }',
  ':where(' + root + ' [data-role="hint"]) { margin: 0; color: var(--dsw-alias-label-secondary); }',
  ':where(' + root + ' [data-role="stats"]) { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--evo-space-8); }',
  // The verdict bar is an inset shadow, not a border: the family guard forbids pixel geometry
  // literals in a client half (N25/N27), and the row tone below uses the same shape.
  ':where(' + root + ' [data-role="stat"]) { display: flex; flex-direction: column; gap: var(--evo-space-2); padding: var(--evo-space-8) var(--evo-space-10); border: var(--evo-hairline-width) solid var(--evo-line); border-radius: var(--evo-radius-6); }',
  ':where(' + root + ' [data-role="stat"][data-tone="ok"]) { box-shadow: inset 2px 0 0 var(--evo-tone-ok); }',
  ':where(' + root + ' [data-role="stat"][data-tone="warn"]) { box-shadow: inset 2px 0 0 var(--evo-tone-warn); }',
  ':where(' + root + ' [data-role="stat"][data-tone="error"]) { box-shadow: inset 2px 0 0 var(--evo-tone-error); }',
  ':where(' + root + ' [data-role="stat"][data-tone="unreadable"]) { box-shadow: inset 2px 0 0 var(--evo-tone-quiet); }',
  ':where(' + root + ' [data-role="stat-value"]) { font-size: var(--evo-type-lg); font-variant-numeric: tabular-nums; line-height: 1; }',
  ':where(' + root + ' [data-role="stat-label"]) { color: var(--dsw-alias-label-tertiary); }',
  ':where(' + root + ' [data-role="group-title"]) { margin: 0; font-weight: 500; }',
  ':where(' + root + ' [data-role="rule-table"]) { display: flex; flex-direction: column; border: var(--evo-hairline-width) solid var(--evo-line); border-radius: var(--evo-radius-6); overflow: hidden; }',
  ':where(' + root + ' [data-role="rule-row"]) { display: grid; grid-template-columns: minmax(9rem, 13rem) minmax(0, 1fr) 4rem; gap: var(--evo-space-10); align-items: center; padding: var(--evo-space-6) var(--evo-space-10); border-top: var(--evo-hairline-width) solid var(--evo-line); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="warn"]) { box-shadow: inset 2px 0 0 var(--evo-tone-warn); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="error"]) { box-shadow: inset 2px 0 0 var(--evo-tone-error); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="unreadable"]) { box-shadow: inset 2px 0 0 var(--evo-tone-quiet); }',
  ':where(' + root + ' [data-role="rule-row"]:hover) { background: var(--dsw-alias-interactive-bg-hover); }',
  ':where(' + root + ' [data-role="rule-row"]:focus-visible) { outline: var(--evo-focus-ring); outline-offset: var(--evo-focus-offset); }',
  ':where(' + root + ' [data-role="rule-head"]) { border-top: 0; color: var(--dsw-alias-label-tertiary); }',
  ':where(' + root + ' [data-role="rule-name"]) { overflow-wrap: anywhere; }',
  ':where(' + root + ' [data-role="rule-count"]) { text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }',
  ':where(' + root + ' [data-role="skills"]) { display: flex; flex-wrap: wrap; gap: var(--evo-space-4); }',
  ':where(' + root + ' [data-role="skill-pill"]) { padding: 0 var(--evo-space-6); border: var(--evo-hairline-width) solid var(--evo-line); border-radius: var(--evo-radius-6); color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
  ':where(' + root + ' [data-role="note"]) { margin: 0; color: var(--dsw-alias-label-secondary); }',
].join(String.fromCharCode(10))
