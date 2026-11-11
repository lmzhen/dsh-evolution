/**
 * Browser half: the family owns ONE top-level `settings.section` (plus the nav icon addressed
 * by the same id). Its page carries every parameter card and the read-only diagnostics card;
 * the Plugins page keeps the bundle's install-scope line and nothing else.
 *
 * No `plugins.row.config` entry is registered: the parameters moved back into
 * Settings → Self-evolution, where the page reads the platform's own client settings seat
 * (`ctx.get('configForms')`) and renders the card body from the same `state` + `mutate` pair
 * the Plugins page hands a row entry (one implementation, `RowConfigCard`, one write model).
 *
 * The seat is READ, never injected: this package also ships the skill-history panel, and a
 * required inject for a service a deployment may not compose leaves the whole browser half
 * pending with no error and no UI. The section itself only renders under a settings shell that
 * provides the seat, so reading it at render time is enough.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactNode } from 'react'
import { CLIENT_PARAM_SECTIONS } from './generated-params.ts'
import { PRODUCT_BUNDLE } from './generated-surface.ts'
import { dictionaries, fill, message, NS, type MessageKey } from './messages.ts'
import type { SupportedLocale } from '@lmzhen/dsh-evolution-client-kit/generated/i18n'
import { EvolutionSettingsPage } from './SettingsPage.ts'
import { DiagnosticsCard } from './DiagnosticsCard.ts'
import { createDiagnosticsApi, type DiagnosticsApi } from './diagnostics-state.ts'
import { FAMILY_VERSION } from './generated-about.ts'
import type { ConfigFormsSeat } from './seam.ts'
import { injectStyles } from './styles.ts'

/** The client services this half consumes. */
export const inject = ['slots', 'locale'] as const

/** Section id and nav order (the platform's own sections sit at 0/10/15/20). */
export const SECTION_ID = 'evolution'
export const SECTION_ORDER = 25

/**
 * Register the locale namespace, the settings section with its nav icon, and the bundle's
 * install-scope line on the Plugins page.
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
    /** The platform's client settings seat (`ui-settings` provides it); absent in a bare shell. */
    get?(name: string): unknown
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
  // Read on every render, never captured: this row may activate BEFORE the settings shell that
  // provides the seat (the shell declares the very slot this registration waits on).
  const seat = (): ConfigFormsSeat | undefined => seam.get?.('configForms') as ConfigFormsSeat | undefined
  const cards = CLIENT_PARAM_SECTIONS.map(section => ({ namespace: section.namespace, fields: section.fields }))
  const diagnostics: DiagnosticsApi = createDiagnosticsApi()
  seam.slots.inject('settings.section', function* () {
    yield seam.slots.register({
      name: 'settings.section',
      id: SECTION_ID,
      order: SECTION_ORDER,
      label: () => t('title'),
      locale: NS,
    }, ((_props: { close?: () => void }): ReactNode => createElement(EvolutionSettingsPage, {
      cards,
      seat,
      t,
      lang: language,
      diagnostics,
    })) as unknown as (props: never) => unknown)
    // The nav glyph is addressed by the SAME id: an icon whose id names no section never renders.
    yield seam.slots.register({
      name: 'settings.section.icon',
      id: SECTION_ID,
      order: SECTION_ORDER,
      label: () => t('title'),
    }, SectionIcon as unknown as (props: never) => unknown)
  })

  const PRODUCT_BUNDLE_NAMES = new Set([PRODUCT_BUNDLE, '@deepseek-ai/dsh-evolution-all'])
  // Install scope only: which family this page belongs to (version) and where its parameters and
  // runtime checks live. The parameter cards and the diagnostics card are on the settings page, so
  // the Plugins page states the scope and points there instead of growing a second copy of both.
  seam.slots.inject('plugins.detail.section', function* () {
    yield seam.slots.register({ name: 'plugins.detail.section', id: 'evolution-install-scope' }, ((props: { subject?: { kind?: string; pkg?: { name?: string } } }): ReactNode => {
      const subject = props.subject
      if (subject?.kind !== 'bundle' || subject.pkg?.name === undefined || !PRODUCT_BUNDLE_NAMES.has(subject.pkg.name)) return null
      return createElement('div', { className: 'evolution-settings-detail', 'data-role': 'evolution-install-scope' },
        createElement('p', { className: 'evolution-params-about' }, FAMILY_VERSION + ' · ' + t('aboutPurpose')),
        createElement('p', { className: 'evolution-param-note', 'data-role': 'evolution-scope' }, t('detailScope', { rows: cards.length })))
    }) as unknown as (props: never) => unknown)
  })
}

/**
 * Nav glyph for the family settings section.
 * @param props - the square edge the shell asks for (16px when it asks for nothing).
 * @returns the icon.
 */
function SectionIcon(props: { size?: number }): ReactNode {
  const size = props.size ?? 16
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true,
  },
  createElement('path', { d: 'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8M8.4 15.6l-2.8 2.8' }),
  )
}
