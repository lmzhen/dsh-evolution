import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Commands from '../src/index.ts'
import { captureCommands } from '../../test-support/commands-stub.ts'

type Handler = (invocation: { rawInput?: string }) => Promise<{ kind: 'success' | 'error'; text: string }>

/** One recorded write, as the fake service saw it. */
interface Write { namespace: string; patch: object; expected: number | undefined }

interface FakeOptions {
  revision?: number
  user?: Record<string, unknown>
  /** Reject the write the way the platform's SETTINGS_CONFLICT does. */
  conflict?: boolean
  /** Reject the write the way an owner's validate hook does. */
  refusal?: string
}

/** Mount the command with a settings service stub; returns the recorded writes. */
async function mount(rawInput: string, options: FakeOptions = {}): Promise<{ kind: string; text: string; writes: Write[] }> {
  const ctx = new Context()
  const writes: Write[] = []
  let captured: Handler | undefined
  ctx.provide('commands', captureCommands((definition) => { captured = (definition as { run: Handler }).run }))
  ctx.provide('settings', {
    describe: () => [
      { ns: 'evolution-review', revision: options.revision ?? 4, user: options.user ?? {}, value: { reviewSkillInterval: 10, reviewEnabled: true, reviewMode: 'inject' } },
      { ns: 'evolution-skills', revision: 7, user: {}, value: { descriptionStrict: false, skillContentChars: 100_000 } },
    ],
    update: async (namespace: string, patch: object, expected?: number) => {
      if (options.conflict === true) {
        throw Object.assign(new Error('settings namespace "' + namespace + '" changed since it was read (expected revision 4, now 5)'), { code: 'SETTINGS_CONFLICT' })
      }
      if (options.refusal !== undefined) throw new Error(options.refusal)
      writes.push({ namespace, patch, expected })
    },
  })
  await ctx.plugin(Commands)
  const result = await captured!({ rawInput })
  return { kind: result.kind, text: result.text, writes }
}

describe('policy set (G4/S4.2)', () => {
  it('writes an E3 value through the settings service and echoes the move', async () => {
    const result = await mount('policy set reviewSkillInterval 30')
    expect(result.kind).toBe('success')
    expect(result.writes).toEqual([{ namespace: 'evolution-review', patch: { reviewSkillInterval: 30 }, expected: 4 }])
    expect(result.text).toContain('reviewSkillInterval: 10 → 30')
    expect(result.text).toContain('namespace evolution-review; applies live')
    expect(result.text).toContain('takes effect at the next use')
    expect(result.text).toContain('now a user override')
  })

  it('parses numbers, booleans and bare words for the schema to judge', async () => {
    const boolean = await mount('policy set descriptionStrict true')
    expect(boolean.writes[0]?.patch).toEqual({ descriptionStrict: true })
    const word = await mount('policy set reviewMode inject')
    expect(word.writes[0]?.patch).toEqual({ reviewMode: 'inject' })
    // An E3 enum word: the schema, not this parser, decides whether it is legal.
    const enumWord = await mount('policy set skillReviewTrigger both')
    expect(enumWord.writes[0]?.patch).toEqual({ skillReviewTrigger: 'both' })
  })

  it('refuses a deployment tier and names cordis.yml', async () => {
    const result = await mount('policy set reviewProvider deepseek-official')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('E-314')
    expect(result.text).toContain('deployment parameter (tier E2')
    expect(result.text).toContain('cordis.yml')
    expect(result.writes).toEqual([])
    // The E-315 branch is defensive: it fires only if an E3 owner ever loses its
    // namespace, which no registered E3 owner does today.
    const alsoDeployment = await mount('policy set includeSkillNames stuff')
    expect(alsoDeployment.text).toContain('E-314')
  })

  it('refuses a deprecated alias and an unknown id', async () => {
    const alias = await mount('policy set skillInterval 5')
    expect(alias.kind).toBe('error')
    expect(alias.text).toContain('E-312')
    expect(alias.text).toContain('reviewSkillInterval')
    expect(alias.writes).toEqual([])
    const unknown = await mount('policy set nopeRate 5')
    expect(unknown.text).toContain('E-313')
    expect(unknown.writes).toEqual([])
  })

  it('reports a revision conflict instead of overwriting a moved document', async () => {
    const pin = await mount('policy set reviewSkillInterval 30 --expect 2')
    expect(pin.kind).toBe('error')
    expect(pin.text).toContain('E-309: revision conflict — you sent 2')
    expect(pin.writes).toEqual([])
    const raced = await mount('policy set reviewSkillInterval 30', { conflict: true })
    expect(raced.kind).toBe('error')
    expect(raced.text).toContain('E-309: revision conflict')
    expect(raced.text).toContain('now 5')
  })

  it('surfaces an owner rule that refused the value', async () => {
    const result = await mount('policy set skillContentChars 200000', { refusal: 'skillContentChars may only be tightened: 200000 exceeds the deployment value 100000' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('E-310')
    expect(result.text).toContain('may only be tightened')
  })

  it('refuses to write anything without the settings service', async () => {
    const ctx = new Context()
    let captured: Handler | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = (definition as { run: Handler }).run }))
    await ctx.plugin(Commands)
    const result = await captured!({ rawInput: 'policy set reviewSkillInterval 30' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('E-311')
    expect(result.text).toContain('never edits cordis.yml')
  })
})
