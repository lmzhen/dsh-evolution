/**
 * The section's stylesheet.
 *
 * The platform's own client bundles compile CSS Modules into a string and inject
 * it once behind a `<style data-plugin-css="<pkg>/<file>">` tag; this bundle is
 * built outside that pipeline, so it carries its own string and injects it the
 * same way. Every colour reads the platform's design tokens (`--dsw-alias-*`), so
 * the section follows the light and dark themes without owning a colour; every
 * type step and geometry value reads the family scale (`./tokens.ts`, generated
 * from `packages/scripts/client-tokens.json`), the same one the history panel
 * draws from — before it existed this card rooted its type in
 * `--dsh-content-font-size*` (the CONVERSATION content size, which the platform's
 * own surfaces never read) and wrote its own paddings, so the family's two client
 * faces drifted apart (W2/W5/W6).
 *
 * The field metrics (8px/10px input padding, 8px radius, 12px/6px paddings and
 * gaps) follow the platform's own settings fields: `ui-primitives/Input.module.css`
 * and `ui-settings-plugins/.../fields.module.css` both use an 8px field radius.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import { tokenVars } from '@lmzhen/dsh-evolution-client-kit/tokens'

/** Tag id that makes the injection idempotent. */
export const CSS_TAG_ID = '@deepseek-ai/dsh-evolution-ui/settings.css'

