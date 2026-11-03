/**
 * Shared opaque page surface. Skin images may sit behind the shell; every
 * reading surface must paint the platform's base layer before text can be read.
 * @module @deepseek-ai/dsh-evolution-client-kit
 */

/** Class consumers put on the root of a full-page reading surface. */
export const PAGE_SURFACE_CLASS = 'evolution-page-surface'

/** Stylesheet for {@link PAGE_SURFACE_CLASS}; consumers append it to their own CSS. */
export const PAGE_SURFACE_CSS = '.evolution-page-surface{min-height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}'
