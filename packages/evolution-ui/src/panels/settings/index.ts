/**
 * Browser half: parameter cards register on the platform's Plugins surface
 * (`settings.plugin.item`); the family-owned `settings.section` is now only the
 * diagnostics card. Pending decisions live in `evolution.workbench`.
 *
 * The join key is the row's ENTRY ID — the platform derives a settings namespace from
 * the Loader entry id, and that id is the registry's owner name — so the card, the
 * seat lookup and the page key all spell one id. The legacy namespace strings in the
 * registry (`evolution-memory`, …) are the G3 migration source, never a live lookup key.
 *
 * A row the Host does not serve renders nothing.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactNode } from 'react'
import { CLIENT_PARAM_SECTIONS } from './generated-params.ts'
import { fill, en, ja, message, NS, zh, type MessageKey } from './messages.ts'
import { PluginParamCard, type ParamCardFace, type ParamLanguage } from './ParamCard.ts'
import { groupParamCards } from './settings-groups.ts'
import { PENDING_CARD_KEY, type ClientSeam, type ParamSectionSource } from './seam.ts'
import { createSettingsSeat, ensureLocaleLanguage } from '@lmzhen/dsh-evolution-client-kit'
import { createSourceCache, writeFaceFor, type SeatProbe } from './source.ts'
import { injectStyles } from './styles.ts'

/**
 * Required client services: the slot registry and the locale seat.
 *
 * The settings seat (`configForms`) is deliberately NOT here. A required inject for a
 * service the deployment did not compose leaves this whole browser half PENDING forever —
 * no error, no section, no UI — and the family is also installed without a settings
 * surface. It is probed instead, and the cards say what is missing.
 */
export const inject = ['slots', 'locale', 'remote']

/** Section id and nav order (the platform's own sections sit at 0/10/15/20). */
export const SECTION_ID = 'evolution'
export const SECTION_ORDER = 25

/** The pending-window card's key, re-exported from `seam.ts` (the section names it as well). */
export { PENDING_CARD_KEY }

