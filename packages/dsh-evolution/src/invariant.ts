/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-evolution`.
 * @module @deepseek-ai/dsh-evolution/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evolution'

/** Cordis companion plugin name. */
export const name = 'dsh-evolution-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
