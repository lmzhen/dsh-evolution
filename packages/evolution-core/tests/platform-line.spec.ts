import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PLATFORM_LINE } from '../src/platform-line.generated.ts'
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
      version: '0.2.1-rc.2',
      floor: '0.2.1-rc.1',
      previousAnchor: '0.2.0-rc.2',
      peersRange: '^0.2.1-rc.1',
      enginesRange: '>=0.2.1-rc.1 <0.2.2-0',
      upstreamRef: 'dsh-v0.2.1-rc.2',
    })
  })

  it('exposes the five GITHUB_OUTPUT keys', () => {
    expect(Object.values(OUTPUT_KEYS)).toEqual(['version', 'floor', 'upstream_ref', 'peers_range', 'engines_range'])
  })

  it('freezes the window grid (both predicates, policy expected column)', () => {
    const grid = windowRows(PLATFORM_LINE)
    expect(grid.map((row: { version: string }) => row.version)).toEqual([
      '0.2.0-rc.2', '0.2.1-rc.0', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1', '0.2.2-0', '0.2.2-rc.1', '0.2.2', '0.3.0-rc.1',
    ])
    const admits = grid.filter((row: { expected: boolean }) => row.expected).map((row: { version: string }) => row.version)
    expect(admits).toEqual(['0.2.1-rc.1', '0.2.1-rc.2', '0.2.1'])
    const stableNext = grid.find((row: { version: string }) => row.version === '0.2.2')
    expect(stableNext).toMatchObject({ peersAdmits: true, enginesAdmits: false, expected: false })
  })

  it('rejects an invalid or second-source JSON at parse time', () => {
    const source = fileURLToPath(new URL('../src/platform-line.generated.ts', import.meta.url))
    expect(() => parsePlatformLine('{"version":"0.2.1-rc.2"}', source)).toThrow(/missing the floor/)
    expect(() => parsePlatformLine('{"version":"0.2.1-rc.2","floor":"0.2.2-rc.1"}', source)).toThrow(/share one major\.minor\.patch tuple/)
    expect(() => parsePlatformLine('{"version":"0.2.1-rc.2","floor":"0.2.1-rc.1","platform_version":"x"}', source)).toThrow(/unknown field/)
  })
})
