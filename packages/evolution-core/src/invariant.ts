import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evolution-core'

export const name = 'evolution-core-invariant'
export const inject = ['invariants']

// No runtime invariant: this package owns no process-level invariant; its
// contract is covered by consumer package and boundary tests.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
