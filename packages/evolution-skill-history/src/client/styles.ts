/**
 * The panel’s stylesheet, injected once behind a `<style data-plugin-css=…>` tag.
 *
 * TWO FACES, ONE SCALE. The TOOL face (`.evo-hist-*`) is the compact list and its controls; the
 * READING face (`.evo-doc-*`, at the end) is a version rendered as a document. Each face owns its
 * rules and they never overlap: the list may be dense and full of controls, a document may not. That
 * is the whole reason for two prefixes — a rule that serves one face can no longer fight the other’s
 * comfort, and a third face would be another block rather than an edit here (§15.2 L2b, W22).
 *
 * Every colour is a platform design token; every type step and every geometry value is a family scale
 * token (`./tokens.ts`, generated from `packages/scripts/client-tokens.json`), so the two client
 * halves of this family cannot drift apart.
 *
 * The metrics themselves are COPIED from the platform’s own components rather than invented:
 *
 * - the code block (`--dsw-font-markdown-code-block-small`, `0.5px` border, `12px` padding, radius
 *   `12px`, `max-height: 260px`) is the platform command card’s `<pre>` (client/ui-chat/…/GenericCommandCard.module.css);
 * - hover / focus (`--dsw-alias-interactive-bg-hover`, a 2px inset focus ring) follow the platform
 *   sidebar row (client/ui-sidebar/…/SidebarRoot.module.css);
 * - the field radius (`8px`) is the platform’s own Input primitive (client/ui-primitives/Input.module.css);
 * - the panel’s type steps come from the family scale, which is relative to the shell’s chrome size —
 *   NOT the setting behind `--dsh-content-font-size*` (that one says it affects conversation content
 *   only, and the platform’s own surfaces never read it). The step is relative, so the panel scales
 *   with the shell, not with the conversation: the dense list needs it — at the raw chrome size
 *   `dsh-evolution-maintenance` truncates in 264px.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { tokenVars } from './tokens.ts'

/** Tag id that makes the injection idempotent. */
export const CSS_TAG_ID = '@deepseek-ai/dsh-evolution-skill-history/panel.css'

