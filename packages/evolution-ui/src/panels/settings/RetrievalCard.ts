/**
 * Optional retrieval credentials card: two official API keys, no model or
 * endpoint fields. The card only describes and writes the platform credential
 * refs; the merge host resolves them per scan.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client/RetrievalCard
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { MessageKey } from './messages.ts'
import { RETRIEVAL_CREDENTIAL_REFS, RETRIEVAL_FIXED_MODELS, RETRIEVAL_HELP_LINKS } from './retrieval-contract.generated.ts'

/** The credential facts the Host exposes for one reference; never the value. */
export interface RetrievalCredentialInfo {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
  readonly masked?: string
}

/** One remote answer, reduced to what this card renders. */
export type RetrievalAnswer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

/** The Remote calls this card performs. */
export interface RetrievalOperations {
  describe(refs: readonly string[]): Promise<RetrievalAnswer<Readonly<Record<string, RetrievalCredentialInfo>>>>
  set(ref: string, value: string): Promise<RetrievalAnswer<undefined>>
  unset(ref: string): Promise<RetrievalAnswer<undefined>>
}

/** The card's copy seat and Remote face. */
export interface RetrievalCardFace {
  readonly t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  readonly operations: RetrievalOperations
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly info: Readonly<Record<string, RetrievalCredentialInfo>> }
  | { readonly kind: 'failed'; readonly message: string }

function canonicalInfo(value: Readonly<Record<string, RetrievalCredentialInfo>>, ref: string): RetrievalCredentialInfo {
  return value[ref] ?? { configured: false, writable: false }
}

/**
 * Render the optional retrieval credential card.
 * @param props - the copy seat and the platform credential calls.
 * @returns the card; no secret is ever read back into the draft.
 */
