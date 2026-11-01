import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { escapeText } from '@deepseek-ai/dsh-skill'
import type { CatalogEntry } from './projection.ts'

interface CatalogSource {
  readonly kind: 'skill-catalog'
  readonly form: 'catalog'
  readonly update?: true
  readonly entries: readonly CatalogEntry[]
}

/** Captured platform catalog; base text and source are kept verbatim. */
export interface CatalogCapture {
  readonly text: string
  readonly source: CatalogSource
  readonly entries: readonly CatalogEntry[]
  readonly update: boolean
}

function textOf(message: UserMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

function sourceOf(message: UserMessage): CatalogSource | undefined {
  if (message.source.kind !== 'skill-catalog') return undefined
  return message.source as CatalogSource
}

/** @returns captured catalog when text has the known available_skills block. */
export function captureCatalog(message: UserMessage): CatalogCapture | undefined {
  const source = sourceOf(message)
  if (source === undefined || source.form !== 'catalog') return undefined
  const text = textOf(message)
  if (!text.includes('<available_skills>') || !text.includes('</available_skills>')) return undefined
  return { text, source, entries: source.entries, update: source.update === true }
}

function renderEntries(entries: readonly CatalogEntry[]): string {
  return entries.map(entry => '- `' + entry.name + '`: ' + escapeText(entry.description)).join('\n')
}

/**
 * Replace only the available_skills block; preamble, footer, and update marker stay byte-identical.
 * @param capture - platform message captured before projection.
 * @param entries - projected entries.
 * @returns a platform-sourced message with the same framing.
 */
export function renderCatalog(capture: CatalogCapture, entries: readonly CatalogEntry[]): UserMessage {
  const start = capture.text.indexOf('<available_skills>')
  const end = capture.text.indexOf('</available_skills>', start)
  const text = capture.text.slice(0, start + '<available_skills>'.length)
    + '\n' + renderEntries(entries) + '\n'
    + capture.text.slice(end)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { ...capture.source, entries: capture.source.entries },
  })
}

/**
 * Build a replacement catalog when no current catalog message exists.
 * @param sourceEntries - full platform entries; keeps the platform digest stable.
 * @param entries - projected entries.
 * @returns a skill-catalog message with update=true.
 */
export function renderCatalogUpdate(sourceEntries: readonly CatalogEntry[], entries: readonly CatalogEntry[]): UserMessage {
  const updateText = [
    '<system-reminder>',
    'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:',
    '',
    '<available_skills>',
    ...entries.map(entry => '- `' + entry.name + '`: ' + escapeText(entry.description)),
    '</available_skills>',
    '',
    'Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the `skill` tool with the exact name before acting.',
    'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
    '</system-reminder>',
  ].join('\n')
  return createUserMessage({ content: [{ type: 'text', text: updateText }], source: { kind: 'skill-catalog', form: 'catalog', update: true, entries: sourceEntries } })
}

/** @returns the exact platform message captured before projection. */
export function restoreCatalog(capture: CatalogCapture): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: capture.text }],
    source: capture.source,
  })
}
