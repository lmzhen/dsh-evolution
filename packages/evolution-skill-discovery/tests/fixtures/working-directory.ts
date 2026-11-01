import type { Context } from '@deepseek-ai/cordis'

export const name = 'test-working-directory-provider'

/** Supply the platform workingDirectory service for Loader boot tests. */
export function apply(ctx: Context): void {
  const defaultDirectory = process.cwd()
  ctx.provide('workingDirectory', {
    defaultDirectory,
    get: (session: { header: { cwd?: string | undefined } }) => session.header.cwd ?? defaultDirectory,
    ensure: (agent: { session: { header: { cwd?: string | undefined } } }) => Promise.resolve(agent.session.header.cwd ?? defaultDirectory),
  })
}
