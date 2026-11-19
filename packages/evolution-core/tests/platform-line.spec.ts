// @tier fast
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PLATFORM_LINE } from '../src/platform-line.generated.ts'
// @ts-expect-error -- plain ESM helper without a declaration file
import { parsePlatformLine as parseLine, windowRows as rowsOf, OUTPUT_KEYS as OUTPUT_KEYS_RAW } from '../../scripts/lib-platform-line.mjs'

/** The script modules are plain .mjs (no declarations); pin the two shapes this spec exercises. */
type GridRow = { version: string; peersAdmits: boolean; enginesAdmits: boolean; expected: boolean; note: string }
const windowRows = rowsOf as (line: typeof PLATFORM_LINE) => GridRow[]
const parsePlatformLine = parseLine as (raw: string, source: string) => unknown
const OUTPUT_KEYS = OUTPUT_KEYS_RAW as Record<string, string>

const raw = readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
void raw

describe('platform line single source (G1-S1/S2/S3)', () => {
  it('freezes the derived anchors and ranges', () => {
    expect(PLATFORM_LINE).toMatchObject({
      version: '0.2.2-rc.5',
      floor: '0.2.2-rc.1',
      cohort: ['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5'],
      contract: 1,
      previousAnchor: '0.2.1-rc.2',
      peersRange: '0.2.2-rc.1 || 0.2.2-rc.2 || 0.2.2-rc.3 || 0.2.2-rc.4 || 0.2.2-rc.5',
      enginesRange: '0.2.2-rc.1 || 0.2.2-rc.2 || 0.2.2-rc.3 || 0.2.2-rc.4 || 0.2.2-rc.5',
      upstreamRef: 'dsh-v0.2.2-rc.5',
    })
  })

  it('uses semver for both predicates, not a hard-coded cohort membership', () => {
    const wrong = windowRows({ ...PLATFORM_LINE, peersRange: '^0.2.2-rc.3', enginesRange: '>=0.0.0' } as typeof PLATFORM_LINE)
    expect(wrong.find((row: { version: string }) => row.version === '0.2.2-rc.4')).toMatchObject({ peersAdmits: true, enginesAdmits: true, expected: true })
    expect(wrong.find((row: { version: string }) => row.version === '0.2.2')).toMatchObject({ peersAdmits: true, enginesAdmits: true, expected: true })
    expect(wrong.filter((row: { expected: boolean }) => row.expected).map((row: { version: string }) => row.version)).not.toEqual(['0.2.2-rc.3', '0.2.2-rc.5'])
  })

  it('exposes the five GITHUB_OUTPUT keys', () => {
    expect(Object.values(OUTPUT_KEYS)).toEqual(['version', 'floor', 'upstream_ref', 'peers_range', 'engines_range'])
  })

  it('freezes the window grid (both predicates, policy expected column)', () => {
    const grid = windowRows(PLATFORM_LINE)
    expect(grid.map((row: { version: string }) => row.version)).toEqual([
      '0.2.0-rc.2', '0.2.1-rc.0', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1', '0.2.2-0', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5', '0.2.2', '0.3.0-rc.1',
    ])
    const admits = grid.filter((row: { expected: boolean }) => row.expected).map((row: { version: string }) => row.version)
    expect(admits).toEqual(['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5'])
    const stable = grid.find((row: { version: string }) => row.version === '0.2.2')
    expect(stable).toMatchObject({ peersAdmits: false, enginesAdmits: false, expected: false })
  })

  it('rejects an invalid or second-source JSON at parse time', () => {
    const source = fileURLToPath(new URL('../src/platform-line.generated.ts', import.meta.url))
    expect(() => parsePlatformLine('{"version":"0.2.1-rc.2"}', source)).toThrow(/missing the floor/)
    expect(() => parsePlatformLine('{"version":"0.2.2-rc.1","floor":"0.2.1-rc.1","cohort":["0.2.1-rc.1"],"contract":1}', source)).toThrow(/major\.minor\.patch tuple/)
    expect(() => parsePlatformLine('{"version":"0.2.2-rc.1","floor":"0.2.2-rc.1","cohort":["0.2.2-rc.1"],"contract":1,"platform_version":"x"}', source)).toThrow(/unknown field/)
    expect(() => parsePlatformLine('{"version":"0.2.2-rc.2","floor":"0.2.2-rc.3","cohort":["0.2.2-rc.1","0.2.2-rc.2"],"contract":1}', source)).toThrow(/floor must equal the oldest cohort entry/)
  })

  it('keeps platform-line.generated.ts fresh from the one JSON', () => {
    const generator = fileURLToPath(new URL('../../scripts/gen-platform-line.mjs', import.meta.url))
    execFileSync(process.execPath, [generator, '--check'], { stdio: 'pipe' })
  })
})
