/**
 * Browser half: one card per settings namespace the family registers.
 *
 * The join key is the namespace itself — the Host half of each owning plugin
 * registers it, this half claims it in the keyed `settings.plugin.item` slot, and
 * the configuration tab pairs them. A namespace the Host does not serve renders
 * nothing, and a deployment that drops this row shows no cards at all: the pair
 * carries no Host-side behaviour.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { CLIENT_PARAM_SECTIONS } from './generated-params.ts'
import { ParamCard, type ParamCardFace } from './ParamCard.ts'
import { message } from './messages.ts'
import type { ClientSeam, ParamSectionSource } from './seam.ts'

/** Required client services: the slot registry and the settings transport. */
export const inject = ['slots', 'settingsScope']

/**
 * Register one card per generated namespace section.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const seam = ctx as unknown as ClientSeam
  seam.slots.inject('settings.plugin.item', function* () {
    for (const section of CLIENT_PARAM_SECTIONS) {
      const scope = seam.settingsScope.bind({ namespace: section.namespace })
      const source = scope as unknown as ParamSectionSource
      const face = (): ParamCardFace => ({
        namespace: section.namespace,
        fields: section.fields,
        t: key => message(key),
        write: (field, value) => scope.set(field, value),
        clear: field => scope.unset(field),
        hooks: { paramSection: source },
      })
      yield seam.slots.register({
        name: 'settings.plugin.item',
        key: section.namespace,
        inject: face,
      }, ParamCard)
    }
  })
}