/**
 * Register the locale namespace, the section, its cards, and the per-row configuration entries.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  // The 0.2.1 line's catalog ships zh/en only; offer ja before registering its dictionaries.
  ensureLocaleLanguage(ctx, { id: 'ja', label: '日本語', fallback: 'en' })
  // The stylesheet goes in first, inside an EFFECT: cordis runs the body at apply time, so the
  // injection still precedes the first render (no unstyled flash), and the disposer it returns now
  // travels back to the fiber - the same ownership skill-history gives its own stylesheet (S5-08).
  ctx.effect(() => injectStyles(), 'evolution-settings-ui: styles')
  const seam = ctx as unknown as ClientSeam
  // The dictionary registration is an EFFECT, not a bare call: cordis disposes it
  // when this bundle unloads (a hot reload or the row being switched off), which is
  // the same shape the platform's own client plugins use. A seat that refuses the
  // registration (an older shell) leaves the bundle on its own copy instead.
  let registered = false
  ctx.effect(() => {
    try {
      const dispose = seam.locale.register(NS, { zh, en, ja })
      registered = true
      return dispose
    } catch (error) {
      // A seat that refuses the registration (an older shell, or a namespace clash — the platform
      // throws on a second registration of one namespace+locale) leaves the flag false and the bundle
      // stays on its own copy below. T5-06/A61: REPORTED, not hidden — the other client half
      // (evolution-skill-history) guards the same seat, and a silent fallback would leave the reader
      // wondering why the cards speak the bundle's language instead of the UI's.
      ctx.logger.warn(`evolution-settings-ui: the locale seat refused the "${NS}" dictionary registration (${error instanceof Error ? error.message : String(error)}) — the cards fall back to the bundle's own copy`)
      return () => {}
    }
  }, NS + ': dictionaries')
  // Bind once per apply: `bind` allocates a translator and the card calls `t` on every
  // render. `bind` itself does not throw (a missing key falls back to the key name), so
  // the meaningful guard is whether the REGISTRATION above succeeded.
  let bound: ((key: string) => string) | null = null
  const translate = (key: MessageKey): string => {
    if (!registered) return message(key)
    if (bound === null) {
      try {
        bound = seam.locale.bind(NS)
      } catch {
        return message(key)
      }
    }
    return bound(key)
  }
  // G5 C4: the seat's translator takes the values, so filling happens in ONE place — the call
  // sites used to write `t('changed').replace('{n}', …)` seven times.
  const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string =>
    values === undefined ? translate(key) : fill(translate(key), values)
  const language = (): ParamLanguage => {
    try {
      const active = (ctx as unknown as { locale?: { getLocale?: () => { active?: string } } }).locale?.getLocale?.().active
      if (typeof active === 'string' && active.toLowerCase().startsWith('ja')) return 'ja'
      return active === 'en' ? 'en' : 'zh'
    } catch { return 'zh' }
  }
  // G2: the client settings seat, probed LAZILY (see `inject`). Without a seat every card
  // renders the stated empty state and the Plugins page says the same — never a blank card
  // and never a thrown render. The probe must not be captured here: this row may activate
  // BEFORE the settings shell that declares `settings.section` and provides `configForms`,
  // and a captured `undefined` would pin every card to the empty state for the life of the
  // fiber. `sourceFor` reads the probe on each render, when the shell is necessarily active.
  // platform-declaration anchor: the platform’s `configForms` seat (optional; undefined ⇒ the panel renders read-only)
  const seat = createSettingsSeat(ctx)
  const probe: SeatProbe = () => seat
  const sources = createSourceCache(probe)
  ctx.effect(() => () => { sources.dispose() }, 'evolution-settings: sources')
  // T5-11/A66: the platform's own "this service arrived" channel. The lazy probe alone left a card
  // that had already rendered its "no settings surface" state stuck there when the shell mounted
  // LATER (nothing tells React to read again), and the row's subscription was never attached. The
  // callback re-runs whenever the service CHANGES, so a re-composed shell is picked up too. Cordis
  // exposes this as `inject`; the seat is an optional one (a deployment may compose the family with
  // no settings surface), so it goes through a narrow structural view rather than a declared edge.
  const seatInjection = ctx as unknown as { inject?: (names: readonly string[], callback: () => void) => unknown }
  seatInjection.inject?.(['remote'], () => { sources.revive() })

  const cards: ParamCardFace[] = CLIENT_PARAM_SECTIONS.map((section) => {
    const source: ParamSectionSource = sources.sourceFor(section.seatKey)
    const { mutateOnce, saveOnce, clear } = writeFaceFor(probe, section.namespace)
    return {
      namespace: section.namespace,
      fields: section.fields,
      t,
      lang: language,
      mutateOnce,
      saveOnce,
      clear,
      hooks: { paramSection: source },
    }
  })
  seam.slots.inject('settings.plugins.tab', function* () {
    yield seam.slots.register({
      name: 'settings.plugins.tab',
      id: SECTION_ID,
      order: SECTION_ORDER,
      label: () => t('title'),
      locale: NS,
      inject: () => ({ cards }),
    }, EvolutionSettingsTab as unknown as (props: never) => unknown)
  })
}

/** One family tab: every parameter card lives inside the platform's Plugins page. */
function EvolutionSettingsTab(props: { readonly cards: readonly ParamCardFace[] }): ReactNode {
  return createElement('div', { className: 'evolution-settings-tab' },
    ...groupParamCards(props.cards).flatMap(({ group, items }) => [
      createElement('h3', { key: 'group-' + group, className: 'evolution-settings-group', 'data-role': 'settings-group' }, message(('group.' + group) as MessageKey)),
      ...items.map((face, index) => createElement(PluginParamCard, { key: face.namespace + ':' + String(index), ...face })),
    ]),
  )
}
