/**
 * Browser half: one settings section ("自进化") hosting one card per namespace.
 *
 * Until 0.7.0 the cards lived inside the platform's own 插件 section, because
 * this bundle injected `@deepseek-ai/dsh-client-ui-settings-plugins` and claimed
 * its keyed `settings.plugin.item` slot. The parameters are not a plugin
 * inventory though — the other feature areas (market, skins, Web plugins, side
 * cards) each register their OWN section, so this bundle now does the same:
 * inject the settings shell, register `settings.section`, and host the cards in
 * a keyed child slot of that section.
 *
 * The join key is still the namespace itself: the Host half of each owning plugin
 * registers it, this half claims it in the keyed card slot, and the section pairs
 * them. A namespace the Host does not serve renders nothing, and a deployment that
 * drops this row shows no section at all: the pair carries no Host-side behaviour.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { CLIENT_PARAM_SECTIONS } from './generated-params.ts'
import { en, message, NS, zh, type MessageKey } from './messages.ts'
import { ParamCard, type ParamCardFace } from './ParamCard.ts'
import { CARD_SLOT, type ClientSeam, type ParamSectionSource } from './seam.ts'
import { SettingsSection } from './SettingsSection.ts'
import { injectStyles } from './styles.ts'

/** Required client services: the slot registry, the settings transport, the locale seat. */
export const inject = ['slots', 'settingsScope', 'locale']

/** Section id and nav order (the platform's own sections sit at 0/10/15/20). */
export const SECTION_ID = 'evolution'
export const SECTION_ORDER = 25

/**
 * Register the locale namespace, the section and its cards.
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
      const scope = seam.settingsScope.bind({ namespace: section.namespace })
      const source = scope as unknown as ParamSectionSource
      const face = (): ParamCardFace => ({
        namespace: section.namespace,
        fields: section.fields,
        t,
        write: (field, value) => scope.set(field, value),
        clear: field => scope.unset(field),
        hooks: { paramSection: source },
      })
      yield seam.slots.register({
        name: CARD_SLOT,
        key: section.namespace,
        inject: face,
      }, ParamCard)
    }
  })
}
