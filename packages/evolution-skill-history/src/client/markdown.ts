/**
 * The one seam onto the platform's Markdown renderer.
 *
 * Everything that renders Markdown in this panel goes through here, so the implementation can be
 * swapped in one file: today it is the platform's own `MarkdownText` (reached through the client
 * module table — zero bytes shipped, styles already in the shell, the same mdast pipeline the chat
 * uses); if that ever stops being reachable, a self-drawn renderer replaces this module and nothing
 * else changes.
 *
 * The words are NOT this module's: the face passes its locale dictionary in, because the platform
 * component takes its chrome as props.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { createElement, useMemo } from 'react'
import type { ReactNode } from 'react'

/** The three localized words the platform renderer needs; the face owns them. */
export interface MarkdownWords {
  readonly copy: string
  readonly copied: string
  /** The heading of the generated footnote section. */
  readonly footnotes: string
}

/** Copy-button labels forwarded to fenced code blocks. */
interface MarkdownCodeLabels {
  copyLabel: string
  copiedLabel: string
}

/** Localized Markdown chrome: every field the platform component requires. */
interface MarkdownLabels {
  code: MarkdownCodeLabels
  footnotes: string
}

/** What the renderer reads; the streaming and mention knobs are not used by this panel. */
interface MarkdownTextProps {
  text: string
  labels: MarkdownLabels
}

/** The component as the module table hands it over. */
type MarkdownTextComponent = (props: MarkdownTextProps) => unknown

/** One render attempt: the element, or the news that this deployment has no renderer. */
export type MarkdownRender =
  | { readonly ok: true; readonly node: unknown }
  | { readonly ok: false }

/** The module-table specifier; kept in one place so the seam is the only reader. */
const PLATFORM_UI_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

/**
 * The renderer a module row carries, when it carries one.
 *
 * A React component type is NOT always a function: the platform's own `MarkdownText` is
 * `memo(function MarkdownText …)`, and `memo` returns an OBJECT. A `typeof === 'function'` test
 * therefore rejected the real renderer and silently degraded every view to its source — exactly
 * what 0.14.0 shipped (measured on the installed panel 2026-09-28: `[预览]` and the rendered diff
 * both fell back). The accepted domain is React's element-type domain: a function, or a non-null
 * object it can mount. `tests/markdown.client.spec.ts` pins all four cases.
 * @param row - what the client module table handed over.
 * @returns the component, or undefined when the row carries none.
 */
export function rendererOf(row: { MarkdownText?: unknown }): MarkdownTextComponent | undefined {
  const candidate = row.MarkdownText
  if (typeof candidate === 'function') return candidate as MarkdownTextComponent
  if (typeof candidate === 'object' && candidate !== null) return candidate as MarkdownTextComponent
  return undefined
}

/**
 * The platform component, when this deployment's module table carries one.
 *
 * A row that IS reachable without a renderer is not a render: reporting one would move the failure
 * into the render itself, where only the slot's error boundary would catch it.
 * @returns the component, or undefined when it cannot be reached.
 */
function markdownText(): MarkdownTextComponent | undefined {
  try {
    // The module table's copy, reached the way `react` is: the specifier cannot be imported as
    // source (see platform-ui.d.ts), and the loader's require is the only door to it.
    // oxlint-disable-next-line typescript/no-require-imports -- the client module table is reachable only through the loader's require
    return rendererOf(require(PLATFORM_UI_MODULE) as { MarkdownText?: unknown })
  } catch {
    // No client-ui-primitives row in this deployment: stay quiet and let the caller fall back to
    // the source view rather than taking the panel down.
    return undefined
  }
}

/**
 * One document, rendered by the platform component under a labels object that survives re-renders.
 *
 * The component is memoized and the platform's own call sites memoize their labels for that reason:
 * this panel re-renders on every keystroke in its search field, and a fresh labels object per render
 * would take the whole document through the render again.
 * @param props - the resolved component, the Markdown source, and the localized words.
 * @returns the rendered document.
 */
function MarkdownBlock(props: { component: MarkdownTextComponent; text: string; words: MarkdownWords }): ReactNode {
  const { component: MarkdownText, text, words } = props
  const { copy, copied, footnotes } = words
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: copy, copiedLabel: copied }, footnotes,
  }), [copy, copied, footnotes])
  return createElement(MarkdownText, { text, labels })
}

/**
 * Render one Markdown document to an element tree.
 * @param text - the Markdown source (already bounded by the caller).
 * @param words - the localized Markdown chrome.
 * @returns the element, or `{ ok: false }` when the platform renderer is not reachable (the caller
 *   then keeps its own source view: a missing renderer degrades the view, never the panel).
 */
export function renderMarkdown(text: string, words: MarkdownWords): MarkdownRender {
  const component = markdownText()
  if (component === undefined) return { ok: false }
  return { ok: true, node: createElement(MarkdownBlock, { component, text, words }) }
}
