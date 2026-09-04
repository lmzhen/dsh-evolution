import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evolution-all'

export const name = 'dsh-evolution-all-invariant'
export const inject = ['invariants']

// No runtime invariant: this package is a dependency-only aggregate whose
// contract (pull the whole family) is enforced by its manifest dependencies
// and the package's own contract test.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
