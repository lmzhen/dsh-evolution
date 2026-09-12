import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-files'

export const name = 'memory-files-invariant'
export const inject = ['invariants']

// No runtime invariant: this package owns no process-level invariant; its
// contract is covered by unit, composition, and boundary tests.
// Placeholder per family convention (audit v10 S-09).
// v28 G6.1 (UP-02) family contract: upstream invariants run in PRODUCTION by
// default (`enabled` defaults true; fail() throws InvariantError — nothing is
// stripped at build time). This installer must stay a deliberate no-op; any
// future REAL check must ship its own config switch, default OFF.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