/** The stylesheet the panel injects once. */
export const CSS = [
  // The scale, declared on the panel root so it never leaks into the host shell.
  tokenVars('.evo-hist-root'),
  // ─── the tool face: the list, its rows, and the controls that act on a version ───
  '.evo-hist-root{display:flex;height:100%;min-height:0;min-width:0;font-size:var(--evo-type-sm);color:var(--dsw-alias-label-primary)}',
  '.evo-hist-aside{display:flex;flex-direction:column;flex:0 0 var(--evo-cap-aside);width:var(--evo-cap-aside);min-height:0;border-right:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evo-hist-search{padding:var(--evo-space-12) var(--evo-space-12) var(--evo-space-4)}',
  '.evo-hist-search input{width:100%;box-sizing:border-box;padding:var(--evo-space-6) var(--evo-space-10);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}',
  '.evo-hist-search input:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evo-hist-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:var(--evo-space-4) var(--evo-space-12) var(--evo-space-10)}',
  // An empty list starts where a ROW starts, so the first line of an empty pane and the first line of
  // a full one share one left edge (W16).
  '.evo-hist-empty{padding:var(--evo-space-6) var(--evo-space-8);margin:0;color:var(--dsw-alias-label-tertiary)}',
  '.evo-hist-skill{display:block;width:100%;box-sizing:border-box;padding:var(--evo-space-6) var(--evo-space-8);border:0;border-radius:var(--evo-radius-control);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}',
  '.evo-hist-skill:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.evo-hist-skill:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evo-hist-skill[aria-current="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}',
  // One line of cells. Only the `lead` slot may be clipped, and an `aside` cell is pushed to the far
  // edge and never shrinks: that is what keeps a row’s decision facts visible under any description
  // length (W1).
  '.evo-hist-cell-line{display:flex;align-items:baseline;gap:var(--evo-space-6);min-width:0}',
  '.evo-hist-cell-meta{margin-top:var(--evo-space-2)}',
  '.evo-hist-cell{min-width:0}',
  '.evo-hist-slot-lead{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.evo-hist-slot-meta{flex:none;white-space:nowrap}',
  '.evo-hist-slot-aside{flex:none;margin-left:auto;white-space:nowrap}',
  // A tone is the register a cell speaks in, relative to the face that hosts it: `primary` is the
  // row’s own emphasis, so the same cell reads correctly in a selected and an unselected row.
  '.evo-hist-tone-primary{color:inherit}',
  '.evo-hist-tone-secondary{color:var(--dsw-alias-label-secondary)}',
  '.evo-hist-tone-tertiary{color:var(--dsw-alias-label-tertiary)}',
  '.evo-hist-main{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;padding:var(--evo-space-12) var(--evo-space-12)}',
  '.evo-hist-head{display:flex;align-items:center;gap:var(--evo-space-10);margin:0 0 var(--evo-space-4)}',
  '.evo-hist-title{flex:1 1 auto;margin:0;font-size:var(--evo-type-lg);font-weight:600}',
  '.evo-hist-hint{margin:0 0 var(--evo-space-10);color:var(--dsw-alias-label-secondary);line-height:var(--evo-leading-base)}',
  // A notice owns a surface and a glyph, so a refusal is not carried by colour alone (W13).
  '.evo-hist-note{display:flex;align-items:flex-start;gap:var(--evo-space-6);margin:0 0 var(--evo-space-10);color:var(--dsw-alias-label-secondary);line-height:var(--evo-leading-base)}',
  '.evo-hist-note-text{min-width:0;white-space:pre-wrap}',
  '.evo-hist-note[data-error="true"]{color:var(--evo-tone-danger);background:var(--dsw-alias-bg-layer-2);border:var(--evo-hairline-width) solid var(--evo-tone-danger);border-radius:var(--evo-radius-control);padding:var(--evo-space-8) var(--evo-space-10)}',
  '.evo-hist-icon{flex:none;margin-top:.15em}',
  '.evo-hist-group{margin:var(--evo-space-10) 0 var(--evo-space-2);font-size:var(--evo-type-sm);font-weight:600;color:var(--dsw-alias-label-secondary)}',
  // A row is capped so its controls stay within reach of the text they act on: on a wide window the
  // tools used to sit ~700px away from the sentence they belonged to (W4). The cap is the reading
  // measure times one and a half, so it follows the scale rather than a window width.
  '.evo-hist-row{display:flex;align-items:flex-start;gap:var(--evo-space-8);padding:var(--evo-space-8) 0;border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);max-width:calc(var(--evo-measure-read) * 1.5);color:var(--dsw-alias-label-primary)}',
  '.evo-hist-row:first-of-type{border-top:0}',
  '.evo-hist-row-body{flex:1 1 auto;min-width:0}',
  '.evo-hist-row-title{display:flex;align-items:baseline;gap:var(--evo-space-8);min-width:0}',
  '.evo-hist-row-summary{margin-top:var(--evo-space-2);line-height:var(--evo-leading-base)}',
  '.evo-hist-actions{display:flex;flex:none;align-items:center;gap:var(--evo-space-6)}',
  // A chip is a STATE: it takes the neutral layer, not the interaction colour it used to borrow (W9).
  '.evo-hist-chip{flex:none;padding:var(--evo-space-2) var(--evo-space-8);border-radius:var(--evo-radius-pill);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
  // Two kinds of control, two shapes: one acts (bordered), one only reveals more (borderless, with a
  // drawn chevron), one chooses between two views (borderless text, no chevron). The primary tone is
  // reserved for the click that writes (W7/W14).
  '.evo-hist-button{display:inline-flex;flex:none;align-items:center;gap:var(--evo-space-2);font:inherit;padding:var(--evo-space-4) var(--evo-space-10);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:transparent;color:var(--evo-tone-quiet);cursor:pointer}',
  '.evo-hist-button[data-kind="toggle"],.evo-hist-button[data-kind="switch"]{padding:var(--evo-space-2) var(--evo-space-4);border-color:transparent;color:var(--evo-tone-quiet)}',
  '.evo-hist-button[data-kind="switch"][aria-pressed="true"]{color:var(--dsw-alias-label-primary)}',
  '.evo-hist-button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.evo-hist-button:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evo-hist-button[data-tone="primary"]{border-color:var(--evo-tone-primary);color:var(--evo-tone-primary)}',
  // ─── the reading face: one version as a document, and the rendered diff ───
  // A document is the page, not a card on it: no surface of its own, no inner scroll, and one measure
  // whatever the window is doing (W18/W20/W21). The pane's scrollbar is the only one a reader meets.
  '.evo-doc-preview{margin:var(--evo-space-6) 0 var(--evo-space-2);max-width:var(--evo-measure-read);line-height:var(--evo-leading-base)}',
  '.evo-doc-diff{display:flex;flex-direction:column;gap:var(--evo-space-8)}',
  '.evo-doc-head{display:flex;align-items:center;gap:var(--evo-space-8);max-width:var(--evo-measure-read)}',
  '.evo-doc-head .evo-hist-note{flex:1 1 auto;margin:0}',
  '.evo-doc-toggle{display:flex;flex:none;align-items:center;gap:var(--evo-space-6)}',
  // The SOURCE view is the platform’s code surface (a card with its own scroll), not prose: it keeps
  // the command card’s metrics, and it is the one place exact bytes are shown.
  '.evo-doc-source{margin:var(--evo-space-6) 0 var(--evo-space-2);padding:var(--evo-space-12) var(--evo-space-16);max-height:var(--evo-cap-block);overflow:auto;border:var(--evo-hairline-width) solid var(--dsw-alias-border-l1);border-radius:var(--evo-radius-surface);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap}',
  '.evo-doc-render{display:flex;flex-direction:column;gap:var(--evo-space-8);margin:var(--evo-space-6) 0 var(--evo-space-2);max-width:var(--evo-measure-read)}',
  '.evo-doc-block{position:relative;padding:var(--evo-space-8) var(--evo-space-12) var(--evo-space-8) var(--evo-space-20);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-left-width:var(--evo-hairline-marker);border-radius:var(--evo-radius-surface);background:var(--dsw-alias-markdown-code-block);overflow-x:auto}',
  '.evo-doc-del{border-left-color:var(--evo-tone-danger)}',
  '.evo-doc-add{border-left-color:var(--evo-tone-success)}',
  '.evo-doc-tag{position:absolute;left:var(--evo-space-8);top:var(--evo-space-8);color:var(--dsw-alias-label-tertiary)}',
  '.evo-doc-line-add{color:var(--evo-tone-success)}',
  '.evo-doc-line-del{color:var(--evo-tone-danger)}',
].join('\n')
