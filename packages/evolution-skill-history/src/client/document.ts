/**
 * The READING face: one version rendered as a document, and the rendered diff.
 *
 * This file is the only place that decides how a document reads (G4). The tool face (`chrome.ts`)
 * picks versions and acts on them; here the rules are the reader's, and they follow the positioning
 * ruling of §14.0: a document is read, not scanned — one measure, page-like spacing, no inner scroll
 * (W18/W20/W21/W22). Nothing here is a control except the source/rendered choice, which belongs to
 * the reader rather than to the panel's actions.
 *
 * The text arrives already prepared: the host strips the frontmatter block through core's
 * `displayBodyOf`, because a browser half cannot import core. The RENDERED DIFF keeps the whole text
 * on purpose — a diff is about what CHANGED, and a metadata change is a change.
 *
 * It degrades rather than blanking: when the platform's renderer cannot be reached, the exact text is
 * shown instead, and the reader can still read the version.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { createElement, useState, type ReactNode } from 'react'
import { button, note } from './atoms.ts'
import type { VersionBodyRow, VersionDiffRow } from './api.ts'
import type { Copy } from './chrome.ts'
import { renderMarkdown, type MarkdownWords } from './markdown.ts'

/** What one expanded diff holds: the change, still loading, or a refusal. */
export type DiffState = { kind: 'loading' } | { kind: 'ready'; diff: VersionDiffRow } | { kind: 'failed'; message: string }

/** What one expanded preview holds. */
export type BodyState = { kind: 'loading' } | { kind: 'ready'; body: VersionBodyRow } | { kind: 'failed'; message: string }

/** What the reading face needs: the dictionary seat, plus the two words the platform renderer takes. */
export interface DocumentFace extends Copy {
  readonly markdownWords: MarkdownWords
}

/** One `<pre>` rendering of a diff: added lines marked `+`, removed ones `-`. */
function sourceBlock(diff: VersionDiffRow): ReactNode {
  const rows: ReactNode[] = []
  for (const hunk of diff.hunks) {
    for (const [index, line] of hunk.oldText.split('\n').entries()) {
      if (hunk.oldText === '' && line === '') continue
      rows.push(createElement('div', { key: 'old-' + String(index), className: 'evo-doc-line-del' }, '- ' + line))
    }
    for (const [index, line] of hunk.newText.split('\n').entries()) {
      if (hunk.newText === '' && line === '') continue
      rows.push(createElement('div', { key: 'new-' + String(index), className: 'evo-doc-line-add' }, '+ ' + line))
    }
  }
  return createElement('pre', { className: 'evo-doc-source' }, rows.length === 0 ? '\u00b1' : rows)
}

/** One rendered side of a diff: an \u201cold\u201d or \u201cnew\u201d block under a tinted edge. */
function renderedSide(face: DocumentFace, mark: string, side: 'del' | 'add', text: string): ReactNode {
  const rendered = renderMarkdown(text, face.markdownWords)
  if (!rendered.ok) return null
  return createElement('div', { className: 'evo-doc-block evo-doc-' + side },
    createElement('span', { className: 'evo-doc-tag' }, mark),
    rendered.node)
}

/**
 * The same diff, both sides rendered as Markdown and stacked: the removed text first, then the added
 * one. Block level on purpose — line-level interleaving of two rendered documents is a different (and
 * much larger) problem, and the source view stays one click away for exact bytes.
 * @param face - the dictionary seat and the renderer's words.
 * @param diff - the windowed change the host reported.
 * @returns the stacked blocks, or null when the renderer is out.
 */
function renderedBlocks(face: DocumentFace, diff: VersionDiffRow): ReactNode[] | null {
  const blocks: ReactNode[] = []
  for (const [index, hunk] of diff.hunks.entries()) {
    if (hunk.oldText !== '') {
      const side = renderedSide(face, '\u2212', 'del', hunk.oldText)
      if (side === null) return null
      blocks.push(createElement('div', { key: 'del-' + String(index) }, side))
    }
    if (hunk.newText !== '') {
      const side = renderedSide(face, '+', 'add', hunk.newText)
      if (side === null) return null
      blocks.push(createElement('div', { key: 'add-' + String(index) }, side))
    }
  }
  return blocks.length === 0 ? null : blocks
}

/**
 * One diff in the mode the reader asked for, degrading to the source view when the renderer is out.
 * @param face - the dictionary seat and the renderer's words.
 * @param diff - the windowed change the host reported.
 * @param mode - source or rendered.
 * @returns the element to draw.
 */
function diffView(face: DocumentFace, diff: VersionDiffRow, mode: 'source' | 'rendered'): ReactNode {
  if (mode === 'rendered') {
    const blocks = renderedBlocks(face, diff)
    if (blocks !== null) return createElement('div', { className: 'evo-doc-render' }, blocks)
  }
  return sourceBlock(diff)
}

/**
 * One version read as a document: the platform renderer when it is there, plain text when it is not.
 *
 * The document is the page, not a card inside it: no border, no surface of its own and no inner
 * scroll, so the pane's own scrollbar is the only one a reader meets (W20/W21). A body the host
 * bounded says how much it is not showing, with both numbers (W23).
 * @param props - the face and the body state to draw.
 * @returns the element.
 */
export function PreviewBody(props: { face: DocumentFace; body: BodyState }): ReactNode {
  const { face, body } = props
  if (body.kind === 'loading') return note({ children: face.t('diff.loading') })
  if (body.kind === 'failed') return note({ error: true, children: body.message })
  const rendered = renderMarkdown(body.body.display, face.markdownWords)
  return createElement('div', { className: 'evo-doc-preview' },
    body.body.truncated
      ? note({ children: face.format('preview.truncated', { shown: body.body.display.length, total: body.body.chars }) })
      : null,
    rendered.ok ? rendered.node : createElement('pre', { className: 'evo-doc-source' }, body.body.display))
}

/**
 * The expanded body of one row: the diff, a loading line, or the refusal.
 *
 * The source/rendered choice is LOCAL to this view: which row is open is the panel's business, but
 * how one open diff is displayed is not, so the state does not climb into the parent.
 * @param props - the face and the diff state to draw.
 * @returns the element.
 */
export function DiffBody(props: { face: DocumentFace; diff: DiffState }): ReactNode {
  const { face, diff } = props
  const [mode, setMode] = useState<'source' | 'rendered'>('source')
  if (diff.kind === 'loading') return note({ children: face.t('diff.loading') })
  if (diff.kind === 'failed') return note({ error: true, children: diff.message })
  const against = diff.diff.against === null
    ? face.t('diff.first')
    : face.format('diff.against', { n: diff.diff.against })
  const toggle = createElement('div', { className: 'evo-doc-toggle' },
    button({ key: 'source', kind: 'switch', pressed: mode === 'source', onClick: () => { setMode('source') }, children: face.t('diff.source') }),
    button({ key: 'rendered', kind: 'switch', pressed: mode === 'rendered', onClick: () => { setMode('rendered') }, children: face.t('diff.rendered') }))
  return createElement('div', { className: 'evo-doc-diff' },
    createElement('div', { className: 'evo-doc-head' },
      note({
        children: against + ' · ' + face.format('diff.added', { n: diff.diff.linesAdded })
          + ' · ' + face.format('diff.removed', { n: diff.diff.linesRemoved })
          + (diff.diff.truncated ? ' · ' + face.t('diff.truncated') : ''),
      }),
      toggle),
    diffView(face, diff.diff, mode))
}