/** The stylesheet the section injects once. */
export const CSS = [
  // The scale, declared on the section root AND on the card root. T5-03/A58: the Plugins page renders
  // the SAME card inside its own detail section, never under `.evolution-params`, so a section-only
  // declaration left every `--evo-*` undefined there (no border, zero padding, square corners).
  // Re-declaring on a nested root is harmless — the values are identical.
  tokenVars('.evolution-params,.evolution-param-card'),
  '.evolution-params{display:flex;flex-direction:column}',
  '.evolution-settings-tab{display:flex;flex-direction:column;gap:var(--evo-space-8)}',
  '.evolution-settings-group{margin:var(--evo-space-12) 0 0;font-size:var(--evo-type-sm);font-weight:600;color:var(--dsw-alias-label-secondary)}',
  '.evolution-params-title{margin:0 0 var(--evo-space-4);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-lg);font-weight:600;line-height:var(--evo-leading-base)}',
  '.evolution-params-subtitle{margin:0 0 var(--evo-space-16);color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-params-about{margin:0 0 var(--evo-space-16);color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs)}',
  '.evolution-param-card{border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1);margin-bottom:var(--evo-space-12)}',
  '.evolution-param-head{display:flex;align-items:center;gap:var(--evo-space-8);width:100%;padding:var(--evo-space-12) var(--evo-space-14);background:none;border:0;text-align:left;cursor:pointer;color:inherit;font:inherit}',
  '.evolution-param-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.evolution-param-card-title{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:var(--evo-type-sm);font-weight:500;line-height:var(--evo-leading-base)}',
  '.evolution-param-count{color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-chevron{color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-body{padding:0 var(--evo-space-14) var(--evo-space-12);border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  // U-5: the save destination, quieter than the chip it sits beside.
  '.evolution-param-dest{color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs)}',
  '.evolution-param-group{margin:var(--evo-space-12) 0 0;font-size:var(--evo-type-sm);font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:none}',
  '.evolution-param-field{display:flex;flex-direction:column;gap:var(--evo-space-6);padding:var(--evo-space-12) 0}',
  '.evolution-param-field+.evolution-param-field{border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evolution-param-label{display:flex;align-items:center;gap:var(--evo-space-6);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-body);font-weight:500;line-height:var(--evo-leading-base)}',
  '.evolution-param-unit{color:var(--dsw-alias-label-tertiary);font-weight:400}',
  '.evolution-param-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-sm);line-height:var(--evo-leading-base)}',
  '.evolution-param-value{color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-input{width:100%;box-sizing:border-box;padding:var(--evo-space-8) var(--evo-space-10);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-body);line-height:var(--evo-leading-base)}',
  // The family's one focus ring, the same one the history panel draws: a field that only recoloured
  // its border left a keyboard reader with a weaker affordance than the rest of the family (W8).
  '.evolution-param-input:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evolution-param-input:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-source{display:inline-flex;align-items:center;height:var(--evo-space-20);padding:0 var(--evo-space-6);border-radius:var(--evo-radius-chip);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs);line-height:var(--evo-space-20)}',
  '.evolution-param-source[data-user="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs)}',
  '.evolution-param-reset{margin-left:auto;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--evo-type-xs);cursor:pointer}',
  '.evolution-param-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
  '.evolution-param-reset:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-actions{display:flex;justify-content:flex-end;gap:var(--evo-space-8);padding-top:var(--evo-space-12)}',
  '.evolution-param-button{padding:var(--evo-space-6) var(--evo-space-12);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-sm);line-height:var(--evo-leading-base);cursor:pointer}',
  '.evolution-param-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  // U-6: the two weights beside primary — outlined alternative and weightless reveal.
  '.evolution-param-button[data-tone="outline"]{border-color:var(--dsw-alias-border-l2)}',
  '.evolution-param-button[data-tone="ghost"]{border-color:transparent;background:transparent}',
  '.evolution-param-button[data-primary="true"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}',
  '.evolution-param-button[data-primary="true"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
  '.evolution-param-button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-approval-item{padding:var(--evo-space-10) 0;border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evolution-approval-item:first-of-type{border-top:0}',
  '.evolution-approval-decision{display:flex;flex-direction:column;gap:var(--evo-space-8);padding:var(--evo-space-12);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1)}',
  '.evolution-approval-decision [data-role="decision-title"]{margin:0;font-size:var(--evo-type-sm);font-weight:600;line-height:var(--evo-leading-base)}',
  '.evolution-approval-decision [data-role="decision-summary"]{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs)}',
  '.evolution-approval-decision [data-role="decision-facts"]{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:var(--evo-space-4) var(--evo-space-12);margin:0;font-size:var(--evo-type-xs)}',
  '.evolution-approval-decision [data-role="decision-fact"]{display:contents}',
  '.evolution-approval-decision dt{color:var(--dsw-alias-label-tertiary)}',
  '.evolution-approval-decision dd{margin:0;color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}',
  '.evolution-approval-decision [data-role="decision-actions"]{display:flex;flex-wrap:wrap;align-items:center;gap:var(--evo-space-8);padding-top:var(--evo-space-8)}',
  '.evolution-approval-decision [data-role="decision-primary"],.evolution-approval-decision [data-role="decision-secondary"]{padding:var(--evo-space-6) var(--evo-space-12);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-sm);cursor:pointer}',
  '.evolution-approval-decision [data-role="decision-primary"]{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}',
  '.evolution-approval-decision [data-role="decision-primary"]:disabled,.evolution-approval-decision [data-role="decision-secondary"]:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-approval-decision [data-role="decision-details"] details{margin:0}',
  '.evolution-approval-decision [data-role="decision-details"] summary{cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs)}',
  '.evolution-approval-item [data-role="empty-state"]{padding:var(--evo-space-20) var(--evo-space-16);text-align:center}',
  '.evolution-approval-item [data-role="empty-title"]{margin:0 0 var(--evo-space-6);font-size:var(--evo-type-lg)}',
  '.evolution-approval-item [data-role="empty-description"]{margin:0 auto var(--evo-space-12);max-width:34em;color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-sm)}',
  '.evolution-approval-item [data-role="empty-actions"]{display:flex;justify-content:center;gap:var(--evo-space-8)}',
  '.evolution-approval-item [data-role="empty-primary"]{padding:var(--evo-space-6) var(--evo-space-12);border:0;border-radius:var(--evo-radius-control);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:var(--evo-type-sm);cursor:pointer}',
  '.evolution-approval-item [data-role="empty-secondary"]{padding:var(--evo-space-6) var(--evo-space-12);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--evo-type-sm);cursor:pointer}',
  '.evo-diag-issue{padding:var(--evo-space-10) var(--evo-space-12);border:var(--evo-hairline-width) solid var(--dsw-alias-state-warn-primary);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1)}',
  '.evo-diag-issue[data-status="fail"]{border-color:var(--dsw-alias-state-error-primary)}',
  '.evo-diag-complete{padding:var(--evo-space-10) var(--evo-space-12);border:var(--evo-hairline-width) solid var(--dsw-alias-state-success-primary);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-success-primary)}',
  '.evo-diag-group{display:flex;flex-direction:column;gap:var(--evo-space-4);margin-top:var(--evo-space-8)}',
  '.evo-diag-group>summary{cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs)}',
  '.evolution-param-select{width:100%;box-sizing:border-box;padding:var(--evo-space-8) var(--evo-space-10);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-sm);line-height:var(--evo-leading-base)}',
  '.evolution-param-select:focus-visible{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evolution-param-select:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-check{width:var(--evo-space-16);height:var(--evo-space-16);margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
  '.evolution-param-check:disabled{cursor:default;opacity:.5}',
  '.evolution-param-footer{display:flex;justify-content:flex-end;gap:var(--evo-space-8);padding:var(--evo-space-12) 0 0;border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evolution-param-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  // The preview a staged write shows before it runs: a facts line, then the SOURCE view. It borrows the
  // history panel's diff surface on purpose (code block with its own scroll, '-'/'+' lines under the tone
  // colours) — the two faces describe the same kind of change, so they read the same way.
  '.evolution-param-facts{display:flex;flex-wrap:wrap;align-items:baseline;margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-fact+.evolution-param-fact::before{content:"·";margin:0 var(--evo-space-6);color:var(--dsw-alias-label-tertiary)}',
  '.evolution-param-diff{margin:0;padding:var(--evo-space-12) var(--evo-space-16);max-height:var(--evo-cap-block);overflow:auto;border:var(--evo-hairline-width) solid var(--dsw-alias-border-l1);border-radius:var(--evo-radius-surface);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap}',
  '.evolution-param-line-add{color:var(--evo-tone-success)}',
  '.evolution-param-line-del{color:var(--evo-tone-danger)}',
  // W7 tail (0.27.1 feedback): the diagnostics card used `evo-diag-*` classes with no rules at all,
  // so facts/runtime rows collapsed into one inline run and the card had no body inset. These rules
  // give it the SAME geometry as the parameter cards (head 12/14, body 0 14 12, group h3) and a
  // label-above-value reading order; the status tone is the platform alias, always paired with text.
  '.evolution-param-loading{margin:var(--evo-space-12) 0 0;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evo-diag-badge{display:inline-flex;align-items:center;height:var(--evo-space-20);padding:0 var(--evo-space-8);border-radius:var(--evo-radius-chip);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs);line-height:var(--evo-space-20);flex:none}',
  '.evo-diag-badge[data-status="ok"]{color:var(--dsw-alias-state-success-primary)}',
  '.evo-diag-badge[data-status="warn"]{color:var(--dsw-alias-state-warn-primary)}',
  '.evo-diag-badge[data-status="fail"]{color:var(--dsw-alias-state-error-primary)}',
  '.evo-diag-badge[data-status="unknown"]{color:var(--dsw-alias-label-tertiary)}',
  '.evo-diag-list{display:flex;flex-direction:column}',
  '.evo-diag-item{padding:var(--evo-space-12) 0}',
  '.evo-diag-item+.evo-diag-item{border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evo-diag-label{display:block;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evo-diag-row-head{display:flex;align-items:baseline;gap:var(--evo-space-6);flex-wrap:wrap}',
  '.evo-diag-dot{width:var(--evo-space-6);height:var(--evo-space-6);border-radius:var(--evo-radius-pill);background:var(--evo-diag-tone,var(--dsw-alias-label-tertiary));flex:none}',
  '.evo-diag-status{color:var(--evo-diag-tone,var(--dsw-alias-label-tertiary));font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evo-diag-item[data-status="ok"]{--evo-diag-tone:var(--dsw-alias-state-success-primary)}',
  '.evo-diag-item[data-status="warn"]{--evo-diag-tone:var(--dsw-alias-state-warn-primary)}',
  '.evo-diag-item[data-status="fail"]{--evo-diag-tone:var(--dsw-alias-state-error-primary)}',
  '.evo-diag-item[data-status="unknown"]{--evo-diag-tone:var(--dsw-alias-label-tertiary)}',
  '.evo-diag-detail{display:block;margin:var(--evo-space-2) 0 0;color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base);overflow-wrap:anywhere}',
  '.evo-diag-remedy{display:block;margin:var(--evo-space-4) 0 0;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
].join('\n')

