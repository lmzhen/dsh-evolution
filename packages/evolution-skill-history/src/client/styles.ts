/**
 * The panel’s stylesheet, injected once behind a `<style data-plugin-css=…>` tag.
 *
 * The bundle is built outside the platform’s CSS-Modules pipeline, so it carries its own string and
 * injects it the same way the family’s settings section does. Every rule reads the platform’s design
 * tokens, and the metrics are COPIED from the platform’s own components rather than invented:
 *
 * - the code block (`--dsw-font-markdown-code-block-small`, `.5px` border, `12px`, radius `12px`,
 *   `max-height: 260px`) is the platform command card’s `<pre>` (client/ui-chat/…/GenericCommandCard.module.css);
 * - hover / focus (`--dsw-alias-interactive-bg-hover`, a 2px inset focus ring) follow the platform
 *   sidebar row (client/ui-sidebar/…/SidebarRoot.module.css);
 * - the panel’s type scale is the platform TOKEN rather than a magic number, so it follows the
 *   deployment’s content size the way the platform’s own panels do;
 * - the capsule and the field metrics follow the family’s settings card, which copied them from the
 *   platform’s settings fields in the first place.
 *
 * Geometry (widths, paddings, radii, the 260px scroll cap) is a plain number here because the platform's
 * own components write geometry the same way; what must never be a literal is TYPE and COLOUR, and
 * every size and colour below is a token or a `calc()` over one.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

/** Tag id that makes the injection idempotent. */
export const CSS_TAG_ID = '@deepseek-ai/dsh-evolution-skill-history/panel.css'

/** The stylesheet the panel injects once. */
export const CSS = [
  // One step below the shell's chrome size, and NOT the setting behind `--dsh-content-font-size*`
  // (that one says it affects conversation content only, and the platform's own surfaces never read
  // it). The step is relative, so the panel scales with the shell, not with the conversation: the
  // dense list needs it — at the raw chrome size `dsh-evolution-maintenance` truncates in 264px.
  '.evo-hist-root{display:flex;height:100%;min-height:0;min-width:0;font-size:calc(1em - 1px);color:var(--dsw-alias-label-primary)}',
  '.evo-hist-aside{display:flex;flex-direction:column;flex:0 0 264px;width:264px;min-height:0;border-right:.5px solid var(--dsw-alias-border-l2)}',
  '.evo-hist-search{padding:12px 12px 4px}',
  '.evo-hist-search input{width:100%;box-sizing:border-box;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}',
  '.evo-hist-search input:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}',
  // 12px inline: the skill rows line up with the search field above them, not 6px to its left.
  '.evo-hist-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:4px 12px 10px}',
  '.evo-hist-empty{padding:8px 12px;color:var(--dsw-alias-label-tertiary)}',
  '.evo-hist-skill{display:block;width:100%;box-sizing:border-box;padding:7px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}',
  '.evo-hist-skill:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.evo-hist-skill:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}',
  '.evo-hist-skill[aria-current="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}',
  '.evo-hist-skill-line{display:flex;align-items:baseline;gap:6px}',
  '.evo-hist-skill-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.evo-hist-skill-count{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary)}',
  // A BLOCK box on purpose: `text-overflow` is inert on an inline span, and the description then
  // ran past the row's background into the pane divider (measured on the installed 0.13.1).
  '.evo-hist-skill-desc{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  // 12px both ways: the pane's first line and the aside's search field share one left edge.
  '.evo-hist-main{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;padding:12px 12px}',
  '.evo-hist-head{display:flex;align-items:center;gap:10px;margin:0 0 4px}',
  '.evo-hist-title{flex:1 1 auto;margin:0;font-size:calc(1em + 2px);font-weight:600}',
  '.evo-hist-hint{margin:0 0 10px;color:var(--dsw-alias-label-secondary);line-height:1.5}',
  '.evo-hist-pane-empty{margin:2px 0 0;color:var(--dsw-alias-label-tertiary)}',
  '.evo-hist-note{margin:0 0 10px;color:var(--dsw-alias-label-secondary);line-height:1.5;white-space:pre-wrap}',
  '.evo-hist-note[data-error="true"]{color:var(--dsw-alias-state-error-primary)}',
  '.evo-hist-group{margin:10px 0 2px;font-size:calc(1em - 1px);font-weight:600;color:var(--dsw-alias-label-secondary)}',
  // Separators use the platform's dominant hairline (`border-l2`); the first row of a group carries
  // none, so the group heading is not underlined by its own list.
  '.evo-hist-row{display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l2)}',
  '.evo-hist-row:first-of-type{border-top:0}',
  '.evo-hist-row-body{flex:1 1 auto;min-width:0}',
  '.evo-hist-row-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
  '.evo-hist-row-meta{color:var(--dsw-alias-label-tertiary)}',
  '.evo-hist-row-summary{margin-top:2px;color:var(--dsw-alias-label-secondary);line-height:1.5}',
  '.evo-hist-actions{display:flex;flex:none;align-items:center;gap:6px}',
  // A filled chip, not an outlined one: `当前` is a state, and the outline made it look clickable
  // next to the two real buttons beside it.
  '.evo-hist-capsule{flex:none;padding:1px 8px;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-secondary)}',
  '.evo-hist-button{flex:none;font:inherit;padding:3px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:inherit;cursor:pointer}',
  '.evo-hist-button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.evo-hist-button:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}',
  '.evo-hist-button[data-tone="primary"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
  '.evo-hist-pre{margin:6px 0 2px;padding:12px 16px;max-height:260px;overflow:auto;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap}',
  // Added/removed use the platform's semantic pair; `--dsw-alias-brand-primary` is the primary label
  // colour (near-black in light, near-white in dark), so the pair read as red-versus-plain.
  '.evo-hist-pre-add{color:var(--dsw-alias-state-success-primary)}',
  '.evo-hist-pre-del{color:var(--dsw-alias-state-error-primary)}',
].join('\n')
