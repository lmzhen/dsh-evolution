/**
 * The family client scale - GENERATED from packages/scripts/client-tokens.json. Do not edit.
 *
 * Both browser halves of the family carry this file with identical bytes, because the scale is one
 * fact: `verify-client-tokens.mjs` (a gate step) fails when either copy drifts from the source. The
 * scale cannot be shared at runtime - a browser half may not import evolution-core, since every
 * `@deepseek-ai/*` specifier stays external in the client build and the platform module table has no
 * row for it - so the values are generated into each package instead.
 *
 * Usage: put `tokenVars(...)` for your root class in the package stylesheet, then read
 * `var(--evo-group-name)` in its rules.
 * Regenerate with: node packages/scripts/gen-client-tokens.mjs packages
 * @module @deepseek-ai/dsh-evolution-client-scale
 */

/** Every custom property of the scale, in the source order. */
export const TOKENS: Readonly<Record<string, string>> = {
  '--evo-type-lg': 'calc(1em + 2px)',
  '--evo-type-body': '1em',
  '--evo-type-sm': 'calc(1em - 1px)',
  '--evo-type-xs': 'calc(1em - 2px)',
  '--evo-space-2': '2px',
  '--evo-space-4': '4px',
  '--evo-space-6': '6px',
  '--evo-space-8': '8px',
  '--evo-space-10': '10px',
  '--evo-space-12': '12px',
  '--evo-space-14': '14px',
  '--evo-space-16': '16px',
  '--evo-space-20': '20px',
  '--evo-radius-chip': '4px',
  '--evo-radius-control': '8px',
  '--evo-radius-surface': '12px',
  '--evo-radius-pill': '999px',
  '--evo-hairline-width': '.5px',
  '--evo-hairline-marker': '2px',
  '--evo-measure-read': '80ch',
  '--evo-leading-base': '1.5',
  '--evo-tone-quiet': 'var(--dsw-alias-label-secondary)',
  '--evo-tone-primary': 'var(--dsw-alias-brand-primary)',
  '--evo-tone-danger': 'var(--dsw-alias-state-error-primary)',
  '--evo-tone-success': 'var(--dsw-alias-state-success-primary)',
  '--evo-focus-ring': '2px solid var(--dsw-alias-label-primary)',
  '--evo-focus-offset': '-2px',
  '--evo-cap-aside': '280px',
  '--evo-cap-block': '260px',
  '--evo-cap-preview': '420px',
}

/** The declarations, without a selector. */
export const TOKEN_CSS: string = '--evo-type-lg:calc(1em + 2px);--evo-type-body:1em;--evo-type-sm:calc(1em - 1px);--evo-type-xs:calc(1em - 2px);--evo-space-2:2px;--evo-space-4:4px;--evo-space-6:6px;--evo-space-8:8px;--evo-space-10:10px;--evo-space-12:12px;--evo-space-14:14px;--evo-space-16:16px;--evo-space-20:20px;--evo-radius-chip:4px;--evo-radius-control:8px;--evo-radius-surface:12px;--evo-radius-pill:999px;--evo-hairline-width:.5px;--evo-hairline-marker:2px;--evo-measure-read:80ch;--evo-leading-base:1.5;--evo-tone-quiet:var(--dsw-alias-label-secondary);--evo-tone-primary:var(--dsw-alias-brand-primary);--evo-tone-danger:var(--dsw-alias-state-error-primary);--evo-tone-success:var(--dsw-alias-state-success-primary);--evo-focus-ring:2px solid var(--dsw-alias-label-primary);--evo-focus-offset:-2px;--evo-cap-aside:280px;--evo-cap-block:260px;--evo-cap-preview:420px'

/**
 * The scale, declared on one element so it never leaks into the host shell.
 * @param scope - the selector the custom properties are declared on.
 * @returns the declaration block to put in the stylesheet.
 */
export function tokenVars(scope: string): string {
  return scope + '{' + TOKEN_CSS + '}'
}
