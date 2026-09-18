import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PARAM_EXPOSURE, PARAM_NAMESPACES } from '@deepseek-ai/dsh-evolution-core'
import * as Commands from '../src/index.ts'
import { paramGroups, paramSurfaceRows, renderParamJson, renderParamRows, type ParamSectionView } from '../src/params.ts'
import { captureCommands } from '../../test-support/commands-stub.ts'

/** The command handler the stub captured, as the tests call it. */
type Handler = (invocation: { rawInput?: string }) => Promise<{ kind: 'success' | 'error'; text: string }>

/** A settings provider stub: descriptors are supplied verbatim, nothing is validated. */
function provideSettings(ctx: Context, descriptors: unknown[] | (() => unknown[])): void {
  ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
    describe: () => (typeof descriptors === 'function' ? descriptors() : descriptors),
  })
}

async function mount(rawInput: string, descriptors?: unknown[] | (() => unknown[])): Promise<{ kind: string; text: string }> {
  const ctx = new Context()
  let captured: Handler | undefined
  ctx.provide('commands', captureCommands((definition) => { captured = (definition as { run: Handler }).run }))
  if (descriptors !== undefined) provideSettings(ctx, descriptors)
  await ctx.plugin(Commands)
  return await captured!({ rawInput })
}

/** The review row's namespace, as the platform reports it for a user override. */
const REVIEW_NS = PARAM_NAMESPACES['evolution-review']!

describe('params view (G4/S4.1)', () => {
  it('classifies each row as user / deployment / unregistered', () => {
    const sections = new Map<string, ParamSectionView>([
      [REVIEW_NS, { user: { reviewSkillInterval: 30 }, value: { reviewSkillInterval: 30, reviewEnabled: true } }],
    ])
    const rows = paramSurfaceRows(sections)
    expect(rows).toHaveLength(PARAM_EXPOSURE.length)
    const overridden = rows.find(row => row.id === 'reviewSkillInterval')!
    expect(overridden.source).toBe('user')
    expect(overridden.value).toBe(30)
    const unset = rows.find(row => row.id === 'reviewEnabled')!
    expect(unset.source, 'registered but unset stays the deployment value').toBe('deployment')
    expect(unset.value).toBe(true)
    // No namespace registered for the owner at all (deployment-only face).
    const catalog = rows.find(row => row.owner === 'evolution-skill-catalog')!
    expect(catalog.source).toBe('unregistered')
    expect(catalog.value).toBeUndefined()
    // An empty map is NOT 'no overrides': nothing is known, so nothing is claimed.
    expect(paramSurfaceRows(new Map()).every(row => row.source === 'unregistered')).toBe(true)
  })

  it('renders one line per row plus the counts, JSON for scripts', () => {
    const rows = paramSurfaceRows(new Map([[REVIEW_NS, { user: { reviewSkillInterval: 30 }, value: { reviewSkillInterval: 30 } }]]))
    const text = renderParamRows(rows, { providerMounted: true })
    expect(text.split('\n')[0]).toContain('SOURCE')
    expect(text).toContain('reviewSkillInterval')
    expect(text).toMatch(new RegExp(`${PARAM_EXPOSURE.length} parameter\\(s\\): E0 0`))
    expect(text).toContain('1 overridden by the user')
    const parsed = JSON.parse(renderParamJson(rows)) as { params: Array<{ id: string; source: string }> }
    expect(parsed.params).toHaveLength(rows.length)
    expect(parsed.params.find(row => row.id === 'reviewSkillInterval')?.source).toBe('user')
    expect(paramGroups()).toContain('review')
  })

  it('answers `params --group <name>` and refuses an unknown group', async () => {
    const sections = [{ ns: REVIEW_NS, user: { reviewSkillInterval: 4 }, value: { reviewSkillInterval: 4 } }]
    const filtered = await mount('params --group review', sections)
    expect(filtered.kind).toBe('success')
    expect(filtered.text).toContain('reviewSkillInterval')
    expect(filtered.text).not.toContain('memoryChars')
    const json = await mount('params --group review --json', sections)
    const parsed = JSON.parse(json.text) as { params: Array<{ group: string }> }
    expect(parsed.params.length).toBeGreaterThan(0)
    expect(parsed.params.every(row => row.group === 'review')).toBe(true)
    const unknown = await mount('params --group nope')
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('E-308: unknown parameter group "nope"')
    expect(unknown.text).toContain('review')
  })

  it('says the user layer is unavailable instead of reporting no overrides', async () => {
    const bare = await mount('params')
    expect(bare.kind).toBe('success')
    expect(bare.text).toContain('settings provider not mounted')
    expect(bare.text).not.toContain('0 overridden by the user')
    // A provider whose describe throws is also not 'nothing is overridden'.
    const broken = await mount('params', () => { throw new Error('describe unavailable') })
    expect(broken.kind).toBe('error')
    expect(broken.text).toContain('E-307')
    expect(broken.text).toContain('describe unavailable')
  })
})
