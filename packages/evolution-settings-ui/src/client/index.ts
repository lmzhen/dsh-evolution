/**
 * Browser half: one settings section ("自进化") hosting one card per family row, plus the
 * Plugins page's per-row configuration entry for each of those rows.
 *
 * Until 0.7.0 the cards lived inside the platform's own 插件 section, because
 * this bundle injected `@deepseek-ai/dsh-client-ui-settings-plugins` and claimed
 * its keyed `settings.plugin.item` slot. The parameters are not a plugin
 * inventory though — the other feature areas (market, skins, Web plugins, side
 * cards) each register their OWN section, so this bundle does the same: inject
 * the settings shell, register `settings.section`, and host the cards in a keyed
 * child slot of that section.
 *
 * Since G2 that section is one of TWO render sites for the same card body. The other is
 * the platform's Plugins page: each family row can be opened there, and the page renders
 * whatever a plugin registered under key `<bundle package name>#<row id>`
 * (`plugins.row.config`). The page owns that entry's subscription and hands the row's form
 * in, so that path needs no seat of ours; our own section binds the same card to the
 * client settings seat (`configForms`).
 *
 * The join key is the row's ENTRY ID — the platform derives a settings namespace from the
 * Loader entry id, and that id is the registry's owner name — so the card, the seat lookup
 * and the page key all spell one id. The legacy namespace strings in the registry
 * (`evolution-memory`, …) are the G3 migration source, never a live lookup key.
 *
 * A row the Host does not serve renders nothing, and a deployment that drops this row
 * shows no section at all: the pair carries no Host-side behaviour.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createApprovalApi } from './api.ts'
import { CLIENT_PARAM_SECTIONS, CLIENT_ROW_SEATS } from './generated-params.ts'
import { PendingCard, type PendingCardFace } from './PendingCard.ts'
import { en, message, NS, zh, type MessageKey } from './messages.ts'
import { ParamCard, type ParamCardFace } from './ParamCard.ts'
import { RowConfigCard, type RowConfigFace } from './RowConfigCard.ts'
import { CARD_SLOT, PENDING_CARD_KEY, ROW_CONFIG_SLOT, rowConfigKey, type ClientSeam, type ConfigFormsSeat, type ParamSectionSource } from './seam.ts'
import { SettingsSection } from './SettingsSection.ts'
import { sourceFor, writeFaceFor } from './source.ts'
import { injectStyles } from './styles.ts'

/**
 * Required client services: the slot registry and the locale seat.
 *
 * The settings seat (`configForms`) is deliberately NOT here. A required inject for a
 * service the deployment did not compose leaves this whole browser half PENDING forever —
 * no error, no section, no UI — and the family is also installed without a settings
 * surface. It is probed instead, and the cards say what is missing.
 */
export const inject = ['slots', 'locale']

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
  // The stylesheet goes in first: the section renders as soon as the shell mounts
  // it, and an unstyled pass would flash before a later injection.
  injectStyles()
  const seam = ctx as unknown as ClientSeam
  // The dictionary registration is an EFFECT, not a bare call: cordis disposes it
  // when this bundle unloads (a hot reload or the row being switched off), which is
  // the same shape the platform's own client plugins use. A seat that refuses the
  // registration (an older shell) leaves the bundle on its own copy instead.
  let registered = false
  ctx.effect(() => {
    try {
      const dispose = seam.locale.register(NS, { zh, en })
      registered = true
      return dispose
    } catch {
      // A seat that refuses the registration (an older shell, or a namespace clash)
      // leaves the flag false and the bundle stays on its own copy below.
      return () => {}
    }
  }, NS + ': dictionaries')
  // Bind once per apply: `bind` allocates a translator and the card calls `t` on every
  // render. `bind` itself does not throw (a missing key falls back to the key name), so
  // the meaningful guard is whether the REGISTRATION above succeeded.
  let bound: ((key: string) => string) | null = null
  const t = (key: MessageKey): string => {
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
  // G2: the client settings seat, probed (see `inject`). Without it every card renders
  // the stated empty state and the Plugins page says the same — never a blank card and
  // never a thrown render.
  const configForms = ctx.get('configForms') as ConfigFormsSeat | undefined

  seam.slots.inject('settings.section', function* () {
    yield seam.slots.register({
      name: 'settings.section',
      id: SECTION_ID,
      order: SECTION_ORDER,
      label: () => t('title'),
      locale: NS,
      children: { [CARD_SLOT]: { kind: 'keyed', scope: 'root' } },
    }, SettingsSection)
  })

  seam.slots.inject(CARD_SLOT, function* () {
    for (const section of CLIENT_PARAM_SECTIONS) {
      const source: ParamSectionSource = sourceFor(configForms, section.namespace)
      const { write, clear } = writeFaceFor(configForms, section.namespace)
      const face = (): ParamCardFace => ({
        namespace: section.namespace,
        fields: section.fields,
        t,
        write,
        clear,
        hooks: { paramSection: source },
      })
      yield seam.slots.register({
        name: CARD_SLOT,
        key: section.namespace,
        inject: face,
      }, ParamCard)
    }
    // The staged-write window rides in the same slot with its own key: one card, no namespace.
    const api = createApprovalApi((input, init) => fetch(input, init))
    yield seam.slots.register({
      name: CARD_SLOT,
      key: PENDING_CARD_KEY,
      inject: (): PendingCardFace => ({ t, api }),
    }, PendingCard)
  })

  // G2: the platform's per-row configuration page. Its ledger keys an entry by
  // `<bundle package name>#<row id>`, and the pairs come from the generated table (the
  // bundle roster x the registry's rows) — no hand list here. A key whose bundle is not
  // installed is inert: the page only looks up keys of the rows it lists.
  seam.slots.inject(ROW_CONFIG_SLOT, function* () {
    for (const seat of CLIENT_ROW_SEATS) {
      for (const rowId of seat.rows) {
        const section = CLIENT_PARAM_SECTIONS.find(candidate => candidate.namespace === rowId)
        if (section === undefined) continue
        const face = (): RowConfigFace => ({ namespace: rowId, fields: section.fields, t })
        yield seam.slots.register({
          name: ROW_CONFIG_SLOT,
          key: rowConfigKey(seat.bundle, rowId),
          inject: face,
        }, RowConfigCard)
      }
    }
  })
}