/** The slice of the DOM the injection touches (this package typechecks without DOM lib). */
interface StyleHost {
  querySelector(selector: string): unknown
  /** The element shape the injection uses. `remove()` is on the real DOM element and is what the
   * S5-08 disposer calls, so the host shape names it too - otherwise the package cannot typecheck
   * without the DOM lib while still using the disposal the browser offers. */
  createElement(tag: string): { dataset: Record<string, string>; textContent: string; remove(): void }
  head: { appendChild(node: unknown): void }
}

/**
 * Inject the stylesheet once per document.
 *
 * S5-08: it RETURNS the disposer. The tag check alone answered only half the question - "is it
 * there" - and left "who takes it away" to nobody, so a hot reload (unmount, remount) found the old
 * tag, skipped the injection, and kept serving the PREVIOUS bundle CSS. skill-history hands its
 * disposer back to the fiber; this is the same shape for the same concern.
 * @param host - the document to inject into; defaults to the global one.
 * @returns the disposal; a no-op when there is no document or the tag was already present.
 */
export function injectStyles(host?: StyleHost): () => void {
  const doc = host ?? (globalThis as { document?: StyleHost }).document
  if (doc === undefined) return () => {}
  const previous = doc.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]')
  // P2-29: replace, don't reuse — the old owner's disposer must not be able to
  // remove the stylesheet the surviving owner is rendering with.
  ;(previous as { remove?: () => void } | null)?.remove?.()
  const tag = doc.createElement('style')
  tag.dataset.plugin = '@deepseek-ai/dsh-evolution-ui'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
  return () => { tag.remove() }
}
