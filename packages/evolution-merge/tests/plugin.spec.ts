// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { apply } from '../src/index.ts'

it('mounts routes, command and merge_stage with a minimal host context', async () => {
  const home = await tempRoot('dsh-merge-plugin-')
  const io = nodeEvolutionIo()
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const routes: Array<{ path: string; fetch: (request: Request) => Promise<Response> }> = []
  const commands: unknown[] = []
  const tools: unknown[] = []
  const scope = {
    get(name: string) {
      if (name === 'evolutionIo') return { provider: () => io }
      if (name === 'commands') return { register: (definition: unknown) => { commands.push(definition); return () => {} } }
      if (name === 'tools') return { register: (definition: unknown) => { tools.push(definition); return () => {} } }
      return undefined
    },
    effect(run: () => () => void) { run() },
    logger: { warn: () => {} },
    emit: () => {},
    on: () => () => {},
  }
  const ctx = {
    inject(names: string[], run: (value: typeof scope & { connection?: unknown }) => void) {
      if (names.includes('connection')) {
        const connection = {
          fetch: {
            register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
              routes.push(route)
              return async () => {}
            },
          },
        }
        run({ ...scope, connection })
        return
      }
      if (names.includes('settings')) return
      run(scope)
    },
    effect(run: () => () => void) { run() },
    logger: { warn: () => {} },
    emit: () => {},
    on: () => () => {},
    fiber: {},
    get: (name: string) => scope.get(name),
  }
  try {
    apply(ctx as never, {})
    expect(routes.map(route => route.path).sort()).toEqual([
      '/api/dsh-evolution/merge/body', '/api/dsh-evolution/merge/history', '/api/dsh-evolution/merge/rows', '/api/dsh-evolution/merge/view',
    ])
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ name: 'merge' })
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: 'merge_stage' })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
