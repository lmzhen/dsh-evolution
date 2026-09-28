/**
 * What the panel shows when it renders one version as a document.
 *
 * Two decisions, both made here so the preview and the rendered diff cannot drift apart:
 *
 *  - FRONTMATTER IS NOT DOCUMENT TEXT. A SKILL.md opens with a YAML block; the renderer read its
 *    closing `---` as a setext underline, so the metadata line became the document's biggest heading
 *    and the real title sat below it (measured on the installed panel 2026-09-28). The block is
 *    stripped for DISPLAY only: the raw view and the body route still carry every byte, and the
 *    panel already shows the name and description on the row and in the left column.
 *  - STRIPPING FAILS OPEN. Only a block that the family's own reader accepts is removed. A document
 *    whose text merely starts with a thematic break, a block with no closing line, or a frontmatter
 *    whose body is empty is returned UNCHANGED — showing a document's first line is always better
 *    than showing nothing.
 *
 * `readingStats` exists for the other half of the reader's honesty: a preview that stops early has
 * to be able to say HOW much it is not showing.
 * @module @deepseek-ai/dsh-evolution-core/document-body
 */
import { frontmatterBlock, parseFrontmatter } from './frontmatter.ts'

/**
 * The document a reader sees: the body without its leading frontmatter block.
 * @param content - the stored bytes of one version.
 * @returns the text to render; unchanged when there is no frontmatter the reader accepts.
 */
export function displayBodyOf(content: string): string {
  const block = frontmatterBlock(content)
  if (block === null) return content
  // The reader's verdict, not a second parser: a block it refuses is left alone.
  if (parseFrontmatter(content) === null) return content
  const body = block.lines.slice(block.end + 1).join('\n')
  // One leading blank line separates the block from the body; the document starts at its text.
  return body.replace(/^\s*\n/, '')
}

/** How much of one version the reader is looking at. */
export interface ReadingStats {
  /** Characters in the stored version. */
  readonly totalChars: number
  /** Characters the panel holds (the route's own bound). */
  readonly shownChars: number
  /** Whether anything was left out. */
  readonly truncated: boolean
}

/**
 * How much of a version the panel is showing.
 * @param full - the whole stored text.
 * @param shown - the part the route handed over.
 * @returns the counts, so the panel can say what it is not showing.
 */
export function readingStats(full: string, shown: string): ReadingStats {
  return { totalChars: full.length, shownChars: shown.length, truncated: shown.length < full.length }
}
