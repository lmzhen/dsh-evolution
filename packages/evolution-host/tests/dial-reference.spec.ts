import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const devReadme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')

// WC (0.3.56): every field the dial map names must genuinely exist in its
// owning package — a renamed config field makes this test red, so the dial
// reference (README "Configuration dials") can never point at a ghost field.
const dialFields: Array<[string, string]> = [
  ['reviewEnabled', '../../evolution-review/src/index.ts'],
  ['memoryEnabled', '../../tool-memory/src/index.ts'],
  ['autoStart', '../../evolution-curator/src/index.ts'],
  ['intervalHours', '../../evolution-curator/src/index.ts'],
  ['minIdleHours', '../../evolution-curator/src/index.ts'],
  ['threatExemptLabels', '../../evolution-core/src/skill-store.ts'],
  ['catalogDescriptionMaxLength', '../../evolution-host/cordis.patch.yml'],
]

describe('configuration dial reference (T-WC2, 0.3.56)', () => {
  it('documents the five dials in the dev README', () => {
    expect(devReadme).toContain('Configuration dials')
    expect(devReadme).toContain('autonomy')
    expect(devReadme).toContain('curatorBackground')
    expect(devReadme).toContain('memoryInjection')
    expect(devReadme).toContain('threatStrictness')
  })

  it('every field named by the dial map exists in its owning package source', () => {
    for (const [field, relative] of dialFields) {
      const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
      expect(source, `dial field ${field} must exist in ${relative}`).toContain(field)
    }
  })
})
