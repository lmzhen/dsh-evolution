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
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import { tokenVars } from './tokens.ts'

/** Tag id that makes the injection idempotent. */
export const CSS_TAG_ID = '@deepseek-ai/dsh-evolution-settings-ui/settings.css'

/** The stylesheet the section injects once. */
export const CSS = [
  // The scale, declared on the section root so it never leaks into the host shell.
  tokenVars('.evolution-params'),
  '.evolution-params{display:flex;flex-direction:column}',
  '.evolution-params-title{margin:0 0 var(--evo-space-4);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-lg);font-weight:600;line-height:var(--evo-leading-base)}',
  '.evolution-params-subtitle{margin:0 0 var(--evo-space-16);color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-card{border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1);margin-bottom:var(--evo-space-12)}',
  '.evolution-param-head{display:flex;align-items:center;gap:var(--evo-space-8);width:100%;padding:var(--evo-space-12) var(--evo-space-14);background:none;border:0;text-align:left;cursor:pointer;color:inherit;font:inherit}',
  '.evolution-param-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.evolution-param-card-title{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:var(--evo-type-sm);font-weight:500;line-height:var(--evo-leading-base)}',
  '.evolution-param-count{color:var(--dsw-alias-brand-primary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-chevron{color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-body{padding:0 var(--evo-space-14) var(--evo-space-12);border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evolution-param-field{display:flex;flex-direction:column;gap:var(--evo-space-6);padding:var(--evo-space-12) 0}',
  '.evolution-param-field+.evolution-param-field{border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evolution-param-label{display:flex;align-items:center;gap:var(--evo-space-6);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-body);font-weight:500;line-height:var(--evo-leading-base)}',
  '.evolution-param-unit{color:var(--dsw-alias-label-tertiary);font-weight:400}',
  '.evolution-param-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-sm);line-height:var(--evo-leading-base)}',
  '.evolution-param-value{color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-input{width:100%;box-sizing:border-box;padding:var(--evo-space-8) var(--evo-space-10);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-body);line-height:var(--evo-leading-base)}',
  // The family's one focus ring, the same one the history panel draws: a field that only recoloured
  // its border left a keyboard reader with a weaker affordance than the rest of the family (W8).
  '.evolution-param-input:focus{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evolution-param-input:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-source{display:inline-flex;align-items:center;height:var(--evo-space-20);padding:0 var(--evo-space-6);border-radius:var(--evo-radius-chip);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:var(--evo-type-xs);line-height:var(--evo-space-20)}',
  '.evolution-param-source[data-user="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}',
  '.evolution-param-actions{display:flex;justify-content:flex-end;gap:var(--evo-space-8);padding-top:var(--evo-space-12)}',
  '.evolution-param-button{padding:var(--evo-space-6) var(--evo-space-12);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-sm);line-height:var(--evo-leading-base);cursor:pointer}',
  '.evolution-param-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  '.evolution-param-button[data-primary="true"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}',
  '.evolution-param-button[data-primary="true"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
  '.evolution-param-button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-select{width:100%;box-sizing:border-box;padding:var(--evo-space-8) var(--evo-space-10);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2);border-radius:var(--evo-radius-control);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--evo-type-sm);line-height:var(--evo-leading-base)}',
  '.evolution-param-select:focus{outline:var(--evo-focus-ring);outline-offset:var(--evo-focus-offset)}',
  '.evolution-param-select:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-check{width:var(--evo-space-16);height:var(--evo-space-16);margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
  '.evolution-param-check:disabled{cursor:default;opacity:.5}',
  '.evolution-param-footer{display:flex;justify-content:flex-end;gap:var(--evo-space-8);padding:var(--evo-space-12) 0 0;border-top:var(--evo-hairline-width) solid var(--dsw-alias-border-l2)}',
  '.evolution-param-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
  '.evolution-param-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:var(--evo-type-xs);line-height:var(--evo-leading-base)}',
].join('\n')

/** The slice of the DOM the injection touches (this package typechecks without DOM lib). */
interface StyleHost {
  querySelector(selector: string): unknown
  createElement(tag: string): { dataset: Record<string, string>; textContent: string }
  head: { appendChild(node: unknown): void }
}

/**
 * Inject the stylesheet once per document.
 * @param host - the document to inject into; defaults to the global one.
 */
export function injectStyles(host?: StyleHost): void {
  const doc = host ?? (globalThis as { document?: StyleHost }).document
  if (doc === undefined) return
  if (doc.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = '@deepseek-ai/dsh-evolution-settings-ui'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
}
