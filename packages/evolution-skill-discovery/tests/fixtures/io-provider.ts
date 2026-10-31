import type { Context } from '@deepseek-ai/cordis'

export const name = 'test-evolution-io-provider'
export const inject = ['evolutionIo']

export function apply(ctx: Context): void {
  ctx.evolutionIo.registerProvider({
    name: 'test',
    readText: async () => null,
    writeText: async () => {},
    remove: async () => {},
    list: async () => [],
    exists: async () => false,
    rename: async () => {},
    copy: async () => {},
  })
}
