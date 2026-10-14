// @tier ci-only
/**
 * G4 ⑤: the write receipt carries what THIS write introduced (or made worse) — never the standing
 * backlog, and never a number for a rule whose threshold is not calibrated yet.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, lintBody, nodeEvolutionIo, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const mk = async () => await mkdtemp(join(tmpdir(), 'dsh-receipt-health-'))
const body = (name: string, text: string) => ['---', 'name: ' + name, 'description: ' + name + ' body', '---', '', text, ''].join(String.fromCharCode(10))
const last = async (lib: SkillLibrary, name: string) => {
  const rows = (await lib.listMutations()).filter(row => row.skillName === name)
  return rows[rows.length - 1]?.summary ?? ''
}

it('回执只带本次新引入的问题：再加一次同样的正文就不提了（存量不出现）', async () => {
  const root = await mk()
  try {
    const lib = new SkillLibrary(root, nodeEvolutionIo(), DEFAULT_SKILL_LIMITS)
    await lib.create('r-skill', body('r-skill', 'plain body'))
    const fat = body('r-skill', 'x'.repeat(41_000))
    await lib.update('r-skill', fat)
    expect(await last(lib, 'r-skill')).toContain('body-oversize')
    await lib.update('r-skill', fat + 'y')
    const second = await last(lib, 'r-skill')
    expect(second).not.toContain('body-oversize')
    expect(second).not.toContain('references-sprawl')
  } finally { await rm(root, { recursive: true, force: true }) }
})

// ANSWERED (G4 ⑤-c): the rule returned a fixed `count: 1`, so no diff could ever see it worsen —
// found with the probe below (both bodies reported `stamp-density:1`), fixed by reporting the raw hit
// count. The probe stays: it keeps that question visible instead of re-discoverable.
it('写入引入悬空引用时回执点名目标，存量悬空不再提', async () => {
  const root = await mk()
  try {
    const lib = new SkillLibrary(root, nodeEvolutionIo(), DEFAULT_SKILL_LIMITS)
    const withRefs = (text: string) => body('d-skill', text)
    await lib.create('d-skill', withRefs('See references/gone-a.md for detail.'))
    await lib.update('d-skill', withRefs('See references/gone-a.md and references/gone-b.md for detail.'))
    const receipt = await last(lib, 'd-skill')
    expect(receipt).toContain('dangling:')
    expect(receipt).toContain('references/gone-b.md')
    expect(receipt).not.toContain('references/gone-a.md')
    await lib.update('d-skill', withRefs('See references/gone-a.md and references/gone-b.md, plus more text.'))
    expect(await last(lib, 'd-skill')).not.toContain('dangling:')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('探针：lintBody 对 6 / 9 个戳记的计数（定位上面那条 skip）', () => {
  const pad = 'Ordinary upkeep note: the body stays scannable for future agents. '.repeat(40)
  const make = (n: number) => body('p-skill', pad + Array.from({ length: n }, (_, i) => '- rc.6' + String(i + 1) + ' fixed').join(String.fromCharCode(10)))
  const six = lintBody('p-skill', make(6), 1)
  const nine = lintBody('p-skill', make(9), 1)
  console.log('PROBE six=' + JSON.stringify(six.map(f => f.rule + ':' + String(f.count))) + ' nine=' + JSON.stringify(nine.map(f => f.rule + ':' + String(f.count))))
  expect(six.length).toBeGreaterThanOrEqual(0)
})
it('同一问题恶化时报出新的计数（stamp-density 6 → 9）', async () => {
  const root = await mk()
  try {
    const lib = new SkillLibrary(root, nodeEvolutionIo(), DEFAULT_SKILL_LIMITS)
    // The stamp rule only measures bodies at or above MIN_STAMP_BODY_CHARS (2 000), so the pad has
    // to clear that line or the first body would not carry the rule at all (and the second write
    // would read as `introduced`, not `worsened`).
    const pad = 'Ordinary upkeep note: the body stays scannable for future agents. '.repeat(40)
    // The shipped ceiling is 2/KB (DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb) and this pad is
    // ~2.4 KB, so the FIRST body needs at least five stamps to carry the rule at all (measured:
    // four did not, six does). The second body then lifts the count to nine.
    const stamps6 = Array.from({ length: 6 }, (_, i) => '- rc.6' + String(i + 1) + ' fixed').join(String.fromCharCode(10))
    const one = body('t-skill', pad + stamps6)
    await lib.create('t-skill', one)
    const stamps9 = Array.from({ length: 9 }, (_, i) => '- rc.6' + String(i + 1) + ' fixed').join(String.fromCharCode(10))
    const nine = body('t-skill', pad + stamps9)
    await lib.update('t-skill', nine)
    const receipt = await last(lib, 't-skill')
    expect(receipt).toContain('stamp-density')
    expect(receipt).toContain('x9')
  } finally { await rm(root, { recursive: true, force: true }) }
})
