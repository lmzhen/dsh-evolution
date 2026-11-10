/**
 * Browser half: the family contributes per-row configuration to the platform
 * Plugins page. It owns no top-level settings section and no settings seat of
 * its own; the page supplies the row form and re-renders it on change.
 *
 * The join key is the row's plugin-manager key: <bundle package>#<row id>.
 * The bundle/row set comes from the generated product surface catalog, so the
 * client cannot drift from the install/command surface gate.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactNode } from 'react'
import { CLIENT_PARAM_SECTIONS } from './generated-params.ts'
import { PRODUCT_BUNDLE, ROW_CONFIG_SURFACES } from './generated-surface.ts'
import { dictionaries, fill, message, NS, type MessageKey } from './messages.ts'
import type { SupportedLocale } from '@lmzhen/dsh-evolution-client-kit/generated/i18n'
import { RowConfigCard } from './RowConfigCard.ts'
import { DiagnosticsCard } from './DiagnosticsCard.ts'
import { createDiagnosticsApi } from './diagnostics-state.ts'
import { FAMILY_VERSION } from './generated-about.ts'
import type { RowConfigViewProps } from './seam.ts'
import { injectStyles } from './styles.ts'

/** The client services this half consumes. */
export const inject = ['slots', 'locale'] as const

/** The row-config key the Plugins page uses (one helper, one spelling). */
export function rowConfigKey(bundle: string, rowId: string): string {
  return bundle + '#' + rowId
}

/**
 * Register the locale namespace and every row's configuration page.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), 'evolution-settings-ui: styles')
  const seam = ctx as unknown as {
    slots: {
      inject(name: string, callback: () => Generator<unknown, void, unknown>): unknown
      register(options: Record<string, unknown>, component: (props: never) => unknown): () => void
    }
    locale: {
      register(namespace: string, dictionaries: unknown): () => void
      bind(namespace: string): (key: string, values?: Readonly<Record<string, string | number>>) => string
      getLocale?(): { active?: string }
    }
  }
  let registered = false
  ctx.effect(() => {
    try {
      const dispose = seam.locale.register(NS, dictionaries)
      registered = true
      return dispose
    } catch (error) {
      ctx.logger.warn(`evolution-settings-ui: the locale seat refused the "${NS}" dictionary registration (${error instanceof Error ? error.message : String(error)}) — the cards fall back to the bundle's own copy`)
      return () => {}
    }
  }, NS + ': dictionaries')
  let bound: ((key: string, values?: Readonly<Record<string, string | number>>) => string) | null = null
  const language = (): SupportedLocale => {
    const active = seam.locale.getLocale?.().active
    return (['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const).includes(active as SupportedLocale)
      ? active as SupportedLocale
      : 'en'
  }
  const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => {
    if (!registered) return message(key, language())
    if (bound === null) {
      try {
        bound = seam.locale.bind(NS)
      } catch {
        return message(key, language())
      }
    }
    return values === undefined ? bound(key) : fill(bound(key), values)
  }
  const surfaces = ROW_CONFIG_SURFACES.map((surface) => {
    const section = CLIENT_PARAM_SECTIONS.find((candidate) => candidate.namespace === surface.namespaces[0])
    if (section === undefined) throw new Error('evolution-ui: generated surface names no generated field section: ' + surface.namespaces[0])
    return { surface, fields: section.fields }
  })
  seam.slots.inject('plugins.detail.section', function* () {
    yield seam.slots.register({ name: 'plugins.detail.section' }, ((props: { subject?: { kind?: string; pkg?: { name?: string } } }): ReactNode => {
      const subject = props.subject
      if (subject?.kind !== 'package' || subject.pkg?.name !== PRODUCT_BUNDLE) return null
      return createElement('div', { className: 'evolution-settings-detail', 'data-role': 'evolution-diagnostics' },
        createElement('p', { className: 'evolution-params-about' }, FAMILY_VERSION + ' · ' + t('aboutPurpose')),
        createElement(DiagnosticsCard, { t, api: createDiagnosticsApi() }))
    }) as unknown as (props: never) => unknown)
  })

  seam.slots.inject('plugins.row.config', function* () {
    for (const { surface, fields } of surfaces) {
      for (const bundle of surface.bundles) {
        const key = rowConfigKey(bundle, surface.rowId)
        yield seam.slots.register({
          name: 'plugins.row.config',
          key,
          order: surface.order,
          locale: NS,
          label: () => t('title'),
        }, ((props: RowConfigViewProps): ReactNode =>
          createElement(RowConfigCard, {
            ...props,
            namespace: surface.namespaces[0] ?? surface.rowId,
            fields,
            t,
            lang: language,
          })) as unknown as (props: never) => unknown)
      }
    }
  })
}

/** Kept for the generated packet's own smoke test: the one product bundle. */
export const productBundle = PRODUCT_BUNDLE
