/**
 * The section's stylesheet.
 *
 * The platform's own client bundles compile CSS Modules into a string and inject
 * it once behind a \`<style data-plugin-css="<pkg>/<file>">\` tag; this bundle is
 * built outside that pipeline, so it carries its own string and injects it the
 * same way. Every rule reads the platform's design tokens (\`--dsw-alias-*\`), so
 * the section follows the light and dark themes without owning a colour, and the
 * field metrics (12px/6px padding-gap, 13px label, 12px hint) match the ones the
 * platform's own settings fields use.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */

/** Tag id that makes the injection idempotent. */
export const CSS_TAG_ID = '@deepseek-ai/dsh-evolution-settings-ui/settings.css'

/** The stylesheet the section injects once. */
export const CSS = [
  '.evolution-params{display:flex;flex-direction:column}',
  '.evolution-params-title{margin:0 0 4px;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:1.5}',
  '.evolution-params-subtitle{margin:0 0 16px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
  '.evolution-param-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px}',
  '.evolution-param-head{display:flex;align-items:center;gap:8px;width:100%;padding:12px 14px;background:none;border:0;text-align:left;cursor:pointer;color:inherit;font:inherit}',
  '.evolution-param-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.evolution-param-card-title{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
  '.evolution-param-count{color:var(--dsw-alias-brand-primary);font-size:12px;line-height:1.5}',
  '.evolution-param-chevron{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
  '.evolution-param-body{padding:0 14px 12px;border-top:.5px solid var(--dsw-alias-border-l3)}',
  '.evolution-param-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
  '.evolution-param-field+.evolution-param-field{border-top:.5px solid var(--dsw-alias-border-l4)}',
  '.evolution-param-label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
  '.evolution-param-unit{color:var(--dsw-alias-label-tertiary);font-weight:400}',
  '.evolution-param-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
  '.evolution-param-value{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
  '.evolution-param-input{width:100%;box-sizing:border-box;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
  '.evolution-param-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
  '.evolution-param-input:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-source{display:inline-flex;align-items:center;height:20px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}',
  '.evolution-param-source[data-user="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}',
  '.evolution-param-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:12px}',
  '.evolution-param-button{padding:6px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;cursor:pointer}',
  '.evolution-param-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  '.evolution-param-button[data-primary="true"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}',
  '.evolution-param-button[data-primary="true"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
  '.evolution-param-button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.evolution-param-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
  '.evolution-param-error{margin:0;color:var(--dsw-alias-label-error);font-size:12px;line-height:1.5}',
].join('')

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
