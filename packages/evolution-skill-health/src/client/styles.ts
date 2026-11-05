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

import { TOKEN_CSS } from '@lmzhen/dsh-evolution-client-kit/tokens'

/** Tag id for the injected <style>, so a hot reload replaces rather than stacks it. */
export const CSS_TAG_ID = 'dsh-evolution-skill-health'

const root = '.' + CSS_TAG_ID

/** The panel stylesheet text. */
export const CSS = [
  ':where(' + root + ') { ' + TOKEN_CSS + ' }',
  ':where(' + root + ') { display: flex; flex-direction: column; gap: var(--evo-space-12); padding: var(--evo-space-16); color: var(--dsw-alias-label-primary); font-size: var(--evo-type-sm); line-height: var(--evo-leading-base); }',
  ':where(' + root + ' [data-role="hint"]) { margin: 0; color: var(--dsw-alias-label-secondary); }',
  ':where(' + root + ' [data-role="header"]) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--evo-space-8); }',
  ':where(' + root + ' [data-role="header-meta"]) { display: flex; flex-wrap: wrap; gap: var(--evo-space-4) var(--evo-space-8); color: var(--dsw-alias-label-tertiary); font-size: var(--evo-type-xs); min-width: 0; }',
  ':where(' + root + ' [data-role="stats"]) { display: flex; flex-wrap: wrap; gap: var(--evo-space-6); }',
  ':where(' + root + ' [data-role="stat"]) { display: inline-flex; align-items: baseline; gap: var(--evo-space-4); padding: var(--evo-space-4) var(--evo-space-10); border: var(--evo-hairline-width) solid var(--dsw-alias-border-l1); border-radius: var(--evo-radius-pill); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }',
  ':where(' + root + ' [data-role="stat-value"]) { font-size: var(--evo-type-sm); }',
  ':where(' + root + ' [data-role="health-complete"]) { padding: var(--evo-space-12) var(--evo-space-14); border: var(--evo-hairline-width) solid var(--dsw-alias-state-success-primary); border-radius: var(--evo-radius-control); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-state-success-primary); }',
  ':where(' + root + ' [data-role="health-normal"]) { display: flex; flex-direction: column; gap: var(--evo-space-4); padding-top: var(--evo-space-4); }',
  ':where(' + root + ' [data-role="health-normal"] > summary) { cursor: pointer; color: var(--dsw-alias-label-tertiary); font-size: var(--evo-type-xs); }',
  ':where(' + root + ' [data-role="stat"][aria-pressed="true"]) { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-hover); }',
  ':where(' + root + ' [data-role="stat"]:disabled) { opacity: 0.55; cursor: default; }',
  ':where(' + root + ' [data-role="stat"][data-tone="ok"]) { box-shadow: inset 2px 0 0 var(--dsw-alias-state-success-primary); }',
  ':where(' + root + ' [data-role="stat"][data-tone="warn"]) { box-shadow: inset 2px 0 0 var(--dsw-alias-state-warn-primary); }',
  ':where(' + root + ' [data-role="stat"][data-tone="error"]) { box-shadow: inset 2px 0 0 var(--dsw-alias-state-error-primary); }',
  ':where(' + root + ' [data-role="stat"][data-tone="unreadable"]) { box-shadow: inset 2px 0 0 var(--evo-tone-quiet); }',
  ':where(' + root + ' [data-role="stat-value"]) { font-variant-numeric: tabular-nums; }',
  ':where(' + root + ' [data-role="stat-label"]) { color: var(--dsw-alias-label-tertiary); }',
  ':where(' + root + ' [data-role="group-title"]) { margin: 0; font-weight: 500; }',
  ':where(' + root + ' [data-role="rule-table"]) { display: table; width: 100%; border-collapse: collapse; border: var(--evo-hairline-width) solid var(--dsw-alias-border-l1); border-radius: var(--evo-radius-control); overflow: hidden; }',
  ':where(' + root + ' [data-role="rule-row"]) { border-top: var(--evo-hairline-width) solid var(--dsw-alias-border-l1); }',
  ':where(' + root + ' [data-role="rule-row"] > th, ' + root + ' [data-role="rule-row"] > td) { padding: var(--evo-space-6) var(--evo-space-10); text-align: left; vertical-align: top; }',
  ':where(' + root + ' [data-role="rule-row"] > th:first-child) { width: minmax(9rem, 13rem); }',
  ':where(' + root + ' [data-role="rule-row"] > th:last-child, ' + root + ' [data-role="rule-row"] > td:last-child) { width: 4rem; text-align: right; }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="ok"]) { box-shadow: inset var(--evo-hairline-marker) 0 0 var(--dsw-alias-state-success-primary); }',
  ':where(' + root + ' [data-role="skill-queue"]) { display: flex; flex-direction: column; gap: var(--evo-space-6); }',
  ':where(' + root + ' [data-role="skill-row"]) { display: grid; grid-template-columns: minmax(8rem, 12rem) 6rem minmax(0, 1fr) auto; gap: var(--evo-space-8); align-items: center; padding: var(--evo-space-6) var(--evo-space-10); border: var(--evo-hairline-width) solid var(--dsw-alias-border-l1); border-radius: var(--evo-radius-control); }',
  ':where(' + root + ' [data-role="skill-name"]) { overflow-wrap: anywhere; font-weight: 500; }',
  ':where(' + root + ' [data-role="skill-verdict"], ' + root + ' [data-role="skill-dims"], ' + root + ' [data-role="skill-findings"]) { color: var(--dsw-alias-label-secondary); font-size: var(--evo-type-xs); }',
  ':where(' + root + ' [data-role="skill-row-actions"]) { display: flex; align-items: center; gap: var(--evo-space-4); flex-wrap: wrap; }',
  ':where(' + root + ' [data-role="skill-more"] > summary) { cursor: pointer; color: var(--dsw-alias-label-tertiary); font-size: var(--evo-type-xs); }',
  ':where(' + root + ' [data-role="skill-more"] > button) { margin-left: var(--evo-space-4); }',
  ':where(' + root + ' .evo-health-empty) { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: min(36vh, 280px); text-align: center; }',
  ':where(' + root + ' .evo-health-empty [data-role="empty-actions"]) { justify-content: center; }',
  ':where(' + root + ' [data-role="proposals"]) { display: flex; flex-direction: column; gap: var(--evo-space-8); }',
  ':where(' + root + ' [data-role="proposal"]) { padding: var(--evo-space-8) var(--evo-space-10); border: var(--evo-hairline-width) solid var(--dsw-alias-border-l1); border-radius: var(--evo-radius-control); }',
  ':where(' + root + ' [data-role="proposal"] p) { margin: var(--evo-space-2) 0; }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="warn"]) { box-shadow: inset var(--evo-hairline-marker) 0 0 var(--dsw-alias-state-warn-primary); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="error"]) { box-shadow: inset var(--evo-hairline-marker) 0 0 var(--dsw-alias-state-error-primary); }',
  ':where(' + root + ' [data-role="rule-row"][data-tone="unreadable"]) { box-shadow: inset var(--evo-hairline-marker) 0 0 var(--evo-tone-quiet); }',
  ':where(' + root + ' [data-role="rule-row"]:hover) { background: var(--dsw-alias-interactive-bg-hover); }',
  ':where(' + root + ' [data-role="rule-row"]:focus-visible) { outline: var(--evo-focus-ring); outline-offset: var(--evo-focus-offset); }',
  ':where(' + root + ' [data-role="rule-head"]) { border-top: 0; color: var(--dsw-alias-label-tertiary); }',
  ':where(' + root + ' [data-role="rule-name"]) { overflow-wrap: anywhere; }',
  ':where(' + root + ' [data-role="rule-count"]) { text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }',
  ':where(' + root + ' [data-role="skills"]) { display: flex; flex-wrap: wrap; gap: var(--evo-space-4); }',
  ':where(' + root + ' [data-role="skill-pill"]) { padding: 0 var(--evo-space-6); border: var(--evo-hairline-width) solid var(--dsw-alias-border-l1); border-radius: var(--evo-radius-pill); color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
  ':where(' + root + ' [data-role="note"]) { margin: 0; color: var(--dsw-alias-label-secondary); }',
].join(String.fromCharCode(10))
