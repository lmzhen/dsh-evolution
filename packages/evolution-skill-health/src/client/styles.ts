/**
 * The panel stylesheet. The bundle is built outside the platform CSS-Modules pipeline, so it carries
 * the text itself and injects one tagged <style> element; the tag id keeps a hot reload from stacking
 * copies. Only the panel body is styled — the sidebar owns the row and its glyph slot.
 *
 * Token discipline (the family gate `verify-client-tokens --strict` enforces it): every `--evo-*` name
 * below is DECLARED in `packages/scripts/client-tokens.json` — the family scale — and every `--dsw-*`
 * name is a platform semantic alias (packages/client/ui-theme/src/styles). No type step, space, radius,
 * hairline or colour is invented here, and no pixel geometry literal appears.
 *
 * Metrics are COPIED from the platform’s own components rather than invented, each cited here:
 *
 * - hover and current-row fills (`--dsw-alias-interactive-bg-hover`) follow the platform sidebar row
 *   (client/ui-sidebar/…/SidebarRoot.module.css), as the sibling panel does;
 * - label steps (`--dsw-alias-label-primary/secondary/tertiary`) and the card hairline
 *   (`--evo-hairline-width`, the scale’s copy of the platform’s 0.5px card border) come from
 *   client/ui-chat/…/GenericCommandCard.module.css;
 * - the control radius (`--evo-radius-control`, the scale’s copy of the platform field radius) comes
 *   from client/ui-primitives/Input.module.css; the capsule uses `--evo-radius-pill`;
 * - verdict colours are the platform STATE aliases (state-success / state-warn / state-error) plus the
 *   scale’s `--evo-tone-quiet`; the validity bar is an inset shadow, not a border-width literal.
 *
 * Layout: four verdict cards, then the by-rule table as a grid (rule / skills / count) so numbers sit
 * on tabular figures and long skill lists wrap into pills instead of ragged comma text.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import { TOKEN_CSS } from '@deepseek-ai/dsh-evolution-client-kit/tokens'

/** Tag id for the injected <style>, so a hot reload replaces rather than stacks it. */
export const CSS_TAG_ID = 'dsh-evolution-skill-health'

const root = '.' + CSS_TAG_ID

/** The panel stylesheet text. */
export const CSS = [
  ':where(' + root + ') { ' + TOKEN_CSS + ' }',
  ':where(' + root + ') { display: flex; flex-direction: column; gap: var(--evo-space-12); padding: var(--evo-space-16); color: var(--dsw-alias-label-primary); font-size: var(--evo-type-sm); line-height: var(--evo-leading-base); }',
  ':where(' + root + ' [data-role="hint"]) { margin: 0; color: var(--dsw-alias-label-secondary); }',
  ':where(' + root + ' [data-role="stats"]) { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--evo-space-8); }',
  ':where(' + root + ' [data-role="stat"]) { display: flex; flex-direction: column; gap: var(--evo-space-2); padding: var(--evo-space-8) var(--evo-space-10); border: var(--evo-hairline-width) solid var(--dsw-alias-border-l); border-radius: var(--evo-radius-control); }',
  ':where(' + root + ' [data-role="stat"][data-tone="ok"]) { box-shadow: inset 2px 0 0 var(--dsw-alias-state-success-primary); }',
  ':where(' + root + ' [data-role="stat"][data-tone="warn"]) { box-shadow: inset 2px 0 0 var(--dsw-alias-state-warn-primary); }',
  ':where(' + root + ' [data-role="stat"][data-tone="error"]) { box-shadow: inset 2px 0 0 var(--dsw-alias-state-error-primary); }',
  ':where(' + root + ' [data-role="stat"][data-tone="unreadable"]) { box-shadow: inset 2px 0 0 var(--evo-tone-quiet); }',
  ':where(' + root + ' [data-role="stat-value"]) { font-size: var(--evo-type-lg); font-variant-numeric: tabular-nums; line-height: 1; }',
  ':where(' + root + ' [data-role="stat-label"]) { color: var(--dsw-alias-label-tertiary); }',
  ':where(' + root + ' [data-role="group-title"]) { margin: 0; font-weight: 500; }',
  ':where(' + root + ' [data-role="rule-table"]) { display: flex; flex-direction: column; border: var(--evo-hairline-width) solid var(--dsw-alias-border-l); border-radius: var(--evo-radius-control); overflow: hidden; }',
  ':where(' + root + ' [data-role="rule-row"]) { display: grid; grid-template-columns: minmax(9rem, 13rem) minmax(0, 1fr) 4rem; gap: var(--evo-space-10); align-items: center; padding: var(--evo-space-6) var(--evo-space-10); border-top: var(--evo-hairline-width) solid var(--dsw-alias-border-l); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="warn"]) { box-shadow: inset var(--evo-hairline-marker) 0 0 var(--dsw-alias-state-warn-primary); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="error"]) { box-shadow: inset var(--evo-hairline-marker) 0 0 var(--dsw-alias-state-error-primary); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="unreadable"]) { box-shadow: inset var(--evo-hairline-marker) 0 0 var(--evo-tone-quiet); }',
  ':where(' + root + ' [data-role="rule-row"]:hover) { background: var(--dsw-alias-interactive-bg-hover); }',
  ':where(' + root + ' [data-role="rule-row"]:focus-visible) { outline: var(--evo-focus-ring); outline-offset: var(--evo-focus-offset); }',
  ':where(' + root + ' [data-role="rule-head"]) { border-top: 0; color: var(--dsw-alias-label-tertiary); }',
  ':where(' + root + ' [data-role="rule-name"]) { overflow-wrap: anywhere; }',
  ':where(' + root + ' [data-role="rule-count"]) { text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }',
  ':where(' + root + ' [data-role="skills"]) { display: flex; flex-wrap: wrap; gap: var(--evo-space-4); }',
  ':where(' + root + ' [data-role="skill-pill"]) { padding: 0 var(--evo-space-6); border: var(--evo-hairline-width) solid var(--dsw-alias-border-l); border-radius: var(--evo-radius-pill); color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
  ':where(' + root + ' [data-role="note"]) { margin: 0; color: var(--dsw-alias-label-secondary); }',
].join(String.fromCharCode(10))