export function RetrievalCard(props: RetrievalCardFace): ReactNode {
  const { t, operations } = props
  const refs = RETRIEVAL_CREDENTIAL_REFS
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState('')

  const load = async (): Promise<void> => {
    const answer = await operations.describe([refs.embedding, refs.ranker])
    if (!answer.ok) { setPhase({ kind: 'failed', message: answer.message }); return }
    setPhase({ kind: 'ready', info: answer.value })
  }

  useEffect(() => { void load() }, [])

  if (phase.kind === 'loading') {
    return createElement('section', { className: 'evolution-param-card', 'data-role': 'retrieval-card' },
      createElement('div', { className: 'evolution-param-body' },
        createElement('p', { className: 'evolution-param-hint' }, t('retrievalTitle')),
      ))
  }
  if (phase.kind === 'failed') {
    return createElement('section', { className: 'evolution-param-card', 'data-role': 'retrieval-card' },
      createElement('div', { className: 'evolution-param-body' },
        createElement('h3', { className: 'evolution-param-card-title' }, t('retrievalTitle')),
        createElement('p', { className: 'evolution-param-hint', role: 'status' }, t('retrievalUnavailable')),
        createElement('p', { className: 'evolution-param-hint' }, phase.message),
      ))
  }

  const info = phase.info
  const embedding = canonicalInfo(info, refs.embedding)
  const ranker = canonicalInfo(info, refs.ranker)
  const both = embedding.configured && ranker.configured
  const current = both
    ? t('retrievalCurrentEnhanced')
    : embedding.configured
      ? t('retrievalCurrentMixed')
      : ranker.configured
        ? t('retrievalCurrentRanker')
        : t('retrievalCurrentLocal')
  const unavailable = !embedding.writable && !ranker.writable

  const save = async (): Promise<void> => {
    setBusy(true); setNotice(''); setFailure('')
    try {
      for (const [ref, value] of Object.entries(draft)) {
        if (value === '') continue
        const answer = await operations.set(ref, value)
        if (!answer.ok) { setFailure(t('retrievalSaveFailed', { message: answer.message })); return }
      }
      setDraft({})
      await load()
      setNotice(t('retrievalSaved'))
    } catch (error) {
      setFailure(t('retrievalSaveFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const clear = async (ref: string): Promise<void> => {
    setBusy(true); setNotice(''); setFailure('')
    try {
      const answer = await operations.unset(ref)
      if (!answer.ok) { setFailure(t('retrievalSaveFailed', { message: answer.message })); return }
      await load()
      setNotice(t('retrievalSaved'))
    } catch (error) {
      setFailure(t('retrievalSaveFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const sourceLabel = (item: RetrievalCredentialInfo): string => item.source === 'environment' ? t('retrievalSourceEnv') : item.source === undefined ? '' : t('retrievalSourceStore')
  const stateLabel = (item: RetrievalCredentialInfo): string => item.configured ? (sourceLabel(item) || t('retrievalConfigured')) : t('retrievalNotConfigured')
  const field = (ref: string, label: MessageKey, hint: string, item: RetrievalCredentialInfo, id: string): ReactNode => createElement('div', { key: ref, className: 'evolution-retrieval-field' },
    createElement('label', { className: 'evolution-retrieval-label', htmlFor: id }, t(label)),
    createElement('p', { className: 'evolution-param-hint' }, stateLabel(item)),
    createElement('input', {
      id,
      className: 'evolution-param-input',
      type: 'password',
      autoComplete: 'new-password',
      value: draft[ref] ?? '',
      disabled: busy || unavailable || !item.writable,
      onChange: (event: { target: { value: string } }) => setDraft(previous => ({ ...previous, [ref]: event.target.value })),
    }),
    createElement('p', { className: 'evolution-param-hint' }, hint),
    item.configured
      ? createElement('button', {
        type: 'button',
        className: 'evolution-param-button',
        'data-tone': 'ghost',
        disabled: busy || !item.writable,
        onClick: () => { void clear(ref) },
      }, t('retrievalClear'))
      : null,
  )

  return createElement('section', { className: 'evolution-param-card', 'data-role': 'retrieval-card' },
    createElement('div', { className: 'evolution-param-body' },
      createElement('h3', { className: 'evolution-param-card-title' }, t('retrievalTitle')),
      createElement('p', { className: 'evolution-param-hint' }, t('retrievalIntro')),
      createElement('p', { className: 'evolution-param-hint', role: 'status', 'data-role': 'retrieval-current' }, current),
      createElement('div', { className: 'evolution-retrieval-fields' },
        field(refs.embedding, 'retrievalEmbeddingLabel',
          t('retrievalEmbeddingHint', { model: RETRIEVAL_FIXED_MODELS.embeddingLabel, fallback: RETRIEVAL_FIXED_MODELS.embeddingFallbackLabel }),
          embedding, 'retrieval-embedding-key'),
        createElement('a', {
          className: 'evolution-param-link',
          href: RETRIEVAL_HELP_LINKS.siliconflow,
          target: '_blank', rel: 'noreferrer',
        }, t('retrievalGetKey')),
        field(refs.ranker, 'retrievalRankerLabel',
          t('retrievalRankerHint', { model: RETRIEVAL_FIXED_MODELS.rankerLabel }),
          ranker, 'retrieval-ranker-key'),
        createElement('p', { className: 'evolution-param-hint' }, t('retrievalRankerHelp')),
        createElement('div', { className: 'evolution-retrieval-links' },
          createElement('a', {
            className: 'evolution-param-link',
            href: RETRIEVAL_HELP_LINKS.bambooKeys,
            target: '_blank', rel: 'noreferrer',
          }, t('retrievalGetKey')),
        ),
      ),
      createElement('p', { className: 'evolution-param-hint' }, t('retrievalSecretNote')),
      createElement('p', { className: 'evolution-param-hint' }, t('retrievalApplyHint')),
      unavailable ? createElement('p', { className: 'evolution-param-hint', role: 'status' }, t('retrievalUnavailable')) : null,
      createElement('div', { className: 'evolution-retrieval-actions' },
        createElement('button', {
          type: 'button',
          className: 'evolution-param-button',
          'data-primary': 'true',
          disabled: busy || unavailable || Object.values(draft).every(value => value === ''),
          onClick: () => { void save() },
        }, busy ? t('retrievalSaving') : t('retrievalSave')),
      ),
      notice !== '' ? createElement('p', { className: 'evolution-param-hint', role: 'status' }, notice) : null,
      failure !== '' ? createElement('p', { className: 'evolution-param-hint', role: 'alert' }, failure) : null,
    ))
}
