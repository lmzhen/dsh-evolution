import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evolution-preset'

export const name = 'dsh-evolution-preset-invariant'
export const inject = ['invariants']

// No runtime invariant: this package is a composition/configuration package
// whose contracts are enforced by its composition and installer tests.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
